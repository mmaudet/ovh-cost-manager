/**
 * Tests for a full import (import.js --full), against a simulated OVH API: it clears what
 * it imports again, and keeps what OVH cannot give again.
 */

const { routes, ok, useThrowawayImport } = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const PROJECT = 'proj-1';

const throwaway = useThrowawayImport('ocm-full-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

// OVH lists these projects, and no bill
function serveProjects(...ids) {
  routes.set('/cloud/project', ok(ids));
  for (const id of ids) routes.set(`/cloud/project/${id}`, ok({ description: id, status: 'ok' }));
  routes.set('/me/bill', ok([]));
}

// A full import, without any of the datasets that the bills do not give
async function importFull() {
  const done = importer.runImport({ full: true });
  await jest.runAllTimersAsync();
  await done;
}

const storeProject = (id) => db.projects.upsert({
  id, name: id, description: null, status: 'ok', created_at: null,
});

// What a project consumed in a month, as the import stores it
const storeConsumption = (projectId, month, totalPrice) => db.cloudDetails.insertConsumption({
  project_id: projectId, period_start: `${month}-01`, period_end: `${month}-28`,
  resource_type: 'instance', resource_id: 'inst-1', resource_name: 'b2-7', quantity: 100,
  unit: 'Hour', unit_price: 0, total_price: totalPrice, region: 'GRA11',
});

// The project's consumption as [first day of its month, cost]
const consumptionOf = (projectId, from, to) =>
  db.cloudDetails.getConsumptionByProject(projectId, from, to)
    .map(c => [c.period_start, c.total_price]);

describe('a full import', () => {
  test('keeps the consumption of every month, which OVH cannot give again', async () => {
    storeProject(PROJECT);
    storeConsumption(PROJECT, '2026-08', 30.5);
    storeConsumption(PROJECT, '2026-09', 12.25);
    serveProjects(PROJECT);

    await importFull();

    expect(consumptionOf(PROJECT, '2026-08-01', '2026-09-30'))
      .toEqual([['2026-09-01', 12.25], ['2026-08-01', 30.5]]);
  });

  // September started without any usage yet: it stays the month of the current consumption
  test('keeps the month of the current consumption', async () => {
    storeProject(PROJECT);
    storeConsumption(PROJECT, '2026-08', 30.5);
    db.cloudDetails.setCurrentConsumptionMonth('2026-09-01');
    serveProjects(PROJECT);

    await importFull();

    expect(consumptionOf(PROJECT)).toEqual([]);
  });

  // Their consumption needs them, even once OVH no longer lists them
  test('keeps the projects of the consumption it keeps', async () => {
    storeProject(PROJECT);
    storeProject('proj-deleted');
    storeConsumption('proj-deleted', '2026-08', 5);
    serveProjects(PROJECT);

    await importFull();

    expect(db.projects.getAll().map(p => p.id)).toEqual([PROJECT, 'proj-deleted']);
  });

  test('clears the bills, the projects and the inventories, which it imports again', async () => {
    db.bills.upsert({
      id: 'FR1', date: '2026-09-01', price_without_tax: 10, price_with_tax: 12, tax: 2,
      currency: 'EUR', pdf_url: null, html_url: null,
    });
    db.details.insert({
      id: 'FR1_1', bill_id: 'FR1', project_id: null, domain: 'example.com',
      description: 'Nom de domaine example.com', quantity: 1, unit_price: 10, total_price: 10,
      service_type: 'Other',
    });
    storeProject('proj-deleted');
    db.cloudDetails.upsertInstance({
      id: 'inst-1', project_id: 'proj-deleted', name: 'web-1', flavor: 'b2-7', region: 'GRA11',
      status: 'ACTIVE', created_at: null, monthly_billing: 0,
    });
    db.cloudDetails.upsertVolume({
      id: 'vol-1', project_id: 'proj-deleted', name: 'data', region: 'GRA11', type: 'classic',
      size_gb: 100, status: 'available', bootable: 0, attached_to: '', plan_code: null,
      created_at: null,
    });
    db.inventory.upsertServer({
      id: 'ns1.example.net', display_name: 'ns1', reverse: '', datacenter: 'rbx', os: '',
      state: 'ok', cpu: '', ram_size: 0, disk_info: '[]', bandwidth: 0, expiration_date: null,
      renewal_type: '',
    });
    db.inventory.upsertVps({
      id: 'vps-1.vps.ovh.net', display_name: 'vps-1', model: '', zone: '', state: 'running',
      os: 'Debian 12', vcpus: 2, ram_mb: 2048, disk_gb: 40, expiration_date: null,
      renewal_type: '', ip_addresses: '[]',
    });
    serveProjects();

    await importFull();

    expect({
      bills: db.bills.getAll(),
      billLines: db.details.getByBillId('FR1'),
      projects: db.projects.getAll(),
      instances: db.cloudDetails.getInstancesByProject('proj-deleted'),
      volumes: db.cloudDetails.getVolumesByProject('proj-deleted', '2026-09-01', '2026-09-30'),
      servers: db.inventory.getAllServers(),
      vps: db.inventory.getAllVps(),
    }).toEqual({
      bills: [], billLines: [], projects: [], instances: [], volumes: [], servers: [], vps: [],
    });
  });

  // Only the latest balance and consumption snapshots are read, which the import fetches
  // again, as it fetches every credit movement and the consumption history
  test('clears the account and consumption snapshots, which it imports again', async () => {
    db.account.insertBalance({
      debt_balance: 0, credit_balance: 50, deposit_total: 0, currency: 'EUR',
    });
    db.account.insertCreditMovement({
      id: 'b1_m1', balance_name: 'b1', amount: 50, date: '2026-09-01', description: 'Voucher',
      movement_type: 'credit',
    });
    db.consumption.insertSnapshot({
      period_start: '2026-09-01', period_end: '2026-09-15', current_total: 100,
      forecast_total: 200, currency: 'EUR', raw_data: '{}',
    });
    db.consumption.insertHistory({
      period_start: '2026-08-01', period_end: '2026-08-31', service_type: 'cloud', total: 90,
      currency: 'EUR', raw_data: '{}',
    });
    serveProjects();

    await importFull();

    expect({
      balance: db.account.getLatestBalance(),
      credits: db.account.getCreditMovements(),
      snapshot: db.consumption.getLatestSnapshot(),
      history: db.consumption.getHistory(),
    }).toEqual({ balance: undefined, credits: [], snapshot: undefined, history: [] });
  });
});
