/**
 * Tests for keeping the accounts of one database apart (#114), against a simulated OVH API
 * that serves each account through its own credentials: importing an account never touches
 * another account's data, and a service that two accounts list is stored once.
 */

const { ok, serveAccount, useConfig, useThrowawayImport } = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-accounts-apart-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The day the differential imports run to
  jest.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// The accounts that OVH serves, invented
const LYON = { nic: 'xx1111-ovh', currency: 'EUR' };
const PARIS = { nic: 'yy2222-ovh', currency: 'EUR' };

// Configures these accounts, in this order, under the accounts section: each entry is an
// account that OVH serves, with the fields of its entry, such as its name
const useAccounts = (...entries) => useConfig({
  accounts: entries.map(({ served, ...fields }) => ({
    ...fields, credentials: served.credentials,
  })),
});

// Serves on these routes these bills, as [id, date, domains]: each line of a bill names one
// of its domains, the service it bills, for 10. The bill list gives those of the dates asked
// for, as OVH filters it on date.from and date.to, both included.
function serveBills(accountRoutes, bills) {
  accountRoutes.set('/me/bill', (params = {}) => Promise.resolve(bills
    .filter(([, date]) => (!params['date.from'] || date >= params['date.from'])
      && (!params['date.to'] || date <= params['date.to']))
    .map(([id]) => id)));
  for (const [id, date, domains = ['example.com']] of bills) {
    const amount = (value) => ({ value, currencyCode: 'EUR' });
    accountRoutes.set(`/me/bill/${id}`, ok({
      billId: id,
      date: `${date}T00:00:00+02:00`,
      priceWithoutTax: amount(10 * domains.length),
      priceWithTax: amount(12 * domains.length),
      tax: amount(2 * domains.length),
    }));
    accountRoutes.set(`/me/bill/${id}/details`, ok(domains.map((_, index) => `D${index + 1}`)));
    domains.forEach((domain, index) => accountRoutes.set(`/me/bill/${id}/details/D${index + 1}`,
      ok({
        domain, description: `Service ${domain}`, quantity: '1', unitPrice: amount(10),
        totalPrice: amount(10),
      })));
  }
}

// Serves on these routes these Public Cloud projects, named by their ids
function serveProjects(accountRoutes, ids = []) {
  accountRoutes.set('/cloud/project', ok(ids));
  for (const id of ids) {
    accountRoutes.set(`/cloud/project/${id}`, ok({ description: id, status: 'ok' }));
  }
}

// Serves on these routes the inventories: these dedicated servers, VPS and NetApp storage
// services, and their details
function serveInventories(accountRoutes, { servers = [], vps = [], storage = [] } = {}) {
  accountRoutes.set('/dedicated/server', ok(servers));
  for (const name of servers) {
    accountRoutes.set(`/dedicated/server/${name}`, ok({ datacenter: 'rbx8', state: 'ok' }));
  }
  accountRoutes.set('/vps', ok(vps));
  for (const name of vps) {
    accountRoutes.set(`/vps/${name}`, ok({ name, state: 'running', model: { vcore: 2, disk: 40 } }));
  }
  accountRoutes.set('/storage/netapp', ok(storage));
  for (const id of storage) {
    accountRoutes.set(`/storage/netapp/${id}`, ok({ name: id, region: 'eu-west-gra' }));
  }
}

// A service of the account, as an earlier import stored it
const storeServer = (id, nic) => db.inventory.upsertServer({
  id, display_name: id, reverse: '', datacenter: 'rbx8', os: '', state: 'ok', cpu: '',
  ram_size: 0, disk_info: '[]', bandwidth: 0, expiration_date: null, renewal_type: '',
  account: nic,
});
const storeVps = (id, nic) => db.inventory.upsertVps({
  id, display_name: id, model: '', zone: '', state: 'running', os: '', vcpus: 2, ram_mb: 2048,
  disk_gb: 40, expiration_date: null, renewal_type: '', ip_addresses: '[]', account: nic,
});
const storeStorage = (id, nic) => db.inventory.upsertStorage({
  id, service_type: 'netapp', display_name: id, region: 'eu-west-gra', total_size_gb: 1024,
  used_size_gb: 0, share_count: 0, expiration_date: null, account: nic,
});

// Runs an import as import.js runs it with these options. Retry delays run on fake timers,
// so a retried call costs no real time.
async function runImport(params) {
  const done = importer.runImport(params);
  await jest.runAllTimersAsync();
  await done;
}

// A period import of September, with the datasets and the options given
const importSeptember = (options = {}) =>
  runImport({ from: '2026-09-01', to: '2026-09-30', ...options });

// The rows of a table as [id, NIC handle of their account], by id
const accountsOf = (table) => db.getDb()
  .prepare(`SELECT id, account FROM ${table} ORDER BY id`)
  .all()
  .map(row => [row.id, row.account]);

// The services of the inventories, as [id, NIC handle of their account] by kind
const storedServices = () => ({
  servers: accountsOf('dedicated_servers'),
  vps: accountsOf('vps_instances'),
  storage: accountsOf('storage_services'),
});

describe('the removal of the services that OVH no longer lists', () => {
  test('removes those of the importing account only', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    // Cancelled since an earlier import of Lyon
    storeServer('ns-lyon-cancelled', LYON.nic);
    storeVps('vps-lyon-cancelled', LYON.nic);
    storeStorage('netapp-lyon-cancelled', LYON.nic);
    // Paris's, which Lyon's API does not list
    storeServer('ns-paris', PARIS.nic);
    storeVps('vps-paris', PARIS.nic);
    storeStorage('netapp-paris', PARIS.nic);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, []);
    serveInventories(lyon.routes, { servers: ['ns-lyon'], vps: ['vps-lyon'], storage: ['netapp-lyon'] });
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ account: LYON.nic, includeInventory: true });

    expect(storedServices()).toEqual({
      servers: [['ns-lyon', LYON.nic], ['ns-paris', PARIS.nic]],
      vps: [['vps-lyon', LYON.nic], ['vps-paris', PARIS.nic]],
      storage: [['netapp-lyon', LYON.nic], ['netapp-paris', PARIS.nic]],
    });
  });
});
