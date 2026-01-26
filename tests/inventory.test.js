/**
 * Tests for inventory and cloud detail database operations
 * Phase 3: Dedicated servers, VPS, storage inventory
 * Phase 4: Cloud project consumption, instances, quotas
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;
let testDbPath;

beforeAll(() => {
  testDbPath = path.join(__dirname, 'test-inventory.db');
  db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'data', 'schema.sql'), 'utf8');
  db.exec(schema);

  // Add migration columns
  try { db.exec('ALTER TABLE bill_details ADD COLUMN resource_type TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_type TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_date DATETIME'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_status TEXT'); } catch(e) {}

  // Seed a project for FK constraints
  db.prepare(`
    INSERT INTO projects (id, name, description, status)
    VALUES ('proj-001', 'Test Project', 'A test project', 'ok')
  `).run();
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(testDbPath); } catch(e) {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch(e) {}
});

describe('Dedicated Servers (Phase 3)', () => {
  test('inserts a dedicated server', () => {
    db.prepare(`
      INSERT INTO dedicated_servers (id, display_name, reverse, datacenter, os, state, cpu, ram_size, disk_info, bandwidth, expiration_date, renewal_type)
      VALUES ('ns123.ovh.net', 'My Server', 'ns123.ovh.net', 'rbx2', 'debian11', 'ok', 'Intel Xeon E-2386G', 65536, '[{"type":"SSD","capacity":480,"count":2}]', 1000, '2025-06-15', 'automatic')
    `).run();

    const server = db.prepare('SELECT * FROM dedicated_servers WHERE id = ?').get('ns123.ovh.net');
    expect(server).toBeTruthy();
    expect(server.display_name).toBe('My Server');
    expect(server.datacenter).toBe('rbx2');
    expect(server.ram_size).toBe(65536);
    expect(server.state).toBe('ok');
  });

  test('disk_info is valid JSON', () => {
    const server = db.prepare('SELECT disk_info FROM dedicated_servers WHERE id = ?').get('ns123.ovh.net');
    const disks = JSON.parse(server.disk_info);
    expect(disks).toHaveLength(1);
    expect(disks[0].type).toBe('SSD');
    expect(disks[0].capacity).toBe(480);
  });

  test('upserts on conflict', () => {
    db.prepare(`
      INSERT INTO dedicated_servers (id, display_name, reverse, datacenter, os, state, cpu, ram_size, disk_info, bandwidth, expiration_date, renewal_type)
      VALUES ('ns123.ovh.net', 'Updated Server', 'ns123.ovh.net', 'rbx2', 'debian12', 'ok', 'Intel Xeon E-2386G', 65536, '[]', 1000, '2026-06-15', 'automatic')
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, os = excluded.os, expiration_date = excluded.expiration_date
    `).run();

    const server = db.prepare('SELECT * FROM dedicated_servers WHERE id = ?').get('ns123.ovh.net');
    expect(server.display_name).toBe('Updated Server');
    expect(server.os).toBe('debian12');
  });
});

describe('VPS Instances (Phase 3)', () => {
  test('inserts a VPS', () => {
    db.prepare(`
      INSERT INTO vps_instances (id, display_name, model, zone, state, os, vcpus, ram_mb, disk_gb, expiration_date, renewal_type, ip_addresses)
      VALUES ('vps-abc123.vps.ovh.net', 'My VPS', 'VPS Value 2-4-80', 'EU', 'running', 'Ubuntu 22.04', 2, 4096, 80, '2025-12-31', 'automatic', '["1.2.3.4"]')
    `).run();

    const vps = db.prepare('SELECT * FROM vps_instances WHERE id = ?').get('vps-abc123.vps.ovh.net');
    expect(vps).toBeTruthy();
    expect(vps.vcpus).toBe(2);
    expect(vps.ram_mb).toBe(4096);
    expect(vps.state).toBe('running');
  });

  test('ip_addresses is valid JSON', () => {
    const vps = db.prepare('SELECT ip_addresses FROM vps_instances WHERE id = ?').get('vps-abc123.vps.ovh.net');
    const ips = JSON.parse(vps.ip_addresses);
    expect(ips).toContain('1.2.3.4');
  });
});

describe('Storage Services (Phase 3)', () => {
  test('inserts a storage service', () => {
    db.prepare(`
      INSERT INTO storage_services (id, service_type, display_name, region, total_size_gb, used_size_gb, share_count, expiration_date)
      VALUES ('netapp-001', 'netapp', 'Production NetApp', 'GRA', 1024, 512, 3, '2025-09-01')
    `).run();

    const storage = db.prepare('SELECT * FROM storage_services WHERE id = ?').get('netapp-001');
    expect(storage).toBeTruthy();
    expect(storage.service_type).toBe('netapp');
    expect(storage.total_size_gb).toBe(1024);
    expect(storage.share_count).toBe(3);
  });
});

describe('Bill Details resource_type (Phase 3)', () => {
  test('stores resource_type on bill details', () => {
    db.prepare(`
      INSERT INTO bills (id, date, price_without_tax, price_with_tax, tax)
      VALUES ('FR100', '2025-01-01', 100, 120, 20)
    `).run();

    db.prepare(`
      INSERT INTO bill_details (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type, resource_type)
      VALUES ('FR100_1', 'FR100', 'proj-001', 'proj-001', 'Instance b2-7', 720, 0.05, 36.00, 'Compute', 'cloud_project')
    `).run();

    db.prepare(`
      INSERT INTO bill_details (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type, resource_type)
      VALUES ('FR100_2', 'FR100', NULL, 'ns123.ovh.net', 'Dedicated server rental', 1, 100, 100, 'Other', 'dedicated_server')
    `).run();

    const details = db.prepare('SELECT * FROM bill_details WHERE bill_id = ?').all('FR100');
    expect(details).toHaveLength(2);

    const cloud = details.find(d => d.id === 'FR100_1');
    expect(cloud.resource_type).toBe('cloud_project');

    const dedicated = details.find(d => d.id === 'FR100_2');
    expect(dedicated.resource_type).toBe('dedicated_server');
  });

  test('aggregates costs by resource_type', () => {
    const result = db.prepare(`
      SELECT
        COALESCE(d.resource_type, 'other') as resource_type,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= '2025-01-01' AND b.date <= '2025-12-31'
      GROUP BY d.resource_type
      ORDER BY total DESC
    `).all();

    expect(result.length).toBe(2);
    expect(result[0].resource_type).toBe('dedicated_server');
    expect(result[0].total).toBe(100);
    expect(result[1].resource_type).toBe('cloud_project');
    expect(result[1].total).toBe(36);
  });
});

describe('Cloud Instances (Phase 4)', () => {
  test('inserts cloud instances', () => {
    db.prepare(`
      INSERT INTO cloud_instances (id, project_id, name, flavor, region, status, created_at, monthly_billing)
      VALUES ('inst-001', 'proj-001', 'web-server-1', 'b2-7', 'GRA7', 'ACTIVE', '2025-01-01T00:00:00Z', 1)
    `).run();

    const inst = db.prepare('SELECT * FROM cloud_instances WHERE id = ?').get('inst-001');
    expect(inst).toBeTruthy();
    expect(inst.name).toBe('web-server-1');
    expect(inst.flavor).toBe('b2-7');
    expect(inst.monthly_billing).toBe(1);
  });
});

describe('Project Quotas (Phase 4)', () => {
  test('inserts project quotas', () => {
    db.prepare(`
      INSERT INTO project_quotas (project_id, region, max_cores, max_instances, max_ram_mb, used_cores, used_instances, used_ram_mb)
      VALUES ('proj-001', 'GRA7', 200, 50, 200000, 8, 3, 28672)
    `).run();

    const quota = db.prepare('SELECT * FROM project_quotas WHERE project_id = ?').get('proj-001');
    expect(quota).toBeTruthy();
    expect(quota.max_cores).toBe(200);
    expect(quota.used_cores).toBe(8);
    expect(quota.max_ram_mb).toBe(200000);
  });

  test('quota utilization calculation', () => {
    const quota = db.prepare('SELECT * FROM project_quotas WHERE project_id = ?').get('proj-001');
    const coreUsage = (quota.used_cores / quota.max_cores) * 100;
    const instanceUsage = (quota.used_instances / quota.max_instances) * 100;
    expect(coreUsage).toBe(4);
    expect(instanceUsage).toBe(6);
  });
});

describe('Project Consumption (Phase 4)', () => {
  test('inserts project consumption', () => {
    db.prepare(`
      INSERT INTO project_consumption (project_id, period_start, period_end, resource_type, resource_id, resource_name, quantity, unit, unit_price, total_price, region)
      VALUES ('proj-001', '2025-01-01', '2025-01-31', 'instance', 'inst-001', 'b2-7', 720, 'hour', 0.05, 36.00, 'GRA7')
    `).run();

    const consumption = db.prepare('SELECT * FROM project_consumption WHERE project_id = ?').all('proj-001');
    expect(consumption.length).toBe(1);
    expect(consumption[0].total_price).toBe(36.00);
    expect(consumption[0].resource_type).toBe('instance');
  });

  test('aggregates consumption by resource type', () => {
    db.prepare(`
      INSERT INTO project_consumption (project_id, period_start, period_end, resource_type, resource_id, resource_name, quantity, unit, unit_price, total_price, region)
      VALUES ('proj-001', '2025-01-01', '2025-01-31', 'volume', 'vol-001', 'high-speed', 100, 'GB', 0.10, 10.00, 'GRA7')
    `).run();

    const result = db.prepare(`
      SELECT resource_type, SUM(total_price) as total
      FROM project_consumption
      WHERE project_id = ?
      GROUP BY resource_type
      ORDER BY total DESC
    `).all('proj-001');

    expect(result.length).toBe(2);
    expect(result[0].resource_type).toBe('instance');
    expect(result[0].total).toBe(36.00);
    expect(result[1].resource_type).toBe('volume');
    expect(result[1].total).toBe(10.00);
  });
});

describe('Expiring Services (Phase 5)', () => {
  test('finds services expiring within 30 days', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const expirationDate = futureDate.toISOString().split('T')[0];

    db.prepare(`
      INSERT OR REPLACE INTO dedicated_servers (id, display_name, datacenter, state, expiration_date, renewal_type)
      VALUES ('expiring-srv', 'Expiring Server', 'rbx1', 'ok', ?, 'manual')
    `).run(expirationDate);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const expiring = db.prepare(
      "SELECT id, display_name, 'dedicated_server' as type, expiration_date FROM dedicated_servers WHERE expiration_date IS NOT NULL AND expiration_date <= ?"
    ).all(cutoffStr);

    const found = expiring.find(s => s.id === 'expiring-srv');
    expect(found).toBeTruthy();
    expect(found.display_name).toBe('Expiring Server');
  });

  test('does not include services expiring beyond 30 days', () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 90);
    const expirationDate = farFuture.toISOString().split('T')[0];

    db.prepare(`
      INSERT OR REPLACE INTO dedicated_servers (id, display_name, datacenter, state, expiration_date, renewal_type)
      VALUES ('safe-srv', 'Safe Server', 'gra1', 'ok', ?, 'automatic')
    `).run(expirationDate);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const expiring = db.prepare(
      "SELECT id FROM dedicated_servers WHERE expiration_date IS NOT NULL AND expiration_date <= ?"
    ).all(cutoffStr);

    const found = expiring.find(s => s.id === 'safe-srv');
    expect(found).toBeUndefined();
  });
});
