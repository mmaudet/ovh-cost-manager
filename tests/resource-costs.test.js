/**
 * Tests for the per-resource cost of Public Cloud projects: bill lines matched
 * to the imported inventory (snapshots, volumes, buckets, instances, savings
 * plans), through the data layer on a throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ACCOUNT } = require('./support/accounts');

const PROJECT = 'proj-1';
const FROM = '2026-03-01';
const TO = '2026-03-31';

let db;
let dataDir;
let lineCount = 0;
const previousDataDir = process.env.DATA_DIR;

// One bill per date, one bill line per call
function seedBillLine(description, totalPrice, date = '2026-03-01') {
  const billId = `FR-${date}`;
  db.bills.upsert({
    id: billId, date, price_without_tax: 0, price_with_tax: 0, tax: 0,
    currency: 'EUR', pdf_url: null, html_url: null, account: ACCOUNT.nic
  });
  db.details.insert({
    id: `${billId}_${++lineCount}`, bill_id: billId, project_id: PROJECT, domain: PROJECT,
    description, quantity: 1, unit_price: totalPrice, total_price: totalPrice, service_type: null
  });
}

function seedInstance(instance) {
  db.cloudDetails.upsertInstance({
    project_id: PROJECT, name: instance.id, flavor: '', plan_code: null, region: 'GRA11',
    status: 'ACTIVE', created_at: null, monthly_billing: 0, ...instance
  });
}

function seedSnapshot(snapshot) {
  db.cloudDetails.upsertSnapshot({
    project_id: PROJECT, name: snapshot.id, region: 'GRA1', size_gb: 10, status: 'active',
    visibility: 'private', os_type: 'linux', created_at: null, ...snapshot
  });
}

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-costs-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

// The tables that the tests seed: the bills of the project, and its inventory. The rows that
// reference a bill or the project go first.
const SEEDED_TABLES = [
  'bill_details', 'bills', 'cloud_instances', 'cloud_volumes', 'cloud_snapshots',
  'object_storage_buckets', 'projects',
];

beforeEach(() => {
  for (const table of SEEDED_TABLES) db.getDb().exec(`DELETE FROM ${table}`);
  db.projects.upsert({
    id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null,
    account: ACCOUNT.nic,
  });
});

describe('allocateProRata', () => {
  const bySize = r => r.size;

  test('splits the amount pro rata of the weights, adding up to the cent', () => {
    const rows = [{ size: 1 }, { size: 1 }, { size: 1 }];

    expect(db.allocateProRata(rows, 100, bySize)).toBe(true);

    expect(rows).toEqual([
      { size: 1, total: 33.34, allocated: true },
      { size: 1, total: 33.33, allocated: true },
      { size: 1, total: 33.33, allocated: true }
    ]);
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBeCloseTo(100, 2);
  });

  test('gives the rounding residual to the heaviest row', () => {
    const rows = [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 3 }];

    db.allocateProRata(rows, 1, bySize);

    // 0.17 x 3 + 0.50 would bill one cent too many
    expect(rows.map(r => r.total)).toEqual([0.17, 0.17, 0.17, 0.49]);
  });

  test('gives no share to a row without volume', () => {
    const rows = [{ size: 0 }, { size: 2 }];

    db.allocateProRata(rows, 5, bySize);

    expect(rows).toEqual([{ size: 0 }, { size: 2, total: 5, allocated: true }]);
  });

  test('spreads nothing when no row has any volume, so the caller keeps the line', () => {
    const rows = [{ size: 0 }, { size: null }];

    expect(db.allocateProRata(rows, 5, bySize)).toBe(false);

    expect(rows).toEqual([{ size: 0 }, { size: null }]);
  });

  test('does not spread a credit note, so the caller keeps it on a row of its own', () => {
    const rows = [{ size: 1 }, { size: 3 }];

    expect(db.allocateProRata(rows, -12.5, bySize)).toBe(false);

    expect(rows).toEqual([{ size: 1 }, { size: 3 }]);
  });
});

describe('credit notes', () => {
  test('a credit on an extra disk line stays on a row of its own', () => {
    db.cloudDetails.upsertVolume({
      id: 'vol-1', project_id: PROJECT, name: 'data', region: 'GRA5', type: 'classic', size_gb: 100,
      status: 'in-use', bootable: 0, attached_to: 'inst-1', plan_code: null, created_at: null
    });
    seedBillLine('Disques supplémentaires à gra5 de type classic', -4.2);

    const volumes = db.cloudDetails.getVolumesByProject(PROJECT, FROM, TO);

    expect(volumes.map(v => [v.name, v.total])).toEqual([
      ['data', 0],
      ['Disques supplémentaires à gra5 de type classic', -4.2]
    ]);
  });

  test('a Cold Archive credit stays on a row of its own', () => {
    db.cloudDetails.upsertBucket({
      id: `${PROJECT}:GRA:cold`, project_id: PROJECT, name: 'cold', region: 'GRA', storage_class: 'Cold Archive',
      status: 'archived', objects_count: 1, objects_size: 1000, created_at: null
    });
    seedBillLine('Stockage Cold Archive', -2.5);

    const buckets = db.cloudDetails.getBucketsByProject(PROJECT, FROM, TO);

    expect(buckets.map(b => [b.name, b.total])).toEqual([
      ['cold', 0],
      ['Stockage Cold Archive', -2.5]
    ]);
  });
});

describe('snapshot cost', () => {
  test.each([
    ['gra1', 'GRA1'],
    ['eu-west-par', 'EU-WEST-PAR'],
    ['EU-WEST-PAR', 'EU-WEST-PAR']
  ])('spreads "Snapshots Public Cloud - %s" over the snapshots of that region', (billedRegion, region) => {
    seedSnapshot({ id: 'snap-1', region });
    seedBillLine(`Snapshots Public Cloud - ${billedRegion}`, 4.2);

    const snapshots = db.cloudDetails.getSnapshotsByProject(PROJECT, FROM, TO);

    expect(snapshots).toEqual([expect.objectContaining({ id: 'snap-1', total: 4.2, allocated: true })]);
  });
});

describe('bucket type', () => {
  test('stays unknown when the class could not be read, whatever the bill line says', () => {
    // Inventory bucket whose class could not be sampled (empty bucket)
    db.cloudDetails.upsertBucket({
      id: `${PROJECT}:GRA:empty`, project_id: PROJECT, name: 'empty', region: 'GRA', storage_class: null,
      status: null, objects_count: 0, objects_size: 0, created_at: '2025-01-01T00:00:00Z'
    });
    seedBillLine('Stockage Standard - Bucket empty sur la région gra', 1.5);
    // Billed but absent from the inventory
    seedBillLine('Stockage Standard - Bucket gone sur la région gra', 0.5);

    const buckets = db.cloudDetails.getBucketsByProject(PROJECT, FROM, TO);

    expect(buckets.map(b => [b.name, b.storage_class, b.total])).toEqual([
      ['empty', null, 1.5],
      ['gone', null, 0.5]
    ]);
  });
});

describe('instance cost', () => {
  const costById = (instances) => Object.fromEntries(instances.map(i => [i.id, i.total]));

  test('shares an hourly line only among the instances created by the end of the period', () => {
    seedInstance({ id: 'january', plan_code: 'b3-8', created_at: '2026-01-10T08:00:00Z' });
    seedInstance({ id: 'last-day', plan_code: 'b3-8', created_at: '2026-03-31T23:00:00Z' });
    seedInstance({ id: 'june', plan_code: 'b3-8', created_at: '2026-06-02T08:00:00Z' });
    seedBillLine("Consommation à l'heure pour les instances b3-8 gra11", 10);

    const instances = db.cloudDetails.getInstancesByProject(PROJECT, FROM, TO);

    expect(costById(instances)).toEqual({ january: 5, 'last-day': 5, june: null });
  });

  test('keeps the hourly lines left without an instance on an unallocated row', () => {
    seedInstance({ id: 'web', plan_code: 'b3-8', created_at: '2026-01-10T08:00:00Z' });
    seedInstance({ id: 'june', plan_code: 'c3-4', created_at: '2026-06-02T08:00:00Z' });
    seedBillLine("Consommation à l'heure pour les instances b3-8 gra11", 10);
    // No r3-16 is left in the inventory, and the only c3-4 came after the period
    seedBillLine("Consommation à l'heure pour les instances r3-16 gra11", 4.5);
    seedBillLine("Consommation à l'heure pour les instances c3-4 gra11", 2.25);

    const instances = db.cloudDetails.getInstancesByProject(PROJECT, FROM, TO);

    expect(instances.filter(i => i.unallocated)).toEqual([
      expect.objectContaining({ id: null, total: 6.75, cost_estimated: false })
    ]);
    // The cost column now adds up to the billed instance lines
    expect(instances.reduce((sum, i) => sum + (i.total || 0), 0)).toBeCloseTo(16.75, 2);
  });

  test('charges a monthly prorata line to its instance, as an exact cost', () => {
    const id = 'f10ee44b-b3da-491e-a4a4-2f642c000000';
    seedInstance({ id, plan_code: 'b2-7', monthly_billing: 1, created_at: '2025-11-03T09:00:00Z' });
    seedBillLine(`Prorata de la facturation mensuelle d'une instance b2-7 (id ${id})`, 16.39);

    const instances = db.cloudDetails.getInstancesByProject(PROJECT, FROM, TO);

    expect(instances).toEqual([expect.objectContaining({ id, total: 16.39, cost_estimated: false })]);
  });

  test('sends the monthly lines of an instance gone from the inventory to the unallocated row', () => {
    const gone = '5a1c2e3d-0000-4000-8000-000000000001';
    seedInstance({ id: 'web', plan_code: 'b3-8', created_at: '2026-01-10T08:00:00Z' });
    seedBillLine(`Forfait mensuel pour une instance b2-7 (id ${gone}, region gra11)`, 20.5);
    seedBillLine(`Prorata de la facturation mensuelle d'une instance b2-7 (id ${gone})`, 3.25);

    const instances = db.cloudDetails.getInstancesByProject(PROJECT, FROM, TO);

    expect(instances.filter(i => i.unallocated)).toEqual([expect.objectContaining({ total: 23.75 })]);
  });
});

describe('Public Cloud cards', () => {
  test('the Kubernetes card leaves savings plan lines to the savings plan card', () => {
    seedBillLine('Managed Kubernetes Service - Standard plan', 12);
    seedBillLine('Savings plan (id : savings-plan-3xc3-4_node_k8s) pour 3 instance(s) c3-4 - Durée : 1M', 90);

    const stats = db.inventory.getPublicCloudStats(FROM, TO);

    expect(stats.kubernetes).toEqual({ count: 1, total: 12 });
    expect(stats.savingsPlans).toEqual({ count: 1, total: 90 });
  });

  // Each line of a Public Cloud project counts in one card, so that the cards add up to the
  // cloud total of the month, which adds up the lines of the projects (#145)
  describe('with a line of each product', () => {
    const LINES = [
      ['Consommation à l\'heure pour les instances b3-8 gra11', 100],
      ['Forfait mensuel pour une instance b2-30 (id 5a1c2e3d-0000-4000-8000-000000000001, region gra7) - 01 mois', 50],
      ['Prorata de la facturation mensuelle d\'une instance b2-30 (id 5a1c2e3d-0000-4000-8000-000000000001, region gra7)', 5],
      ['Disques supplémentaires à gra9 de type high-speed', 20],
      ['Snapshots Public Cloud - gra9', 3],
      ['Sauvegarde de disques - gra9', 7],
      ['Stockage Standard - Bucket assets sur la région gra', 10],
      ['Stockage d\'object Public Cloud - gra', 4],
      ['Bande passante - stockage d\'objects Public Cloud - gra', 0.25],
      ['Bande passante out Stockage Standard Infrequent Access - gra', 0.25],
      ['Stockage Standard - Bucket registry-cache sur la région gra', 1],
      ['Managed Private Registry - plan M', 40],
      ['Managed Kubernetes Service - Standard plan', 12],
      ['Savings plan (id : savings-plan-1xb3-8) pour 1 instance(s) b3-8 - Durée : 1M', 90],
      ['Public Cloud Databases PostgreSQL business DB1-7 à gra', 30],
      ['Octavia Loadbalancer - Small', 12],
      ['Public Cloud Floating IP', 2],
      ['Public Cloud Gateway Small', 3],
      ['Public Cloud AI Notebooks stockage du workspace', 0.5],
      ['A product that OVH launched since', 1],
      ['Utilisation du credit cloud', -5],
    ];
    const CLOUD_TOTAL = LINES.reduce((sum, [, price]) => sum + price, 0);
    const CARDS = ['instances', 'kubernetes', 'objectStorage', 'volumes', 'snapshots', 'savingsPlans', 'registry', 'other'];

    beforeEach(() => {
      for (const [description, price] of LINES) seedBillLine(description, price);
    });

    test('the cards add up to the cloud total of the month', () => {
      const stats = db.inventory.getPublicCloudStats(FROM, TO);

      const cards = CARDS.reduce((sum, card) => sum + stats[card].total, 0);
      expect(cards).toBeCloseTo(CLOUD_TOTAL, 2);
      expect(db.analysis.summary(FROM, TO).cloud_total).toBeCloseTo(CLOUD_TOTAL, 2);
    });

    test('the instance card counts the proratas of the monthly plans', () => {
      expect(db.inventory.getPublicCloudStats(FROM, TO).instances.total).toBe(155);
    });

    test('the object storage card counts the Swift lines, the bandwidth and every bucket, whatever its name', () => {
      const stats = db.inventory.getPublicCloudStats(FROM, TO);

      expect(stats.objectStorage.total).toBe(15.5);
      expect(stats.registry.total).toBe(40);
    });

    test('the other services card names what the other cards leave, the largest first', () => {
      expect(db.inventory.getPublicCloudStats(FROM, TO).other).toEqual({
        total: 50.5,
        products: [
          { product: 'databases', total: 30 },
          { product: 'loadBalancers', total: 12 },
          { product: 'volumeBackups', total: 7 },
          { product: 'gateways', total: 3 },
          { product: 'floatingIps', total: 2 },
          { product: 'other', total: 1 },
          { product: 'ai', total: 0.5 },
          { product: 'credits', total: -5 },
        ],
      });
    });
  });

  test('the other services card names no product that cost nothing', () => {
    seedBillLine('A product that OVH launched since', 0);

    expect(db.inventory.getPublicCloudStats(FROM, TO).other).toEqual({ total: 0, products: [] });
  });
});

describe('savings plans', () => {
  test('sums the instances paid by every plan of a flavor against that flavor\'s inventory', () => {
    for (const id of ['k1', 'k2', 'k3', 'k4']) seedInstance({ id, plan_code: 'c3-4' });
    for (const id of ['b1', 'b2']) seedInstance({ id, plan_code: 'b3-8' });
    seedBillLine('Savings plan (id : savings-plan-3xc3-4_node_k8s) pour 3 instance(s) c3-4 - Durée : 1M', 90);
    seedBillLine('Savings plan (id : savings-plan-2xc3-4) pour 2 instance(s) c3-4 - Durée : 1M', 60);
    seedBillLine('Savings plan (id : savings-plan-1xb3-8) pour 1 instance(s) b3-8 - Durée : 1M', 20);

    const plans = db.cloudDetails.getSavingsPlansByProject(PROJECT, FROM, TO);

    expect(plans.map(p => [p.id, p.covered, p.flavor_covered, p.inventory])).toEqual([
      ['savings-plan-3xc3-4_node_k8s', 3, 5, 4],
      ['savings-plan-2xc3-4', 2, 5, 4],
      ['savings-plan-1xb3-8', 1, 1, 2]
    ]);
  });
});
