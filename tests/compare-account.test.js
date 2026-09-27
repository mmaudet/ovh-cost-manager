/**
 * The account parameter of the routes behind the Compare tab (#119), on the server started in
 * a child process over a database that the test seeds with several accounts. The tab compares
 * two months of the account selected in the header: their summaries, and their costs by
 * service type, by project and by resource type, which the header's and the Overview's tests
 * cover (account-parameter.test.js, overview-account.test.js), and their Veeam backups, which
 * its Backup comparison shows as the Backup tab does. As on those routes, a NIC handle that the
 * accounts table records keeps the bill lines of that account's bills, the reserved value
 * `unknown` those of the bills without an account (the Unknown account), and no parameter those
 * of every account, as before. Any other value is refused.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A bill line of the backups of a Veeam VM, whose service is the VM
const backupLine = (id, billId, vm, price) => ({
  id, bill_id: billId, project_id: null, domain: vm, description: `Veeam Backup ${vm}`,
  quantity: 1, unit_price: price, total_price: price, service_type: 'Storage',
  resource_type: 'backup',
});
// A bill line of a Veeam Enterprise licence
const licenceLine = (id, billId, licence, price) => ({
  id, bill_id: billId, project_id: null, domain: licence,
  description: 'Veeam Enterprise Plus licence', quantity: 1, unit_price: price,
  total_price: price, service_type: 'Other', resource_type: 'license',
});

// Two accounts and the Unknown account, whose bills of September back VMs up, and Lyon's of
// August too. Every NIC handle, name, identifier and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so it is written as the database held it
  db.getDb().prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();
  db.details.insertMany([
    backupLine('FR1001-1', 'FR1001', 'vm-web-1', 30),
    backupLine('FR1001-2', 'FR1001', 'vm-db-1', 20),
    backupLine('FR1002-1', 'FR1002', 'vm-web-1', 25),
    backupLine('FR2001-1', 'FR2001', 'vm-app-1', 40),
    licenceLine('FR2001-2', 'FR2001', 'veeam-licence-1', 25),
    backupLine('FR0001-1', 'FR0001', 'vm-old-1', 10),
  ]);
}

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

describe('GET /api/analysis/backup-stats', () => {
  const route = '/api/analysis/backup-stats';
  // The answer of the route for a month, for the account that the parameter names, or for
  // every account without one
  const backupsOf = (month, account) =>
    ocm.get(`${route}?${month}${account === undefined ? '' : `&account=${account}`}`);
  // The Veeam VMs and Enterprise licences of an answer, each as their number and their cost
  const backups = ([vms, vmsTotal], [licences, licencesTotal]) => ({
    status: 200,
    body: {
      vms: { count: vms, total: vmsTotal },
      enterprise: { count: licences, total: licencesTotal },
    },
  });

  test('adds up every account without the parameter, as before', async () => {
    expect(await backupsOf(SEPTEMBER)).toEqual(backups([4, 100], [1, 25]));
  });

  test('gives the Veeam backups of the account whose NIC handle it gives', async () => {
    expect(await backupsOf(SEPTEMBER, LYON)).toEqual(backups([2, 50], [0, 0]));
    expect(await backupsOf(SEPTEMBER, PARIS)).toEqual(backups([1, 40], [1, 25]));
    // For each month the tab compares
    expect(await backupsOf(AUGUST, LYON)).toEqual(backups([1, 25], [0, 0]));
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await backupsOf(SEPTEMBER, UNKNOWN_ACCOUNT)).toEqual(backups([1, 10], [0, 0]));
  });

  test('gives none for an account recorded without a bill', async () => {
    expect(await backupsOf(SEPTEMBER, NEW_ACCOUNT)).toEqual(backups([0, 0], [0, 0]));
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('refuses an account the server does not know, naming the parameter: %s',
    async (_, parameter) => {
      expect(await ocm.get(`${route}?${SEPTEMBER}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });
});
