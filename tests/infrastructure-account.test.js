/**
 * The account parameter of the routes behind the Infrastructure tab (#123), on the server
 * started in a child process over a database that the test seeds with several accounts: the
 * inventories of dedicated servers, VPS and storage services, their summary, the services
 * about to expire, which the Overview and the header show, and the bill lines of a resource
 * type, such as the Private Cloud hosts, by service. As on the header's routes (#115,
 * see account-parameter.test.js), a NIC handle that the accounts table records selects that
 * account's services, the reserved value `unknown` the services without an account (the
 * Unknown account), and no parameter those of every account, as before. Any other value is
 * refused. Each service names its account, and a service that two accounts' APIs list is
 * stored once, as the service of the account that holds it (ADR 0002): it is listed once.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A date some days from today, as the inventory stores an expiration date: the server tells
// the services about to expire from the real date
const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};
// After the 30 days of the services about to expire
const LATER = daysFromNow(90);

// A service of each inventory, as an account's import stores it, with its expiration date
const server = (db, id, displayName, account, expirationDate = LATER) =>
  db.inventory.upsertServer({
    id, display_name: displayName, reverse: id, datacenter: 'rbx8', os: 'debian12_64',
    state: 'ok', cpu: 'Intel Xeon-E 2388G', ram_size: 65536, disk_info: '[]', bandwidth: 1000,
    expiration_date: expirationDate, renewal_type: 'automatic', account,
  });
const vps = (db, id, displayName, account, expirationDate = LATER) => db.inventory.upsertVps({
  id, display_name: displayName, model: 'vps-le-2-2-40', zone: 'Region OpenStack: os-gra7',
  state: 'running', os: 'Debian 12', vcpus: 2, ram_mb: 2048, disk_gb: 40,
  expiration_date: expirationDate, renewal_type: 'automatic', ip_addresses: '["192.0.2.10"]',
  account,
});
const storage = (db, id, displayName, account, expirationDate = LATER) =>
  db.inventory.upsertStorage({
    id, service_type: 'netapp', display_name: displayName, region: 'eu-west-gra',
    total_size_gb: 1024, used_size_gb: 0, share_count: 3, expiration_date: expirationDate,
    account,
  });
// A service of an inventory imported before OCM told accounts apart, and claimed by no
// account since: the writers refuse such rows now, so it is written as the database held it
const unclaimed = (db, table, id, displayName, expirationDate = LATER) => db.getDb().prepare(
  `INSERT INTO ${table} (id, display_name, expiration_date, account) VALUES (?, ?, ?, NULL)`,
).run(id, displayName, expirationDate);

// A bill line of a service outside Public Cloud, of a resource type
const line = (id, billId, service, resourceType, description, price) => ({
  id, bill_id: billId, project_id: null, domain: service, description, quantity: 1,
  unit_price: price, total_price: price, service_type: 'Other', resource_type: resourceType,
});
// A bill imported before OCM told accounts apart, and claimed by no account since, written as
// the database held it
const unclaimedBill = (db, id, date) => db.getDb().prepare(
  "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', NULL)",
).run(id, date);

// Two accounts, one that an import recorded without any service, and the Unknown account,
// whose services the imports before the accounts stored first. Every NIC handle, name and
// identifier is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  unclaimed(db, 'dedicated_servers', 'ns3000004.ip-203-0-113.eu', 'legacy-server',
    daysFromNow(10));
  unclaimed(db, 'vps_instances', 'vps-2c3d4e5f.vps.ovh.net', 'legacy-vps', null);
  unclaimed(db, 'storage_services', 'netapp-7a6b5c4d', 'old-nas', daysFromNow(-3));
  server(db, 'ns3000005.ip-198-51-100.eu', 'app-server', PARIS, daysFromNow(10));
  server(db, 'ns3000001.ip-203-0-113.eu', 'backup-server', LYON);
  server(db, 'ns3000003.ip-203-0-113.eu', 'db-server', LYON, daysFromNow(10));
  // Both accounts' APIs list it: stored once, as the service of Lyon, whose import stored it
  // first (ADR 0002)
  server(db, 'ns3000002.ip-198-51-100.eu', 'shared-server', LYON, daysFromNow(5));
  server(db, 'ns3000002.ip-198-51-100.eu', 'shared-server', PARIS, daysFromNow(5));
  vps(db, 'vps-0a1b2c3d.vps.ovh.net', 'vps-0a1b2c3d.vps.ovh.net', LYON, daysFromNow(-3));
  vps(db, 'vps-4e5f6a7b.vps.ovh.net', 'staging-vps', PARIS, daysFromNow(10));
  storage(db, 'netapp-8c9d0e1f', 'archives-nas', LYON, daysFromNow(20));
  storage(db, 'netapp-5f2c9a1e', 'shared-files', PARIS);
  // A Public Cloud project of each, which the summary of the inventories counts
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  db.getDb().prepare(
    "INSERT INTO projects (id, name, account) VALUES ('project-legacy', 'Legacy', NULL)",
  ).run();

  // What September billed of the servers and of a Private Cloud host. The shared server moved
  // from Lyon to Paris: Lyon paid its rental, Paris an option of it.
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  unclaimedBill(db, 'FR0001', '2026-09-20');
  db.details.insertMany([
    line('FR1001-1', 'FR1001', 'ns3000001.ip-203-0-113.eu', 'dedicated_server',
      'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', 200),
    line('FR1001-2', 'FR1001', 'ns3000002.ip-198-51-100.eu', 'dedicated_server',
      'Location du serveur ADVANCE-1 ns3000002.ip-198-51-100.eu - 1 mois', 100),
    line('FR1001-3', 'FR1001', 'pcc-203-0-113-10/host/1234', 'private_cloud_host',
      'Host Private Cloud 96 Go pcc-203-0-113-10 - 1 mois', 700),
    line('FR2001-1', 'FR2001', 'ns3000005.ip-198-51-100.eu', 'dedicated_server',
      'Location du serveur RISE-2 ns3000005.ip-198-51-100.eu - 1 mois', 150),
    line('FR2001-2', 'FR2001', 'ns3000002.ip-198-51-100.eu', 'dedicated_server',
      'Option IP failover ns3000002.ip-198-51-100.eu - 1 mois', 60),
    line('FR0001-1', 'FR0001', 'ns3000004.ip-203-0-113.eu', 'dedicated_server',
      'Location du serveur KS-1 ns3000004.ip-203-0-113.eu - 1 mois', 80),
  ]);
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// The services of an answer, in its order, as [id, account]
const listed = ({ status, body }) => ({
  status, body: body.map(({ id, account }) => [id, account]),
});
// The answer of a route of the inventories, for the account that the parameter names, or for
// every account without one
const inventoryOf = async (route, account) =>
  listed(await ocm.get(`${route}${account === undefined ? '' : `?account=${account}`}`));

describe('GET /api/inventory/servers', () => {
  const route = '/api/inventory/servers';

  // By name, as before, each with the NIC handle of its account, null for the Unknown account
  test('lists the servers of every account without the parameter, each with its account',
    async () => {
      expect(await inventoryOf(route)).toEqual({
        status: 200,
        body: [
          ['ns3000005.ip-198-51-100.eu', PARIS],
          ['ns3000001.ip-203-0-113.eu', LYON],
          ['ns3000003.ip-203-0-113.eu', LYON],
          ['ns3000004.ip-203-0-113.eu', null],
          ['ns3000002.ip-198-51-100.eu', LYON],
        ],
      });
    });

  test('lists the servers of the account whose NIC handle it gives', async () => {
    expect(await inventoryOf(route, LYON)).toEqual({
      status: 200,
      body: [
        ['ns3000001.ip-203-0-113.eu', LYON],
        ['ns3000003.ip-203-0-113.eu', LYON],
        ['ns3000002.ip-198-51-100.eu', LYON],
      ],
    });
    // Not the server that its API lists too, which Lyon holds
    expect(await inventoryOf(route, PARIS)).toEqual({
      status: 200, body: [['ns3000005.ip-198-51-100.eu', PARIS]],
    });
  });

  test('lists the servers of the Unknown account: those without an account', async () => {
    expect(await inventoryOf(route, UNKNOWN_ACCOUNT)).toEqual({
      status: 200, body: [['ns3000004.ip-203-0-113.eu', null]],
    });
  });

  test('lists no server for an account recorded without one', async () => {
    expect(await inventoryOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/inventory/vps', () => {
  const route = '/api/inventory/vps';

  test('lists the VPS of every account without the parameter, each with its account',
    async () => {
      expect(await inventoryOf(route)).toEqual({
        status: 200,
        body: [
          ['vps-2c3d4e5f.vps.ovh.net', null],
          ['vps-4e5f6a7b.vps.ovh.net', PARIS],
          ['vps-0a1b2c3d.vps.ovh.net', LYON],
        ],
      });
    });

  test('lists the VPS of the account whose NIC handle it gives, or of the Unknown account',
    async () => {
      expect(await inventoryOf(route, LYON))
        .toEqual({ status: 200, body: [['vps-0a1b2c3d.vps.ovh.net', LYON]] });
      expect(await inventoryOf(route, PARIS))
        .toEqual({ status: 200, body: [['vps-4e5f6a7b.vps.ovh.net', PARIS]] });
      expect(await inventoryOf(route, UNKNOWN_ACCOUNT))
        .toEqual({ status: 200, body: [['vps-2c3d4e5f.vps.ovh.net', null]] });
      expect(await inventoryOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
    });
});

describe('GET /api/inventory/storage', () => {
  const route = '/api/inventory/storage';

  test('lists the storage services of every account without the parameter, each with its '
    + 'account', async () => {
    expect(await inventoryOf(route)).toEqual({
      status: 200,
      body: [
        ['netapp-8c9d0e1f', LYON],
        ['netapp-7a6b5c4d', null],
        ['netapp-5f2c9a1e', PARIS],
      ],
    });
  });

  test('lists the storage services of the account whose NIC handle it gives, or of the '
    + 'Unknown account', async () => {
    expect(await inventoryOf(route, LYON))
      .toEqual({ status: 200, body: [['netapp-8c9d0e1f', LYON]] });
    expect(await inventoryOf(route, PARIS))
      .toEqual({ status: 200, body: [['netapp-5f2c9a1e', PARIS]] });
    expect(await inventoryOf(route, UNKNOWN_ACCOUNT))
      .toEqual({ status: 200, body: [['netapp-7a6b5c4d', null]] });
    expect(await inventoryOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/inventory/expiring', () => {
  // The answer for the services that expire within some days, of the account that the
  // parameter names, or of every account without one
  const expiringOf = (parameters = '') => ocm.get(`/api/inventory/expiring?${parameters}`);
  // A service about to expire, as the route lists it, with its account
  const expiring = (type, id, displayName, days, account) => ({
    id, display_name: displayName, type, expiration_date: daysFromNow(days), account,
  });
  const lyonVps = expiring('vps', 'vps-0a1b2c3d.vps.ovh.net', 'vps-0a1b2c3d.vps.ovh.net', -3,
    LYON);
  const oldNas = expiring('storage', 'netapp-7a6b5c4d', 'old-nas', -3, null);
  const sharedServer = expiring('dedicated_server', 'ns3000002.ip-198-51-100.eu',
    'shared-server', 5, LYON);
  const dbServer = expiring('dedicated_server', 'ns3000003.ip-203-0-113.eu', 'db-server', 10,
    LYON);
  const appServer = expiring('dedicated_server', 'ns3000005.ip-198-51-100.eu', 'app-server',
    10, PARIS);
  const legacyServer = expiring('dedicated_server', 'ns3000004.ip-203-0-113.eu',
    'legacy-server', 10, null);
  const stagingVps = expiring('vps', 'vps-4e5f6a7b.vps.ovh.net', 'staging-vps', 10, PARIS);
  const archivesNas = expiring('storage', 'netapp-8c9d0e1f', 'archives-nas', 20, LYON);

  // Soonest first, those already expired first; on the same day, the servers, the VPS and
  // then the storage services, as before, and the services of one inventory by the NIC handle
  // of their account, the Unknown account's last, whatever order they were stored in. The
  // server that both accounts' APIs list comes once.
  test('lists the services of every account without the parameter, each with its account',
    async () => {
      expect(await expiringOf('days=30')).toEqual({
        status: 200,
        body: [
          lyonVps, oldNas, sharedServer, dbServer, appServer, legacyServer, stagingVps,
          archivesNas,
        ],
      });
    });

  test('lists the services of the account whose NIC handle it gives', async () => {
    expect(await expiringOf(`days=30&account=${LYON}`)).toEqual({
      status: 200, body: [lyonVps, sharedServer, dbServer, archivesNas],
    });
    expect(await expiringOf(`days=30&account=${PARIS}`)).toEqual({
      status: 200, body: [appServer, stagingVps],
    });
    // Within fewer days
    expect(await expiringOf(`days=7&account=${LYON}`)).toEqual({
      status: 200, body: [lyonVps, sharedServer],
    });
  });

  test('lists those of the Unknown account, and none of an account without a service',
    async () => {
      expect(await expiringOf(`days=30&account=${UNKNOWN_ACCOUNT}`)).toEqual({
        status: 200, body: [oldNas, legacyServer],
      });
      expect(await expiringOf(`days=30&account=${NEW_ACCOUNT}`))
        .toEqual({ status: 200, body: [] });
    });

  // Over 30 days, as the dashboard asks for them
  test('lists the services of the next 30 days without a number of days', async () => {
    expect(await expiringOf(`account=${PARIS}`)).toEqual({
      status: 200, body: [appServer, stagingVps],
    });
  });
});

describe('GET /api/inventory/summary', () => {
  // How many services each inventory holds, and how many expire within 30 days
  const summary = (servers, vpsCount, storageCount, cloudProjects, expiringSoon) => ({
    servers,
    vps: vpsCount,
    storage: storageCount,
    cloud_projects: cloudProjects,
    total: servers + vpsCount + storageCount + cloudProjects,
    expiring_soon: expiringSoon,
  });
  const summaryOf = (account) => ocm.get(
    `/api/inventory/summary${account === undefined ? '' : `?account=${account}`}`,
  );

  test('counts the services of every account without the parameter', async () => {
    expect(await summaryOf()).toEqual({ status: 200, body: summary(5, 3, 3, 3, 8) });
  });

  test('counts the services of the account whose NIC handle it gives, or of the Unknown '
    + 'account', async () => {
    expect(await summaryOf(LYON)).toEqual({ status: 200, body: summary(3, 1, 1, 1, 4) });
    expect(await summaryOf(PARIS)).toEqual({ status: 200, body: summary(1, 1, 1, 1, 2) });
    expect(await summaryOf(UNKNOWN_ACCOUNT))
      .toEqual({ status: 200, body: summary(1, 1, 1, 1, 2) });
    expect(await summaryOf(NEW_ACCOUNT)).toEqual({ status: 200, body: summary(0, 0, 0, 0, 0) });
  });
});

// The dates of September, which every bill of the database is in
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

describe('GET /api/analysis/resource-type-details', () => {
  // The bill lines of a resource type in September, by service, for the account that the
  // parameters name, or for every account without one
  const detailsOf = (type, parameters = '') =>
    ocm.get(`/api/analysis/resource-type-details?type=${type}&${SEPTEMBER}${parameters}`);
  // A service as the route lists it: its most expensive line's wording, what its lines cost,
  // and how many they are
  const billed = (domain, description, total, lineCount) => ({
    domain, description, total, line_count: lineCount,
  });
  const ofAccount = (row, account) => ({ ...row, account });
  const rise1 = billed('ns3000001.ip-203-0-113.eu',
    'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', 200, 1);
  const rise2 = billed('ns3000005.ip-198-51-100.eu',
    'Location du serveur RISE-2 ns3000005.ip-198-51-100.eu - 1 mois', 150, 1);
  const ks1 = billed('ns3000004.ip-203-0-113.eu',
    'Location du serveur KS-1 ns3000004.ip-203-0-113.eu - 1 mois', 80, 1);
  // The server that moved, as each account billed it
  const advance1 = (description, total, lineCount) =>
    billed('ns3000002.ip-198-51-100.eu', description, total, lineCount);
  const lyonRental = 'Location du serveur ADVANCE-1 ns3000002.ip-198-51-100.eu - 1 mois';
  const parisOption = 'Option IP failover ns3000002.ip-198-51-100.eu - 1 mois';

  // The server that moved once, at what every account paid for it
  test('lists each service once for every account without the parameter, as before',
    async () => {
      const everyAccount = {
        status: 200, body: [rise1, advance1(lyonRental, 160, 2), rise2, ks1],
      };

      expect(await detailsOf('dedicated_server')).toEqual(everyAccount);
      expect(await detailsOf('dedicated_server', '&byAccount=false')).toEqual(everyAccount);
    });

  // For the list that names the account of each service: the server that moved comes for
  // each account that billed it, with the wording of its own lines
  test('lists each service for each account that billed it, with the account, when asked to',
    async () => {
      expect(await detailsOf('dedicated_server', '&byAccount=true')).toEqual({
        status: 200,
        body: [
          ofAccount(rise1, LYON),
          ofAccount(rise2, PARIS),
          ofAccount(advance1(lyonRental, 100, 1), LYON),
          ofAccount(ks1, null),
          ofAccount(advance1(parisOption, 60, 1), PARIS),
        ],
      });
    });

  test('lists the services that the bills of the account whose NIC handle it gives billed',
    async () => {
      expect(await detailsOf('dedicated_server', `&account=${LYON}`)).toEqual({
        status: 200, body: [rise1, advance1(lyonRental, 100, 1)],
      });
      // With the wording of the account's own lines
      expect(await detailsOf('dedicated_server', `&account=${PARIS}`)).toEqual({
        status: 200, body: [rise2, advance1(parisOption, 60, 1)],
      });
    });

  test('lists those of the Unknown account, and none of an account without a bill',
    async () => {
      expect(await detailsOf('dedicated_server', `&account=${UNKNOWN_ACCOUNT}`))
        .toEqual({ status: 200, body: [ks1] });
      expect(await detailsOf('dedicated_server', `&account=${NEW_ACCOUNT}`))
        .toEqual({ status: 200, body: [] });
    });

  // The Private Cloud hosts and datastores of the Infrastructure tab open their bill lines too
  test('lists the Private Cloud hosts of the account that billed them', async () => {
    const host = billed('pcc-203-0-113-10/host/1234',
      'Host Private Cloud 96 Go pcc-203-0-113-10 - 1 mois', 700, 1);

    expect(await detailsOf('private_cloud_host', `&account=${LYON}`))
      .toEqual({ status: 200, body: [host] });
    expect(await detailsOf('private_cloud_host', `&account=${PARIS}`))
      .toEqual({ status: 200, body: [] });
  });

  // Rather than list the services once, or by account, when a request asks for neither
  test.each([
    ['another value', 'byAccount=yes'],
    ['several values', 'byAccount=true&byAccount=true'],
  ])('refuses a byAccount parameter other than true or false, naming it: %s',
    async (_, parameter) => {
      expect(await detailsOf('dedicated_server', `&${parameter}`)).toEqual({
        status: 400, body: { error: "Invalid 'byAccount' parameter: expected true or false" },
      });
    });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused by the routes of the inventories, naming the parameter: %s',
    async (_, parameter) => {
      for (const route of [
        '/api/inventory/servers', '/api/inventory/vps', '/api/inventory/storage',
        '/api/inventory/summary', '/api/inventory/expiring',
        `/api/analysis/resource-type-details?type=dedicated_server&${SEPTEMBER}`,
      ]) {
        const separator = route.includes('?') ? '&' : '?';
        expect(await ocm.get(`${route}${separator}${parameter}`))
          .toEqual({ status: 400, body: REFUSED });
      }
    });
});

// A single-account installation gets the same answers as before an instance could import
// several accounts: each service with every field, the account included, which the routes of
// the inventories gave already, and which the services about to expire now give too. Its
// services belong to its account, or to none, as until the first import since the upgrade.
describe.each([
  ['whose every service belongs to its account', LYON],
  ['imported before OCM told accounts apart', null],
])('a single-account database %s', (_, account) => {
  // A server that expired, a VPS about to, and a storage service after the 30 days
  const EXPIRED = daysFromNow(-5);
  const SOON = daysFromNow(12);
  let single;

  beforeAll(async () => {
    single = await startOcm(() => ({}), {
      seed: (db) => {
        if (account !== null) db.accounts.upsert({ nic: account, currency: 'EUR' });
        // Written as the database holds them, the account included
        const insert = (table, row) => {
          const columns = Object.keys(row);
          db.getDb().prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map((column) => `@${column}`).join(', ')})
          `).run(row);
        };
        insert('dedicated_servers', {
          id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
          reverse: 'backup.example.com', datacenter: 'rbx8', os: 'debian12_64', state: 'ok',
          cpu: 'Intel Xeon-E 2388G', ram_size: 65536,
          disk_info: '[{"type":"NVMe","capacity":960,"count":2}]', bandwidth: 1000,
          expiration_date: EXPIRED, renewal_type: 'automatic',
          imported_at: '2026-09-14 04:01:10', account,
        });
        insert('vps_instances', {
          id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
          model: 'vps-le-2-2-40', zone: 'Region OpenStack: os-gra7', state: 'running',
          os: 'Debian 12', vcpus: 2, ram_mb: 2048, disk_gb: 40, expiration_date: SOON,
          renewal_type: 'automatic', ip_addresses: '["192.0.2.10"]',
          imported_at: '2026-09-14 04:01:15', account,
        });
        insert('storage_services', {
          id: 'netapp-5f2c9a1e', service_type: 'netapp', display_name: 'shared-files',
          region: 'eu-west-gra', total_size_gb: 1024, used_size_gb: 0, share_count: 3,
          expiration_date: LATER, imported_at: '2026-09-14 04:01:20', account,
        });
      },
    });
  }, 30000);

  afterAll(async () => {
    await single?.stop();
  });

  test('lists every service of the inventories without the parameter, as before', async () => {
    expect(await single.get('/api/inventory/servers')).toEqual({
      status: 200,
      body: [{
        id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
        reverse: 'backup.example.com', datacenter: 'rbx8', os: 'debian12_64', state: 'ok',
        cpu: 'Intel Xeon-E 2388G', ram_size: 65536,
        disk_info: [{ type: 'NVMe', capacity: 960, count: 2 }], bandwidth: 1000,
        expiration_date: EXPIRED, renewal_type: 'automatic',
        imported_at: '2026-09-14 04:01:10', account,
      }],
    });
    expect(await single.get('/api/inventory/vps')).toEqual({
      status: 200,
      body: [{
        id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
        model: 'vps-le-2-2-40', zone: 'Region OpenStack: os-gra7', state: 'running',
        os: 'Debian 12', vcpus: 2, ram_mb: 2048, disk_gb: 40, expiration_date: SOON,
        renewal_type: 'automatic', ip_addresses: ['192.0.2.10'],
        imported_at: '2026-09-14 04:01:15', account,
      }],
    });
    expect(await single.get('/api/inventory/storage')).toEqual({
      status: 200,
      body: [{
        id: 'netapp-5f2c9a1e', service_type: 'netapp', display_name: 'shared-files',
        region: 'eu-west-gra', total_size_gb: 1024, used_size_gb: 0, share_count: 3,
        expiration_date: LATER, imported_at: '2026-09-14 04:01:20', account,
      }],
    });
  });

  test('lists the same services about to expire, each with its account added', async () => {
    expect(await single.get('/api/inventory/expiring?days=30')).toEqual({
      status: 200,
      body: [
        {
          id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
          type: 'dedicated_server', expiration_date: EXPIRED, account,
        },
        {
          id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
          type: 'vps', expiration_date: SOON, account,
        },
      ],
    });
  });
});

// Services of the same name are listed by the NIC handle of their account, the Unknown
// account's last, whatever order the imports stored them in: here the Unknown account's
// first, then bb2222-ovh's, then aa1111-ovh's. The services of one account that share a name
// keep the order they had before, the order in which they were stored.
describe('services of the same name', () => {
  const FIRST = 'aa1111-ovh';
  const SECOND = 'bb2222-ovh';
  let named;

  beforeAll(async () => {
    named = await startOcm(() => ({}), {
      seed: (db) => {
        unclaimed(db, 'dedicated_servers', 'ns3000009.ip-203-0-113.eu', 'web-server');
        db.accounts.upsert({ nic: SECOND, currency: 'EUR' });
        server(db, 'ns3000008.ip-203-0-113.eu', 'web-server', SECOND);
        db.accounts.upsert({ nic: FIRST, currency: 'EUR' });
        server(db, 'ns3000007.ip-203-0-113.eu', 'web-server', FIRST);
        server(db, 'ns3000006.ip-203-0-113.eu', 'mail-server', FIRST);
        // After the other one of its name: stored last
        server(db, 'ns3000001.ip-203-0-113.eu', 'web-server', FIRST);
      },
    });
  }, 30000);

  afterAll(async () => {
    await named?.stop();
  });

  test('are listed by the NIC handle of their account, the Unknown account last', async () => {
    expect(listed(await named.get('/api/inventory/servers'))).toEqual({
      status: 200,
      body: [
        ['ns3000006.ip-203-0-113.eu', FIRST],
        ['ns3000007.ip-203-0-113.eu', FIRST],
        ['ns3000001.ip-203-0-113.eu', FIRST],
        ['ns3000008.ip-203-0-113.eu', SECOND],
        ['ns3000009.ip-203-0-113.eu', null],
      ],
    });
  });

  test('keep the order in which they were stored within one account', async () => {
    expect(listed(await named.get(`/api/inventory/servers?account=${FIRST}`))).toEqual({
      status: 200,
      body: [
        ['ns3000006.ip-203-0-113.eu', FIRST],
        ['ns3000007.ip-203-0-113.eu', FIRST],
        ['ns3000001.ip-203-0-113.eu', FIRST],
      ],
    });
  });
});

// Services whose bill lines of a resource type cost the same keep the order they had before;
// with byAccount, a service that costs the same on several accounts' bills comes by the NIC
// handle of each account, the Unknown account's last, whatever the order of the bills: here
// the Unknown account's first, then bb2222-ovh's, then aa1111-ovh's, which their numbers and
// dates follow too
describe('bill lines of services that cost the same', () => {
  const FIRST = 'aa1111-ovh';
  const SECOND = 'bb2222-ovh';
  const rental = (id, billId, service, price) => line(id, billId, service, 'dedicated_server',
    `Location du serveur ${service} - 1 mois`, price);
  let tied;

  beforeAll(async () => {
    tied = await startOcm(() => ({}), {
      seed: (db) => {
        unclaimedBill(db, 'FR0001', '2026-09-20');
        db.accounts.upsert({ nic: SECOND, currency: 'EUR' });
        bill(db, 'FR2001', '2026-09-10', SECOND);
        db.accounts.upsert({ nic: FIRST, currency: 'EUR' });
        bill(db, 'FR1001', '2026-09-05', FIRST);
        db.details.insertMany([
          rental('FR0001-1', 'FR0001', 'ns3000009.ip-203-0-113.eu', 50),
          rental('FR2001-1', 'FR2001', 'ns3000009.ip-203-0-113.eu', 50),
          rental('FR1001-1', 'FR1001', 'ns3000009.ip-203-0-113.eu', 50),
          // Two services of one account at the same cost, written in this order
          rental('FR1001-2', 'FR1001', 'ns3000001.ip-203-0-113.eu', 120),
          rental('FR1001-3', 'FR1001', 'ns3000007.ip-203-0-113.eu', 120),
        ]);
      },
    });
  }, 30000);

  afterAll(async () => {
    await tied?.stop();
  });

  // The services of an answer, in its order, as [service, cost, account]
  const servicesOf = async (parameters) => (await tied.get(
    `/api/analysis/resource-type-details?type=dedicated_server&${SEPTEMBER}${parameters}`,
  )).body.map(({ domain, total, account }) => [domain, total, account]);

  // As SQLite gave them before the query told accounts apart: whatever the order of their
  // bill lines, listed by account too
  test('come by service, the last first, as before', async () => {
    expect(await servicesOf('')).toEqual([
      ['ns3000009.ip-203-0-113.eu', 150, undefined],
      ['ns3000007.ip-203-0-113.eu', 120, undefined],
      ['ns3000001.ip-203-0-113.eu', 120, undefined],
    ]);
  });

  test('come by the NIC handle of their account when listed by account, the Unknown '
    + 'account last', async () => {
    expect(await servicesOf('&byAccount=true')).toEqual([
      ['ns3000007.ip-203-0-113.eu', 120, FIRST],
      ['ns3000001.ip-203-0-113.eu', 120, FIRST],
      ['ns3000009.ip-203-0-113.eu', 50, FIRST],
      ['ns3000009.ip-203-0-113.eu', 50, SECOND],
      ['ns3000009.ip-203-0-113.eu', 50, null],
    ]);
  });
});
