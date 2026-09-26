/**
 * Tests for the cloud inventory import (Phase 4), against a simulated OVH API:
 * a call that fails must never wipe the inventory already stored, and the
 * consumption of each month is kept.
 */

const { routes, ok, fail, useThrowawayImport } = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const PROJECT = 'proj-1';
const BASE = `/cloud/project/${PROJECT}`;

const throwaway = useThrowawayImport('ocm-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

// One S3 region (GRA), one legacy alias without detail route (GRA1, left to
// the 404 default) and one Public Cloud Archive Swift container.
function serveProject() {
  routes.set(`${BASE}/region`, ok(['GRA', 'GRA1']));
  routes.set(`${BASE}/region/GRA`, ok({ services: [{ name: 'storage-s3-standard', status: 'UP' }] }));
  routes.set(`${BASE}/region/GRA/storage`, ok([
    { name: 'photos', objectsCount: 2, objectsSize: 2048, createdAt: '2025-01-01T00:00:00Z' }
  ]));
  routes.set(`${BASE}/region/GRA/storage/photos/object`, ok([{ storageClass: 'STANDARD' }]));
  routes.set(`${BASE}/storage`, ok([
    { id: 'c-1', name: 'archives', region: 'GRA', storedObjects: 1, storedBytes: 4096 }
  ]));
  routes.set(`${BASE}/storage/c-1`, ok({ archive: true }));
  routes.set(`${BASE}/volume`, ok([
    { id: 'vol-1', name: 'data', region: 'GRA11', type: 'classic', size: 100, status: 'available', attachedTo: [] }
  ]));
  routes.set(`${BASE}/snapshot`, ok([
    { id: 'snap-1', name: 'before-upgrade', region: 'GRA11', size: 10, status: 'active', visibility: 'private', type: 'linux' }
  ]));
}

// Retry delays run on fake timers, so a rate-limited call costs no real time
async function importProject() {
  const done = importer.importCloudDetails([PROJECT]);
  await jest.runAllTimersAsync();
  await done;
}

const storedBuckets = () =>
  db.cloudDetails.getBucketsByProject(PROJECT, '2026-01-01', '2026-12-31')
    .map(b => `${b.name}:${b.storage_class}`)
    .sort();

beforeEach(() => {
  db.projects.upsert({ id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null });
  serveProject();
});

describe('object storage inventory import', () => {
  test('stores the S3 buckets and Swift containers, skipping legacy region aliases', async () => {
    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('retries a region detail call that is rate limited', async () => {
    let calls = 0;
    routes.set(`${BASE}/region/GRA`, () => (++calls === 1
      ? Promise.reject({ error: 429, message: 'Too many requests' })
      : Promise.resolve({ services: [{ name: 'storage-s3-standard', status: 'UP' }] })));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  // The ovh client puts the HTTP status in `error`, not in `statusCode`
  test('retries a region detail call that answers a server error', async () => {
    let calls = 0;
    routes.set(`${BASE}/region/GRA`, () => (++calls === 1
      ? Promise.reject({ error: 503, message: 'Service unavailable' })
      : Promise.resolve({ services: [{ name: 'storage-s3-standard', status: 'UP' }] })));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('keeps the stored buckets when a region detail call keeps failing', async () => {
    await importProject();
    routes.set(`${BASE}/region/GRA`, fail(429, 'Too many requests'));
    // Replacing the inventory now would also drop the Swift container
    routes.set(`${BASE}/storage`, ok([]));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored buckets'));
  });

  test('keeps the stored buckets when a Swift container detail call fails', async () => {
    await importProject();
    // Without the detail, the archive container would be stored as plain Swift
    routes.set(`${BASE}/storage/c-1`, fail(500, 'Internal server error'));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('keeps the stored buckets when the Swift container list fails', async () => {
    await importProject();
    routes.set(`${BASE}/storage`, fail(503, 'Service unavailable'));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });
});

describe('volume and snapshot inventory import', () => {
  test('keeps the stored volumes and snapshots when their listing fails', async () => {
    await importProject();
    routes.set(`${BASE}/volume`, fail(429, 'Too many requests'));
    routes.set(`${BASE}/snapshot`, fail(503, 'Service unavailable'));

    await importProject();

    const volumes = db.cloudDetails.getVolumesByProject(PROJECT, '2026-01-01', '2026-12-31');
    const snapshots = db.cloudDetails.getSnapshotsByProject(PROJECT, '2026-01-01', '2026-12-31');
    expect(volumes.map(v => v.id)).toEqual(['vol-1']);
    expect(snapshots.map(s => s.id)).toEqual(['snap-1']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored volumes'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored snapshots'));
  });
});

describe('project consumption import', () => {
  // The hourly resources that usage/current details for a project that ran one instance
  const oneInstance = (flavor, totalPrice) => ({
    instance: [{
      reference: flavor,
      region: 'GRA11',
      details: [{ instanceId: 'inst-1', quantity: { value: 100, unit: 'Hour' }, totalPrice }],
    }],
  });

  // Imports what usage/current answers at `instant`: the hourly resources used over a
  // period, which OVH gives with its UTC offset, or over none
  async function importUsageAt(instant, period, hourlyUsage) {
    jest.setSystemTime(new Date(instant));
    routes.set(`${BASE}/usage/current`, ok({ period, hourlyUsage }));
    await importProject();
  }

  // Imports on `day`, at noon in Paris, the usage of one instance since the 1st of the
  // month, over the period that OVH gives it
  const importUsageOn = (day, flavor, totalPrice) => importUsageAt(`${day}T10:00:00Z`, {
    from: `${day.slice(0, 8)}01T00:00:00+02:00`, to: `${day}T12:00:00+02:00`,
  }, oneInstance(flavor, totalPrice));

  // The project's consumption as [cloud resource kind, resource, cost]
  const consumption = (from, to) => db.cloudDetails.getConsumptionByProject(PROJECT, from, to)
    .map(c => [c.resource_type, c.resource_name, c.total_price]);

  test('keeps the consumption of each month it imports', async () => {
    await importUsageOn('2026-08-28', 'b2-7', 30.5);
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    // Read by month, as the Compare tab does
    expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'b2-7', 30.5]]);
    expect(consumption('2026-09-01', '2026-09-30')).toEqual([['instance', 'b2-15', 12.25]]);
  });

  // At half past midnight in Paris on 1 September, the UTC clock still reads 31 August
  test('dates the consumption by the period that OVH reports, not by the UTC clock', async () => {
    await importUsageAt('2026-08-31T21:30:00Z', {
      from: '2026-08-01T00:00:00+02:00', to: '2026-08-31T23:30:00+02:00',
    }, oneInstance('b2-7', 30.5));
    await importUsageAt('2026-08-31T22:30:00Z', {
      from: '2026-09-01T00:00:00+02:00', to: '2026-09-01T00:30:00+02:00',
    }, oneInstance('b2-15', 0.25));

    expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'b2-7', 30.5]]);
    expect(consumption('2026-09-01', '2026-09-30')).toEqual([['instance', 'b2-15', 0.25]]);
  });

  // The Compare tab reads a month from its first day to its last
  test('keeps in its month a period that ends on the first day of the next one', async () => {
    await importUsageAt('2026-08-31T22:30:00Z', {
      from: '2026-08-01T00:00:00+02:00', to: '2026-09-01T00:00:00+02:00',
    }, oneInstance('b2-7', 31));

    expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'b2-7', 31]]);
  });

  test('dates the consumption by the UTC clock when OVH reports no period', async () => {
    await importUsageAt('2026-08-31T22:30:00Z', undefined, oneInstance('b2-7', 30.5));

    expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'b2-7', 30.5]]);
    expect(db.cloudDetails.getConsumptionSummary())
      .toMatchObject({ period_start: '2026-08-01', period_end: '2026-08-31' });
  });

  test('replaces the consumption of a month it imports again', async () => {
    await importUsageOn('2026-08-28', 'b2-7', 30.5);
    await importUsageOn('2026-09-10', 'b2-15', 6);
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'b2-7', 30.5]]);
    expect(consumption('2026-09-01', '2026-09-30')).toEqual([['instance', 'b2-15', 12.25]]);
  });

  // The Public Cloud tab asks for no month: it shows the current consumption
  test('reads the latest month imported when no month is asked for', async () => {
    await importUsageOn('2026-08-28', 'b2-7', 30.5);
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    expect(consumption()).toEqual([['instance', 'b2-15', 12.25]]);
  });

  // The consumption KPIs fall back on it when /me/consumption has nothing
  test('sums the latest month imported in the consumption summary', async () => {
    await importUsageOn('2026-08-28', 'b2-7', 30.5);
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    expect(db.cloudDetails.getConsumptionSummary()).toEqual({
      period_start: '2026-09-01', period_end: '2026-09-15', total: 12.25, project_count: 1,
    });
  });

  test('splits the latest month imported by cloud resource kind', async () => {
    await importUsageOn('2026-08-28', 'b2-7', 30.5);
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    expect(db.cloudDetails.getConsumptionByResourceType(PROJECT))
      .toEqual([{ resource_type: 'instance', total: 12.25, count: 1 }]);
  });

  // The GPU panel names the GPU flavors that each project runs
  test('names the GPU flavors of the latest month imported', async () => {
    db.bills.upsert({
      id: 'FR1', date: '2026-09-01', price_without_tax: 100, price_with_tax: 120, tax: 20,
      currency: 'EUR', pdf_url: null, html_url: null,
    });
    db.details.insert({
      id: 'FR1_1', bill_id: 'FR1', project_id: PROJECT, domain: PROJECT,
      description: 'Consommation des instances l4-90', quantity: 1, unit_price: 100,
      total_price: 100, service_type: 'AI/ML',
    });
    await importUsageOn('2026-08-28', 'l40s-180', 30.5);
    await importUsageOn('2026-09-15', 'l4-90', 12.25);

    const { byProject } = db.cloudDetails.getGpuSummary('2026-09-01', '2026-09-30');
    expect(byProject.map(p => [p.project_id, p.gpu_flavors])).toEqual([[PROJECT, 'l4-90']]);
  });

  // Unlike the consumption, they are inventories: what the project has now
  test('replaces the instances and quotas of the project at each import', async () => {
    const instance = (id) => ({ id, name: id, flavor: { name: 'b2-7' }, region: 'GRA11' });
    const quota = (region) => ({ region, instance: { maxCores: 20, usedCores: 2 } });
    routes.set(`${BASE}/instance`, ok([instance('inst-1'), instance('inst-2')]));
    routes.set(`${BASE}/quota`, ok([quota('GRA11')]));
    await importUsageOn('2026-08-28', 'b2-7', 30.5);

    routes.set(`${BASE}/instance`, ok([instance('inst-2')]));
    routes.set(`${BASE}/quota`, ok([quota('SBG5')]));
    await importUsageOn('2026-09-15', 'b2-15', 12.25);

    expect(db.cloudDetails.getInstancesByProject(PROJECT).map(i => i.id)).toEqual(['inst-2']);
    expect(db.cloudDetails.getQuotasByProject(PROJECT).map(q => q.region)).toEqual(['SBG5']);
  });
});
