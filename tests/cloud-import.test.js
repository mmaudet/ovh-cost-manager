/**
 * Tests for the cloud inventory import (Phase 4), against a simulated OVH API:
 * a call that fails must never wipe the inventory already stored, and the
 * consumption of each month is kept.
 */

const { client, routes, ok, fail, useThrowawayImport } = require('./support/simulated-ovh');
const { ACCOUNT } = require('./support/accounts');
const { shiftMonth } = require('../data/months');

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
  const done = importer.importCloudDetails(client, [PROJECT], ACCOUNT.nic);
  await jest.runAllTimersAsync();
  await done;
}

const storedBuckets = () =>
  db.cloudDetails.getBucketsByProject(PROJECT, '2026-01-01', '2026-12-31')
    .map(b => `${b.name}:${b.storage_class}`)
    .sort();

beforeEach(() => {
  db.projects.upsert({
    id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null,
    account: ACCOUNT.nic,
  });
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

  // An amount as OVH's schema gives some of them, and the total of an answer: an order.Price
  const price = (value) => ({
    currencyCode: 'EUR', priceInUcents: value * 100000000, text: `${value.toFixed(2)} €`, value,
  });

  // Imports what usage/current answers at `instant`: the hourly resources used over a
  // period, which OVH gives with its UTC offset, or over none, and the other parts of the
  // answer, if any
  async function importUsageAt(instant, period, hourlyUsage, otherParts = {}) {
    jest.setSystemTime(new Date(instant));
    routes.set(`${BASE}/usage/current`, ok({ period, hourlyUsage, ...otherParts }));
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

  // A bill line of September for L4 GPU instances of the project, which the GPU panel lists
  function billGpuInstances() {
    db.bills.upsert({
      id: 'FR1', date: '2026-09-01', price_without_tax: 100, price_with_tax: 120, tax: 20,
      currency: 'EUR', pdf_url: null, html_url: null, account: ACCOUNT.nic,
    });
    db.details.insert({
      id: 'FR1_1', bill_id: 'FR1', project_id: PROJECT, domain: PROJECT,
      description: 'Consommation des instances l4-90', quantity: 1, unit_price: 100,
      total_price: 100, service_type: 'AI/ML',
    });
  }

  // The GPU flavors that the GPU panel names for each project billed in September
  const gpuFlavors = () => db.cloudDetails.getGpuSummary('2026-09-01', '2026-09-30')
    .byProject.map(p => [p.project_id, p.gpu_flavors]);

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
    expect(db.cloudDetails.getConsumptionSummary(ACCOUNT.nic))
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

    expect(db.cloudDetails.getConsumptionSummary(ACCOUNT.nic)).toEqual({
      period_start: '2026-09-01', period_end: '2026-09-15', total: 12.25, monthly_total: 0,
      project_count: 1, forecast_total: null,
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
    billGpuInstances();
    await importUsageOn('2026-08-28', 'l40s-180', 30.5);
    await importUsageOn('2026-09-15', 'l4-90', 12.25);

    expect(gpuFlavors()).toEqual([[PROJECT, 'l4-90']]);
  });

  // A project that used one resource of every kind that usage/current details, shaped as
  // OVH's schema gives them (cloud.usage.UsageCurrent): some amounts are numbers, others
  // an order.Price, and some parts detail no resource. Their total is OVH's, 53 € (#145).
  describe('with every part of the usage', () => {
    const hours = (value) => ({ value, unit: 'Hour' });
    const gib = (value, unit = 'GiBh') => ({ value, unit });
    const hourlyUsage = {
      instance: [{
        reference: 'b3-8', region: 'SBG5', quantity: hours(600), totalPrice: 10,
        details: [{ instanceId: 'inst-1', quantity: hours(600), totalPrice: 10 }],
      }],
      instanceOption: [{
        reference: 'win-b3-8', region: 'SBG5', quantity: hours(600), totalPrice: 1.5,
        details: [{ instanceId: 'inst-1', quantity: hours(600), totalPrice: 1.5 }],
      }],
      instanceBandwidth: [{
        region: 'SBG5', totalPrice: 0.5,
        outgoingBandwidth: { quantity: gib(50, 'GiB'), totalPrice: 0.5 },
      }],
      volume: [{
        type: 'classic', region: 'SBG5', quantity: gib(7200), totalPrice: 2,
        details: [{ volumeId: 'vol-1', quantity: gib(7200), totalPrice: 2 }],
      }],
      snapshot: [{
        region: 'SBG5', totalPrice: 1,
        instance: { quantity: gib(36000), totalPrice: 1 },
      }],
      storage: [{
        bucketName: 'l4-datasets', region: 'SBG', type: 'storage-standard', totalPrice: 5,
        stored: { quantity: gib(720000), totalPrice: 4.5 },
        outgoingBandwidth: { quantity: gib(10, 'GiB'), totalPrice: 0.5 },
      }],
      managedKubernetesService: [{
        reference: 'mks.standard', region: 'SBG5', quantity: hours(600), totalPrice: price(4),
        details: [{ id: 'kube-1', quantity: hours(600), totalPrice: price(4) }],
      }],
    };
    const monthlyUsage = {
      instance: [{
        reference: 'b3-16', region: 'SBG5', totalPrice: 20,
        details: [{ instanceId: 'inst-2', activation: '2026-09-01T00:00:00Z', totalPrice: 20 }],
      }],
      savingsPlan: [{
        flavor: 'b3-8', totalPrice: price(6),
        details: [{
          id: 'sp-1', planName: 'b3-8', size: 1, totalPrice: price(6), unitPrice: price(6),
        }],
      }],
    };
    const resourcesUsage = [{
      type: 'registry', totalPrice: 3,
      resources: [{
        region: 'GRA',
        components: [{ id: 'reg-1', name: 'registry.small', quantity: hours(650), totalPrice: 3 }],
      }],
    }];
    const importEveryPart = (totalPrice) => importUsageAt('2026-09-27T10:00:00Z', {
      from: '2026-09-01T00:00:00+02:00', to: '2026-09-27T12:00:00+02:00',
    }, hourlyUsage, { monthlyUsage, resourcesUsage, totalPrice: price(totalPrice) });

    test('counts all of it in the current consumption of the project', async () => {
      await importEveryPart(53);

      const [project] = db.projects.getEnriched(ACCOUNT.nic);
      expect(project.consumption_total).toBeCloseTo(53, 2);
      // The monthly plan and the savings plan, which a month-end forecast counts once
      expect(db.cloudDetails.getConsumptionSummary(ACCOUNT.nic))
        .toMatchObject({ total: 53, monthly_total: 26 });
    });

    test('splits it by cloud resource kind, the registry included', async () => {
      await importEveryPart(53);

      const byKind = Object.fromEntries(db.cloudDetails.getConsumptionByResourceType(PROJECT)
        .map(({ resource_type: kind, total }) => [kind, Math.round(total * 100) / 100]));
      expect(byKind).toEqual({
        instance: 10,
        instance_option: 1.5,
        instance_bandwidth: 0.5,
        volume: 2,
        snapshot: 1,
        storage: 5,
        kubernetes: 4,
        instance_monthly: 20,
        savings_plan: 6,
        registry: 3,
      });
    });

    // OVH adds kinds of resources to its answer over time
    test('counts what no part names in the total that OVH gives the project', async () => {
      await importEveryPart(55.25);

      const [project] = db.projects.getEnriched(ACCOUNT.nic);
      expect(project.consumption_total).toBeCloseTo(55.25, 2);
      expect(db.cloudDetails.getConsumptionByResourceType(PROJECT))
        .toContainEqual({ resource_type: 'other', total: 2.25, count: 1 });
    });

    // As if two parts of the answer counted one resource
    test('warns when its parts count more than the total that OVH gives the project', async () => {
      await importEveryPart(50);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('counts 3 more than the total OVH gives it'),
      );
      const [project] = db.projects.getEnriched(ACCOUNT.nic);
      expect(project.consumption_total).toBeCloseTo(53, 2);
    });

    // The bucket is named like an L4 flavor
    test('names no GPU flavor from a resource that is no instance', async () => {
      billGpuInstances();
      await importEveryPart(53);

      expect(gpuFlavors()).toEqual([[PROJECT, '']]);
    });
  });

  // What usage/forecast gives a project (#224), shaped as OVH's schema gives it
  // (cloud.usage.UsageForecast): the usage of a month to its end, over the period of that
  // month, and its total, an order.Price
  describe('with the forecast that OVH gives the project', () => {
    // The answer that forecasts `total` for the month `month`, YYYY-MM: September by default
    const forecastOf = (total, month = '2026-09') => ({
      lastUpdate: `${month}-15T12:00:00+02:00`,
      period: {
        from: `${month}-01T00:00:00+02:00`, to: `${shiftMonth(month, 1)}-01T00:00:00+02:00`,
      },
      hourlyUsage: oneInstance('b2-15', total),
      totalPrice: price(total),
      usableCredits: { details: [], totalCredit: 0 },
    });

    // Serves the forecast of a project
    const serveForecast = (projectId, answer) =>
      routes.set(`/cloud/project/${projectId}/usage/forecast`, answer);

    // The forecasts stored, as [project, first day of the month forecast, total]
    const storedForecasts = () => db.getDb()
      .prepare('SELECT * FROM project_forecasts ORDER BY project_id').all()
      .map(({ project_id: id, period_start: month, total_price: total }) => [id, month, total]);

    // What OVH forecasts the account's projects to cost in the month of its current
    // consumption, as the forecast card reads it
    const forecast = () => db.cloudDetails.getConsumptionSummary(ACCOUNT.nic).forecast_total;

    // A second project of the account, which used one instance in September up to the 15th
    function serveSecondProject(forecastAnswer) {
      db.projects.upsert({
        id: 'proj-2', name: 'Project 2', description: null, status: 'ok', created_at: null,
        account: ACCOUNT.nic,
      });
      routes.set('/cloud/project/proj-2/usage/current', ok({
        period: { from: '2026-09-01T00:00:00+02:00', to: '2026-09-15T12:00:00+02:00' },
        hourlyUsage: oneInstance('b2-7', 7),
      }));
      serveForecast('proj-2', forecastAnswer);
    }

    // Imports on the 15th of September the usage of both projects, and their forecasts
    async function importBothProjects() {
      jest.setSystemTime(new Date('2026-09-15T10:00:00Z'));
      routes.set(`${BASE}/usage/current`, ok({
        period: { from: '2026-09-01T00:00:00+02:00', to: '2026-09-15T12:00:00+02:00' },
        hourlyUsage: oneInstance('b2-15', 12.25),
      }));
      const done = importer.importCloudDetails(client, [PROJECT, 'proj-2'], ACCOUNT.nic);
      await jest.runAllTimersAsync();
      await done;
    }

    test('stores the forecast of each project, of the month that its period gives', async () => {
      serveForecast(PROJECT, ok(forecastOf(30)));
      serveSecondProject(ok(forecastOf(45.5)));

      await importBothProjects();

      expect(storedForecasts()).toEqual([
        [PROJECT, '2026-09-01', 30], ['proj-2', '2026-09-01', 45.5],
      ]);
    });

    // The cards read the latest only
    test('keeps the latest forecast of each project, which the next import replaces', async () => {
      serveForecast(PROJECT, ok(forecastOf(60, '2026-08')));
      await importUsageOn('2026-08-28', 'b2-7', 30.5);
      serveForecast(PROJECT, ok(forecastOf(30)));

      await importUsageOn('2026-09-15', 'b2-15', 12.25);

      expect(storedForecasts()).toEqual([[PROJECT, '2026-09-01', 30]]);
    });

    // The usage is read at 23:59:59 on the 31st of August in Paris, and the forecast after
    // midnight, of September
    test('dates it by its own period when the month turns after the usage is read', async () => {
      serveForecast(PROJECT, ok(forecastOf(30)));

      await importUsageAt('2026-08-31T21:59:59Z', {
        from: '2026-08-01T00:00:00+02:00', to: '2026-08-31T23:59:59+02:00',
      }, oneInstance('b2-7', 30.5));

      expect(storedForecasts()).toEqual([[PROJECT, '2026-09-01', 30]]);
      // August, the month of the current consumption, has none
      expect(forecast()).toBeNull();
    });

    // As a failed call keeps a project's stored volumes
    test('keeps the stored forecast when its call fails, and imports the rest', async () => {
      serveForecast(PROJECT, ok(forecastOf(30)));
      await importUsageOn('2026-09-10', 'b2-15', 6);
      serveForecast(PROJECT, fail(503, 'Service unavailable'));
      routes.set(`${BASE}/instance`, ok([
        { id: 'inst-1', name: 'web-1', flavor: { name: 'b2-15' }, region: 'GRA11' },
      ]));
      serveSecondProject(ok(forecastOf(45.5)));

      await importBothProjects();

      expect(console.warn).toHaveBeenCalledWith('    Forecast fetch failed, keeping the stored '
        + 'forecast: 503 Service unavailable');
      // Its own, of the 10th, and that of the next project
      expect(storedForecasts()).toEqual([
        [PROJECT, '2026-09-01', 30], ['proj-2', '2026-09-01', 45.5],
      ]);
      expect(consumption()).toEqual([['instance', 'b2-15', 12.25]]);
      expect(db.cloudDetails.getInstancesByProject(PROJECT).map(i => i.id)).toEqual(['inst-1']);
    });

    // Without either, it could not be dated or added up
    test.each(['period', 'totalPrice'])(
      'stores none from an answer without its %s, and keeps the stored one', async (field) => {
        serveForecast(PROJECT, ok(forecastOf(30)));
        await importUsageOn('2026-09-10', 'b2-15', 6);
        const answer = forecastOf(45.5);
        delete answer[field];
        serveForecast(PROJECT, ok(answer));

        await importUsageOn('2026-09-15', 'b2-15', 12.25);

        expect(storedForecasts()).toEqual([[PROJECT, '2026-09-01', 30]]);
        expect(console.warn).toHaveBeenCalledWith('    Forecast fetch failed, keeping the stored '
          + 'forecast: its answer gives no period or no total');
      },
    );

    // Once a month starts, its forecast is none until an import stores one
    test('reads no forecast of an earlier month', async () => {
      serveForecast(PROJECT, ok(forecastOf(60, '2026-08')));
      await importUsageOn('2026-08-28', 'b2-7', 30.5);
      serveForecast(PROJECT, fail(404, 'Not found'));

      await importUsageOn('2026-09-02', 'b2-7', 2);

      expect(forecast()).toBeNull();
    });

    // Its own period dates it
    test('stores it even when the usage of the project cannot be read', async () => {
      serveForecast(PROJECT, ok(forecastOf(30)));
      routes.set(`${BASE}/usage/current`, fail(500, 'Internal server error'));

      await importProject();

      expect(storedForecasts()).toEqual([[PROJECT, '2026-09-01', 30]]);
    });
  });

  // On 2 September, OVH reports September, without any usage yet: the current consumption
  // is that of September, none, not that of August
  describe('once a month starts without any usage yet', () => {
    beforeEach(async () => {
      billGpuInstances();
      await importUsageOn('2026-08-28', 'l4-90', 30.5);
      await importUsageAt('2026-09-02T10:00:00Z', {
        from: '2026-09-01T00:00:00+02:00', to: '2026-09-02T12:00:00+02:00',
      }, {});
    });

    test('keeps the consumption of the previous month', () => {
      expect(consumption('2026-08-01', '2026-08-31')).toEqual([['instance', 'l4-90', 30.5]]);
    });

    test('reads no consumption when no month is asked for', () => {
      expect(consumption()).toEqual([]);
    });

    test('sums no consumption in the consumption summary', () => {
      expect(db.cloudDetails.getConsumptionSummary(ACCOUNT.nic)).toEqual({
        period_start: null, period_end: null, total: null, monthly_total: null, project_count: 0,
        forecast_total: null,
      });
    });

    test('splits no consumption by cloud resource kind', () => {
      expect(db.cloudDetails.getConsumptionByResourceType(PROJECT)).toEqual([]);
    });

    test('names no GPU flavor', () => {
      expect(gpuFlavors()).toEqual([[PROJECT, '']]);
    });
  });

  // When OVH is late to start the month for some projects
  test('reads the latest month that the usage of a project reports', async () => {
    jest.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    db.projects.upsert({
      id: 'proj-2', name: 'Project 2', description: null, status: 'ok', created_at: null,
      account: ACCOUNT.nic,
    });
    routes.set(`${BASE}/usage/current`, ok({
      period: { from: '2026-09-01T00:00:00+02:00', to: '2026-09-01T12:00:00+02:00' },
      hourlyUsage: oneInstance('b2-15', 1.5),
    }));
    routes.set('/cloud/project/proj-2/usage/current', ok({
      period: { from: '2026-08-01T00:00:00+02:00', to: '2026-09-01T00:00:00+02:00' },
      hourlyUsage: oneInstance('b2-7', 31),
    }));

    const done = importer.importCloudDetails(client, [PROJECT, 'proj-2'], ACCOUNT.nic);
    await jest.runAllTimersAsync();
    await done;

    expect(consumption()).toEqual([['instance', 'b2-15', 1.5]]);
  });

  // Consumption stored by a version that did not record the month of its import
  test('reads the latest month stored before any import records its month', () => {
    const stored = (month, flavor, totalPrice) => db.cloudDetails.insertConsumption({
      project_id: PROJECT, period_start: `${month}-01`, period_end: `${month}-15`,
      resource_type: 'instance', resource_id: 'inst-1', resource_name: flavor,
      quantity: 100, unit: 'Hour', unit_price: 0, total_price: totalPrice, region: 'GRA11',
    });
    stored('2026-08', 'b2-7', 30.5);
    stored('2026-09', 'b2-15', 12.25);

    expect(consumption()).toEqual([['instance', 'b2-15', 12.25]]);
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
