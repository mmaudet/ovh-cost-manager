/**
 * Tests for the services about to expire, which the Overview lists and its header counts
 * through /api/inventory/expiring: the dedicated servers, VPS and storage services of the
 * inventory whose expiration date falls within a number of days, on a throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('services about to expire', () => {
  let db;
  let dataDir;

  // A service of each inventory, with its expiration date, null when it is not known
  const server = (id, displayName, expirationDate) => db.inventory.upsertServer({
    id, display_name: displayName, reverse: id, datacenter: 'rbx8', os: 'debian12_64',
    state: 'ok', cpu: 'Intel Xeon-E 2388G', ram_size: 65536, disk_info: '[]', bandwidth: 1000,
    expiration_date: expirationDate, renewal_type: 'automatic',
  });
  const vps = (id, displayName, expirationDate) => db.inventory.upsertVps({
    id, display_name: displayName, model: 'vps-le-2-2-40', zone: 'Region OpenStack: os-gra7',
    state: 'running', os: '', vcpus: 2, ram_mb: 2048, disk_gb: 40,
    expiration_date: expirationDate, renewal_type: 'automatic', ip_addresses: '[]',
  });
  const storage = (id, displayName, expirationDate) => db.inventory.upsertStorage({
    id, service_type: 'netapp', display_name: displayName, region: 'eu-west-gra',
    total_size_gb: 1024, used_size_gb: 0, share_count: 3, expiration_date: expirationDate,
  });

  // A service of the list, as /api/inventory/expiring answers
  const expiring = (type, id, displayName, expirationDate) => ({
    id, display_name: displayName, type, expiration_date: expirationDate,
  });

  beforeAll(() => {
    // "Today", as in the dashboard tests: Tuesday 15 September 2026, noon in Paris
    jest.useFakeTimers({ now: new Date('2026-09-15T10:00:00Z') });
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-expiring-'));
    process.env.DATA_DIR = dataDir;
    db = require('../data/db');

    server('ns3000001.ip-203-0-113.eu', 'backup-server', '2026-10-10');
    server('ns3000003.ip-203-0-113.eu', 'db-server', '2026-09-17');
    // After the 30 days, and not known yet
    server('ns3000004.ip-203-0-113.eu', 'archive-server', '2026-12-01');
    server('ns3000002.ip-198-51-100.eu', 'ns3000002.ip-198-51-100.eu', null);
    vps('vps-0a1b2c3d.vps.ovh.net', 'vps-0a1b2c3d.vps.ovh.net', '2026-10-10');
    // Expired five days ago
    vps('vps-2c3d4e5f.vps.ovh.net', 'legacy-vps', '2026-09-10');
    storage('netapp-8c9d0e1f', 'archives-nas', '2026-10-02');
    // Expired on the last day of August
    storage('netapp-7a6b5c4d', 'old-nas', '2026-08-31');
  });

  afterAll(() => {
    jest.useRealTimers();
    db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // #74: the list gave the servers, then the VPS, then the storage services, each by date,
  // and the Overview showed the first five of them rather than the five soonest
  test('lists the services of the three inventories in one list, soonest first', () => {
    expect(db.inventory.getExpiringServices(30)).toEqual([
      // Already expired: they stay in the list, first
      expiring('storage', 'netapp-7a6b5c4d', 'old-nas', '2026-08-31'),
      expiring('vps', 'vps-2c3d4e5f.vps.ovh.net', 'legacy-vps', '2026-09-10'),
      expiring('dedicated_server', 'ns3000003.ip-203-0-113.eu', 'db-server', '2026-09-17'),
      expiring('storage', 'netapp-8c9d0e1f', 'archives-nas', '2026-10-02'),
      // On the same day, in the order of the inventories: servers, VPS, then storage
      expiring('dedicated_server', 'ns3000001.ip-203-0-113.eu', 'backup-server', '2026-10-10'),
      expiring('vps', 'vps-0a1b2c3d.vps.ovh.net', 'vps-0a1b2c3d.vps.ovh.net', '2026-10-10'),
    ]);
  });
});
