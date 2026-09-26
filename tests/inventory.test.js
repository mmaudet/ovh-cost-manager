/**
 * Tests for inventory and cloud detail database operations, through the functions of
 * data/db.js on a throwaway database
 * Phase 3: Dedicated servers, VPS, storage inventory
 * Phase 4: Cloud project consumption, instances, quotas
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let dataDir;
const previousDataDir = process.env.DATA_DIR;

// A date some days from today, as the inventory stores an expiration date
function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// A dedicated server, as the inventory import stores it
const server = (fields) => ({
  id: 'ns123.ovh.net', display_name: 'My Server', reverse: 'ns123.ovh.net', datacenter: 'rbx2',
  os: 'debian11', state: 'ok', cpu: 'Intel Xeon E-2386G', ram_size: 65536,
  disk_info: '[{"type":"SSD","capacity":480,"count":2}]', bandwidth: 1000,
  expiration_date: '2025-06-15', renewal_type: 'automatic', ...fields,
});

// A service of the inventory, as the dashboard reads it
const storedServer = (id) => db.inventory.getAllServers().find(s => s.id === id);
const storedVps = (id) => db.inventory.getAllVps().find(v => v.id === id);

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-inventory-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');

  // Seed a project for FK constraints
  db.projects.upsert({
    id: 'proj-001', name: 'Test Project', description: 'A test project', status: 'ok',
    created_at: null,
  });
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

describe('Dedicated Servers (Phase 3)', () => {
  test('inserts a dedicated server', () => {
    db.inventory.upsertServer(server());

    const stored = storedServer('ns123.ovh.net');
    expect(stored).toBeTruthy();
    expect(stored.display_name).toBe('My Server');
    expect(stored.datacenter).toBe('rbx2');
    expect(stored.ram_size).toBe(65536);
    expect(stored.state).toBe('ok');
  });

  test('disk_info is valid JSON', () => {
    const disks = JSON.parse(storedServer('ns123.ovh.net').disk_info);
    expect(disks).toHaveLength(1);
    expect(disks[0].type).toBe('SSD');
    expect(disks[0].capacity).toBe(480);
  });

  test('upserts on conflict', () => {
    db.inventory.upsertServer(server({
      display_name: 'Updated Server', os: 'debian12', disk_info: '[]',
      expiration_date: '2026-06-15',
    }));

    expect(db.inventory.getAllServers()).toHaveLength(1);
    const stored = storedServer('ns123.ovh.net');
    expect(stored.display_name).toBe('Updated Server');
    expect(stored.os).toBe('debian12');
  });
});

describe('VPS Instances (Phase 3)', () => {
  test('inserts a VPS', () => {
    db.inventory.upsertVps({
      id: 'vps-abc123.vps.ovh.net', display_name: 'My VPS', model: 'VPS Value 2-4-80',
      zone: 'EU', state: 'running', os: 'Ubuntu 22.04', vcpus: 2, ram_mb: 4096, disk_gb: 80,
      expiration_date: '2025-12-31', renewal_type: 'automatic', ip_addresses: '["1.2.3.4"]',
    });

    const vps = storedVps('vps-abc123.vps.ovh.net');
    expect(vps).toBeTruthy();
    expect(vps.vcpus).toBe(2);
    expect(vps.ram_mb).toBe(4096);
    expect(vps.state).toBe('running');
  });

  test('ip_addresses is valid JSON', () => {
    const ips = JSON.parse(storedVps('vps-abc123.vps.ovh.net').ip_addresses);
    expect(ips).toContain('1.2.3.4');
  });
});

describe('Storage Services (Phase 3)', () => {
  test('inserts a storage service', () => {
    db.inventory.upsertStorage({
      id: 'netapp-001', service_type: 'netapp', display_name: 'Production NetApp',
      region: 'GRA', total_size_gb: 1024, used_size_gb: 512, share_count: 3,
      expiration_date: '2025-09-01',
    });

    const storage = db.inventory.getAllStorage().find(s => s.id === 'netapp-001');
    expect(storage).toBeTruthy();
    expect(storage.service_type).toBe('netapp');
    expect(storage.total_size_gb).toBe(1024);
    expect(storage.share_count).toBe(3);
  });
});

describe('Bill Details resource_type (Phase 3)', () => {
  test('stores resource_type on bill details', () => {
    db.bills.upsert({
      id: 'FR100', date: '2025-01-01', price_without_tax: 100, price_with_tax: 120, tax: 20,
      currency: 'EUR', pdf_url: null, html_url: null,
    });
    db.details.insertMany([
      {
        id: 'FR100_1', bill_id: 'FR100', project_id: 'proj-001', domain: 'proj-001',
        description: 'Instance b2-7', quantity: 720, unit_price: 0.05, total_price: 36.00,
        service_type: 'Compute', resource_type: 'cloud_project',
      },
      {
        id: 'FR100_2', bill_id: 'FR100', project_id: null, domain: 'ns123.ovh.net',
        description: 'Dedicated server rental', quantity: 1, unit_price: 100, total_price: 100,
        service_type: 'Other', resource_type: 'dedicated_server',
      },
    ]);

    const details = db.details.getByBillId('FR100');
    expect(details).toHaveLength(2);

    const cloud = details.find(d => d.id === 'FR100_1');
    expect(cloud.resource_type).toBe('cloud_project');

    const dedicated = details.find(d => d.id === 'FR100_2');
    expect(dedicated.resource_type).toBe('dedicated_server');
  });

  test('aggregates costs by resource_type', () => {
    const result = db.inventory.byResourceType('2025-01-01', '2025-12-31');

    expect(result.length).toBe(2);
    expect(result[0].resource_type).toBe('dedicated_server');
    expect(result[0].total).toBe(100);
    expect(result[1].resource_type).toBe('cloud_project');
    expect(result[1].total).toBe(36);
  });
});

describe('Cloud Instances (Phase 4)', () => {
  test('inserts cloud instances', () => {
    db.cloudDetails.upsertInstance({
      id: 'inst-001', project_id: 'proj-001', name: 'web-server-1', flavor: 'b2-7',
      region: 'GRA7', status: 'ACTIVE', created_at: '2025-01-01T00:00:00Z', monthly_billing: 1,
    });

    const inst = db.cloudDetails.getInstancesByProject('proj-001')
      .find(i => i.id === 'inst-001');
    expect(inst).toBeTruthy();
    expect(inst.name).toBe('web-server-1');
    expect(inst.flavor).toBe('b2-7');
    expect(inst.monthly_billing).toBe(1);
  });
});

describe('Project Quotas (Phase 4)', () => {
  test('inserts project quotas', () => {
    db.cloudDetails.insertQuota({
      project_id: 'proj-001', region: 'GRA7', max_cores: 200, max_instances: 50,
      max_ram_mb: 200000, used_cores: 8, used_instances: 3, used_ram_mb: 28672,
    });

    const [quota] = db.cloudDetails.getQuotasByProject('proj-001');
    expect(quota).toBeTruthy();
    expect(quota.max_cores).toBe(200);
    expect(quota.used_cores).toBe(8);
    expect(quota.max_ram_mb).toBe(200000);
  });

  test('quota utilization calculation', () => {
    const [quota] = db.cloudDetails.getQuotasByProject('proj-001');
    const coreUsage = (quota.used_cores / quota.max_cores) * 100;
    const instanceUsage = (quota.used_instances / quota.max_instances) * 100;
    expect(coreUsage).toBe(4);
    expect(instanceUsage).toBe(6);
  });
});

describe('Project Consumption (Phase 4)', () => {
  // What a project consumed in January 2025, as the import stores it
  const consumption = (fields) => ({
    project_id: 'proj-001', period_start: '2025-01-01', period_end: '2025-01-31',
    region: 'GRA7', ...fields,
  });

  test('inserts project consumption', () => {
    db.cloudDetails.insertConsumption(consumption({
      resource_type: 'instance', resource_id: 'inst-001', resource_name: 'b2-7', quantity: 720,
      unit: 'hour', unit_price: 0.05, total_price: 36.00,
    }));

    const stored = db.cloudDetails
      .getConsumptionByProject('proj-001', '2025-01-01', '2025-01-31');
    expect(stored.length).toBe(1);
    expect(stored[0].total_price).toBe(36.00);
    expect(stored[0].resource_type).toBe('instance');
  });

  // Of the current month: the latest one stored, without any import that recorded its own
  test('aggregates consumption by resource type', () => {
    db.cloudDetails.insertConsumption(consumption({
      resource_type: 'volume', resource_id: 'vol-001', resource_name: 'high-speed',
      quantity: 100, unit: 'GB', unit_price: 0.10, total_price: 10.00,
    }));

    const result = db.cloudDetails.getConsumptionByResourceType('proj-001');

    expect(result.length).toBe(2);
    expect(result[0].resource_type).toBe('instance');
    expect(result[0].total).toBe(36.00);
    expect(result[1].resource_type).toBe('volume');
    expect(result[1].total).toBe(10.00);
  });
});

describe('Expiring Services (Phase 5)', () => {
  test('finds services expiring within 30 days', () => {
    db.inventory.upsertServer(server({
      id: 'expiring-srv', display_name: 'Expiring Server', datacenter: 'rbx1',
      expiration_date: daysFromNow(15), renewal_type: 'manual',
    }));

    const found = db.inventory.getExpiringServices(30).find(s => s.id === 'expiring-srv');
    expect(found).toBeTruthy();
    expect(found.display_name).toBe('Expiring Server');
  });

  test('does not include services expiring beyond 30 days', () => {
    db.inventory.upsertServer(server({
      id: 'safe-srv', display_name: 'Safe Server', datacenter: 'gra1',
      expiration_date: daysFromNow(90),
    }));

    const found = db.inventory.getExpiringServices(30).find(s => s.id === 'safe-srv');
    expect(found).toBeUndefined();
  });
});
