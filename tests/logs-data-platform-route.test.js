/**
 * The charges of the Logs Data Platform services over a period (#247), which the Infrastructure
 * tab lists for the month it shows, on the server started in a child process over a database that
 * the test seeds with several accounts. The route adds up by charge (see CONTEXT.md) the bill
 * lines of the resource type that the classification gives these services (#246): their
 * descriptions without the period that ends them on some accounts' bills, the lines of one charge
 * added up, the services together, to the cent, the most expensive first, those that cost nothing
 * left out. As on the other routes (#115), a NIC handle that the accounts table records selects
 * that account's bills, the reserved value `unknown` the bills without an account (the Unknown
 * account), and no parameter every account. Any other value is refused.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill,
} = require('./support/accounts');
const { LDP_CHARGES, inAugust, inSeptember } = require('./support/logs-data-platform');
const { startOcm } = require('./support/ocm-server');
const { classifyService } = require('../data/classify');

// A bill line of a service, of the resource type that the import stores for it, and of the
// service type that it reads from its description
const line = (id, billId, service, resourceType, description, price) => ({
  id, bill_id: billId, project_id: null, domain: service, description, quantity: 1,
  unit_price: price, total_price: price, service_type: classifyService(description),
  resource_type: resourceType,
});
// A bill line of a Logs Data Platform service, `ldp-` and a code, of their resource type
const ldpLine = (id, billId, service, description, price) => line(
  id, billId, service, 'logs_data_platform', description, price,
);

// The charges of an invoice's DBAAS-LOGS lines, as OVHcloud words them. The bills of Paris end
// each description with its period (inAugust(), inSeptember()).
const {
  accountRental: ACCOUNT_RENTAL, hotStorage: HOT_STORAGE,
  hotStorageOver101Gb: HOT_STORAGE_OVER_101_GB, freeTier: FREE_TIER, coldStorage: COLD_STORAGE,
  inputInstances: INPUT_INSTANCES, dashboards: DASHBOARDS,
} = LDP_CHARGES;

// Two accounts whose Logs Data Platform services were billed in September, and a third, recorded
// without a bill:
// - the Lyon subsidiary, whose descriptions carry no period: two services in September, one with
//   every charge of the invoice, the free tier of the hot storage at 0 € among them, the other
//   with its rental and some hot storage, besides a file storage, which is storage; in August,
//   the first one's rental and hot storage; in July, a dedicated server alone; and in June, a
//   rental and a free tier that cost nothing;
// - Paris, whose descriptions end with their period: its rental, hot storage and input instances,
//   and a free tier;
// - and the Unknown account, imported before OCM told accounts apart: a rental and cold storage.
// Every NIC handle, name, identifier and amount is made up; the charges are an invoice's.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR1003', '2026-07-05', LYON);
  bill(db, 'FR1004', '2026-06-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Claimed by no account since: the Unknown account's (ADR 0002)
  bill(db, 'FR0001', '2026-09-20', null);
  db.details.insertMany([
    ldpLine('FR1001-1', 'FR1001', 'ldp-ab-12345', ACCOUNT_RENTAL, 30),
    ldpLine('FR1001-2', 'FR1001', 'ldp-ab-12345', HOT_STORAGE, 18.4),
    ldpLine('FR1001-3', 'FR1001', 'ldp-ab-12345', HOT_STORAGE_OVER_101_GB, 7.25),
    ldpLine('FR1001-4', 'FR1001', 'ldp-ab-12345', FREE_TIER, 0),
    ldpLine('FR1001-5', 'FR1001', 'ldp-ab-12345', COLD_STORAGE, 2.1),
    ldpLine('FR1001-6', 'FR1001', 'ldp-ab-12345', INPUT_INSTANCES, 12),
    ldpLine('FR1001-7', 'FR1001', 'ldp-ab-12345', DASHBOARDS, 24),
    ldpLine('FR1001-8', 'FR1001', 'ldp-cd-67890', ACCOUNT_RENTAL, 30),
    ldpLine('FR1001-9', 'FR1001', 'ldp-cd-67890', HOT_STORAGE, 3.6),
    line('FR1001-10', 'FR1001', 'netapp-5f2c9a1e', 'storage',
      'Enterprise File Storage 1 TB - 1 mois', 64.8),
    ldpLine('FR1002-1', 'FR1002', 'ldp-ab-12345', ACCOUNT_RENTAL, 30),
    ldpLine('FR1002-2', 'FR1002', 'ldp-ab-12345', HOT_STORAGE, 12.5),
    ldpLine('FR1002-3', 'FR1002', 'ldp-ab-12345', FREE_TIER, 0),
    line('FR1003-1', 'FR1003', 'ns3000001.ip-203-0-113.eu', 'dedicated_server',
      'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', 270),
    ldpLine('FR1004-1', 'FR1004', 'ldp-ab-12345', ACCOUNT_RENTAL, 0),
    ldpLine('FR1004-2', 'FR1004', 'ldp-ab-12345', FREE_TIER, 0),
    ldpLine('FR2001-1', 'FR2001', 'ldp-ef-24680', inSeptember(ACCOUNT_RENTAL), 30),
    ldpLine('FR2001-2', 'FR2001', 'ldp-ef-24680', inAugust(HOT_STORAGE), 9.2),
    ldpLine('FR2001-3', 'FR2001', 'ldp-ef-24680', inAugust(FREE_TIER), 0),
    ldpLine('FR2001-4', 'FR2001', 'ldp-ef-24680', inAugust(INPUT_INSTANCES), 6),
    ldpLine('FR0001-1', 'FR0001', 'ldp-gh-13579', ACCOUNT_RENTAL, 30),
    ldpLine('FR0001-2', 'FR0001', 'ldp-gh-13579', inAugust(COLD_STORAGE), 1.4),
  ]);
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

const ROUTE = '/api/analysis/logs-data-platform';
// The months that the Infrastructure tab asks for
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';
const JULY = 'from=2026-07-01&to=2026-07-31';
const JUNE = 'from=2026-06-01&to=2026-06-30';

// The route's answer for a period, for the account that the parameter names, or for every
// account without one
const chargesOf = (period, account) =>
  ocm.get(`${ROUTE}?${period}${account === undefined ? '' : `&account=${account}`}`);
// A charge, as the route gives it, with its cost
const charge = (name, total) => ({ charge: name, total });
// What the route answers for charges and their total
const answer = (total, charges) => ({ status: 200, body: { total, charges } });
const NO_CHARGE = answer(0, []);

describe('GET /api/analysis/logs-data-platform', () => {
  // The lines of Lyon's two services add up by charge, the free tier of the hot storage, at 0 €,
  // left out, and so is the file storage of the same bill, which is not Logs Data Platform
  test('gives each charge of the period with its cost, the services together, the most '
    + 'expensive first, and what they cost in all', async () => {
    expect(await chargesOf(SEPTEMBER, LYON)).toEqual(answer(127.35, [
      charge(ACCOUNT_RENTAL, 60),
      charge(DASHBOARDS, 24),
      charge(HOT_STORAGE, 22),
      charge(INPUT_INSTANCES, 12),
      charge(HOT_STORAGE_OVER_101_GB, 7.25),
      charge(COLD_STORAGE, 2.1),
    ]));
  });

  // So that a charge reads alike whatever the account and the month
  test('names a charge without the period that ends its lines on some bills', async () => {
    expect(await chargesOf(SEPTEMBER, PARIS)).toEqual(answer(45.2, [
      charge(ACCOUNT_RENTAL, 30),
      charge(HOT_STORAGE, 9.2),
      charge(INPUT_INSTANCES, 6),
    ]));
  });

  // Those of the month that the Infrastructure tab shows: the month of its bills, although what
  // a service consumed covers the month before
  test('counts the bills of the period alone', async () => {
    expect(await chargesOf(AUGUST, LYON)).toEqual(answer(42.5, [
      charge(ACCOUNT_RENTAL, 30),
      charge(HOT_STORAGE, 12.5),
    ]));
  });

  test('gives no charge for a period without Logs Data Platform lines', async () => {
    expect(await chargesOf(JULY, LYON)).toEqual(NO_CHARGE);
  });

  // Such as an account whose rental costs nothing, and whose streams stay in the free tier
  test('gives no charge for a period whose Logs Data Platform lines cost nothing', async () => {
    expect(await chargesOf(JUNE, LYON)).toEqual(NO_CHARGE);
  });

  test('refuses a request without its period, or with an invalid one', async () => {
    expect(await ocm.get(ROUTE)).toEqual({
      status: 400, body: { error: 'from and to parameters are required' },
    });
    expect(await ocm.get(`${ROUTE}?from=2026-09-30&to=2026-09-01`)).toEqual({
      status: 400,
      body: { error: "'from' date (2026-09-30) must be before or equal to 'to' date (2026-09-01)" },
    });
  });
});

// The tests above give the charges of accounts whose NIC handle the parameter gives
describe('the account parameter of GET /api/analysis/logs-data-platform', () => {
  // As the Infrastructure tab's cards do: each charge once, with every account's lines
  test("adds up every account without it, the Unknown account's included", async () => {
    expect(await chargesOf(SEPTEMBER)).toEqual(answer(203.95, [
      charge(ACCOUNT_RENTAL, 120),
      charge(HOT_STORAGE, 31.2),
      charge(DASHBOARDS, 24),
      charge(INPUT_INSTANCES, 18),
      charge(HOT_STORAGE_OVER_101_GB, 7.25),
      charge(COLD_STORAGE, 3.5),
    ]));
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await chargesOf(SEPTEMBER, UNKNOWN_ACCOUNT)).toEqual(answer(31.4, [
      charge(ACCOUNT_RENTAL, 30),
      charge(COLD_STORAGE, 1.4),
    ]));
  });

  test('gives no charge for an account without a bill', async () => {
    expect(await chargesOf(SEPTEMBER, NEW_ACCOUNT)).toEqual(NO_CHARGE);
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('refuses an account the server does not know, naming the parameter: %s',
    async (_, parameter) => {
      expect(await ocm.get(`${ROUTE}?${SEPTEMBER}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });
});
