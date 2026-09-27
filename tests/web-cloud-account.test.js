/**
 * The account parameter of the Web Cloud routes (#122), on the server started in a child
 * process over a database that the test seeds with several accounts: a NIC handle that the
 * accounts table records selects the services that account's bills billed, the reserved value
 * `unknown` those of the bills without an account (the Unknown account), and no parameter
 * those of every account, as before. Each service names its account, and a service billed on
 * two accounts' bills is a service of each.
 */

const { LYON, PARIS, NEW_ACCOUNT, REFUSED, bill } = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A Web Cloud bill line, of no Public Cloud project. The wording gives its family.
const line = (id, billId, service, description, price, resourceType) => ({
  id, bill_id: billId, project_id: null, domain: service, description,
  quantity: 1, unit_price: price, total_price: price,
  service_type: 'Other', resource_type: resourceType,
});

// Two accounts, one that an import recorded without any bill, and the Unknown account. The
// domain example.net moved from Lyon to Paris: the renewal of March is on a bill of Lyon, the
// transfer of June on a bill of Paris. Every NIC handle, name, service and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  bill(db, 'FR1001', '2026-03-05', LYON);
  bill(db, 'FR1002', '2026-09-05', LYON);
  bill(db, 'FR2001', '2026-06-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so it is written as the database held it
  db.getDb().prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-01-20', 'EUR', NULL)",
  ).run();
  db.details.insertMany([
    line('FR1001-1', 'FR1001', 'example.com',
      'example.com - .com demande de renouvellement - 12 mois', 10.49, 'domain'),
    line('FR1001-2', 'FR1001', 'example.net',
      'example.net - .net demande de renouvellement - 12 mois', 11.99, 'domain'),
    line('FR1001-3', 'FR1001', 'example.com', 'CDN basic option rental for 12 months', 6,
      'web_cloud'),
    line('FR1002-1', 'FR1002', 'example.com', 'CDN basic option rental for 12 months', 6,
      'web_cloud'),
    line('FR2001-1', 'FR2001', 'example.net', 'example.net - .net transfert - 12 mois', 9.99,
      'domain'),
    line('FR2001-2', 'FR2001', 'example.org', 'MX plan account rental for 12 months', 12,
      'other'),
    line('FR0001-1', 'FR0001', 'example.org', 'example.org - Zone DNS - Renouvellement', 1.2,
      'domain'),
  ]);
}

// 2026, which every bill of the database is in
const YEAR = 'from=2026-01-01&to=2026-12-31';

// A service as /api/web-cloud/items lists it, billed on its first and its last date
const service = (name, account, category, description, lineCount, firstDate, lastDate, total) =>
  ({ name, account, category, description, lineCount, firstDate, lastDate, total });

const LYON_CDN = service('example.com', LYON, 'option', 'CDN basic option rental for 12 months',
  2, '2026-03-05', '2026-09-05', 12);
const LYON_NET = service('example.net', LYON, 'domain',
  'example.net - .net demande de renouvellement - 12 mois', 1, '2026-03-05', '2026-03-05', 11.99);
const LYON_COM = service('example.com', LYON, 'domain',
  'example.com - .com demande de renouvellement - 12 mois', 1, '2026-03-05', '2026-03-05', 10.49);
const PARIS_MAIL = service('example.org', PARIS, 'email', 'MX plan account rental for 12 months',
  1, '2026-06-10', '2026-06-10', 12);
const PARIS_NET = service('example.net', PARIS, 'domain',
  'example.net - .net transfert - 12 mois', 1, '2026-06-10', '2026-06-10', 9.99);
// The Unknown account's: no NIC handle
const UNCLAIMED_ZONE = service('example.org', null, 'dns_zone',
  'example.org - Zone DNS - Renouvellement', 1, '2026-01-20', '2026-01-20', 1.2);

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

describe('GET /api/web-cloud/items', () => {
  // Most expensive first, then by name, as before
  test('lists the services of every account without the parameter, each with its account',
    async () => {
      expect(await ocm.get(`/api/web-cloud/items?${YEAR}`)).toEqual({
        status: 200,
        body: [LYON_CDN, PARIS_MAIL, LYON_NET, LYON_COM, PARIS_NET, UNCLAIMED_ZONE],
      });
    });

  // Rather than one row of both accounts' costs, which no account paid
  test('lists a service billed on two accounts\' bills once for each, with its cost', async () => {
    const { body } = await ocm.get(`/api/web-cloud/items?${YEAR}`);

    expect(body.filter(({ name, category }) => name === 'example.net' && category === 'domain'))
      .toEqual([LYON_NET, PARIS_NET]);
  });

  test('lists the services that the bills of the account whose NIC handle it gives billed',
    async () => {
      expect(await ocm.get(`/api/web-cloud/items?${YEAR}&account=${LYON}`)).toEqual({
        status: 200, body: [LYON_CDN, LYON_NET, LYON_COM],
      });
      expect(await ocm.get(`/api/web-cloud/items?${YEAR}&account=${PARIS}`)).toEqual({
        status: 200, body: [PARIS_MAIL, PARIS_NET],
      });
    });

  test('lists the services of the Unknown account: those of the bills without an account',
    async () => {
      expect(await ocm.get(`/api/web-cloud/items?${YEAR}&account=unknown`)).toEqual({
        status: 200, body: [UNCLAIMED_ZONE],
      });
    });

  test('lists no service for an account recorded without a bill', async () => {
    expect(await ocm.get(`/api/web-cloud/items?${YEAR}&account=${NEW_ACCOUNT}`))
      .toEqual({ status: 200, body: [] });
  });
});

// The count and the cost of each family, as /api/web-cloud/summary gives them, and their total
const summary = ({ domain = [0, 0], dnsZone = [0, 0], hosting = [0, 0], email = [0, 0],
  option = [0, 0] }, total) => ({
  domain: { count: domain[0], total: domain[1] },
  dns_zone: { count: dnsZone[0], total: dnsZone[1] },
  hosting: { count: hosting[0], total: hosting[1] },
  email: { count: email[0], total: email[1] },
  option: { count: option[0], total: option[1] },
  total,
});

describe('GET /api/web-cloud/summary', () => {
  // The domain example.net counts once for each account that billed it, as it is listed
  test('counts and adds up the services of every account without the parameter', async () => {
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}`)).toEqual({
      status: 200,
      body: summary({ domain: [3, 32.47], dnsZone: [1, 1.2], email: [1, 12], option: [1, 12] },
        57.67),
    });
  });

  test('counts and adds up the services of the account whose NIC handle it gives', async () => {
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}&account=${LYON}`)).toEqual({
      status: 200, body: summary({ domain: [2, 22.48], option: [1, 12] }, 34.48),
    });
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}&account=${PARIS}`)).toEqual({
      status: 200, body: summary({ domain: [1, 9.99], email: [1, 12] }, 21.99),
    });
  });

  test('counts and adds up the services of the Unknown account', async () => {
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}&account=unknown`)).toEqual({
      status: 200, body: summary({ dnsZone: [1, 1.2] }, 1.2),
    });
  });

  test('counts no service for an account recorded without a bill', async () => {
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}&account=${NEW_ACCOUNT}`))
      .toEqual({ status: 200, body: summary({}, 0) });
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused, naming the parameter: %s', async (_, parameter) => {
    expect(await ocm.get(`/api/web-cloud/items?${YEAR}&${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
    expect(await ocm.get(`/api/web-cloud/summary?${YEAR}&${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
  });
});

// A single-account installation gets the same answers as before an instance could import
// several accounts, but for the account that each service now names: each service once, with
// the same figures, whether its bills belong to the account, or to none, as until the first
// import since the upgrade. The domain example.net was renewed in March, then transferred in
// June: two bill lines of one service.
describe.each([
  ['whose every bill belongs to its account', LYON],
  ['imported before OCM told accounts apart', null],
])('a single-account database %s', (_, account) => {
  let single;

  beforeAll(async () => {
    single = await startOcm(() => ({}), {
      seed: (db) => {
        if (account !== null) db.accounts.upsert({ nic: account, currency: 'EUR' });
        const insertBill = db.getDb().prepare(
          "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', ?)",
        );
        insertBill.run('FR1001', '2026-03-05', account);
        insertBill.run('FR1002', '2026-06-10', account);
        db.details.insertMany([
          line('FR1001-1', 'FR1001', 'example.com',
            'example.com - .com demande de renouvellement - 12 mois', 10.49, 'domain'),
          line('FR1001-2', 'FR1001', 'example.net',
            'example.net - .net demande de renouvellement - 12 mois', 11.99, 'domain'),
          line('FR1002-1', 'FR1002', 'example.net', 'example.net - .net transfert - 12 mois', 9.99,
            'domain'),
          line('FR1002-2', 'FR1002', 'example.org', 'MX plan account rental for 12 months', 12,
            'other'),
        ]);
      },
    });
  }, 30000);

  afterAll(async () => {
    await single?.stop();
  });

  test('lists each service once without the parameter, as before, with its account added',
    async () => {
      expect(await single.get(`/api/web-cloud/items?${YEAR}`)).toEqual({
        status: 200,
        body: [
          // The most recent wording
          service('example.net', account, 'domain', 'example.net - .net transfert - 12 mois',
            2, '2026-03-05', '2026-06-10', 21.98),
          service('example.org', account, 'email', 'MX plan account rental for 12 months',
            1, '2026-06-10', '2026-06-10', 12),
          service('example.com', account, 'domain',
            'example.com - .com demande de renouvellement - 12 mois',
            1, '2026-03-05', '2026-03-05', 10.49),
        ],
      });
    });

  // The summary has no account field: its answer is the one from before
  test('counts each service once without the parameter, as before', async () => {
    expect(await single.get(`/api/web-cloud/summary?${YEAR}`)).toEqual({
      status: 200, body: summary({ domain: [2, 32.47], email: [1, 12] }, 44.47),
    });
  });
});

// A service that costs the same on several accounts is listed by the NIC handle of each
// account, the Unknown account's last, whatever order the import wrote its bill lines in:
// here the Unknown account's first, then bb2222-ovh's, then aa1111-ovh's, which their bill
// numbers and dates follow too. The services of one account keep the order they had before,
// as a domain and its DNS zone at the same cost.
describe('services that cost the same', () => {
  const FIRST = 'aa1111-ovh';
  const SECOND = 'bb2222-ovh';
  const RENEWAL = 'example.com - .com demande de renouvellement - 12 mois';
  let tied;

  beforeAll(async () => {
    tied = await startOcm(() => ({}), {
      seed: (db) => {
        // Written as the database held it, as in seed() above
        db.getDb().prepare(
          "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', NULL)",
        ).run('FR0001', '2026-01-20');
        db.details.insertMany([
          line('FR0001-1', 'FR0001', 'example.com', RENEWAL, 10.49, 'domain'),
        ]);
        db.accounts.upsert({ nic: SECOND, currency: 'EUR' });
        bill(db, 'FR1001', '2026-02-10', SECOND);
        db.details.insertMany([
          line('FR1001-1', 'FR1001', 'example.com', RENEWAL, 10.49, 'domain'),
        ]);
        db.accounts.upsert({ nic: FIRST, currency: 'EUR' });
        bill(db, 'FR2001', '2026-03-05', FIRST);
        db.details.insertMany([
          line('FR2001-1', 'FR2001', 'example.com', RENEWAL, 10.49, 'domain'),
          line('FR2001-2', 'FR2001', 'example.org',
            'example.org - .org demande de renouvellement - 12 mois', 1.2, 'domain'),
          line('FR2001-3', 'FR2001', 'example.org', 'example.org - Zone DNS - Renouvellement',
            1.2, 'domain'),
        ]);
      },
    });
  }, 30000);

  afterAll(async () => {
    await tied?.stop();
  });

  // Each service as [name, family, account]
  const services = (items) =>
    items.map(({ name, category, account }) => [name, category, account]);

  test('lists them by the NIC handle of their account, the Unknown account last', async () => {
    const { body } = await tied.get(`/api/web-cloud/items?${YEAR}`);

    expect(services(body)).toEqual([
      ['example.com', 'domain', FIRST],
      ['example.com', 'domain', SECOND],
      ['example.com', 'domain', null],
      ['example.org', 'domain', FIRST],
      ['example.org', 'dns_zone', FIRST],
    ]);
  });

  test('keeps the order of the services of one account', async () => {
    const { body } = await tied.get(`/api/web-cloud/items?${YEAR}&account=${FIRST}`);

    expect(services(body)).toEqual([
      ['example.com', 'domain', FIRST],
      ['example.org', 'domain', FIRST],
      ['example.org', 'dns_zone', FIRST],
    ]);
  });
});
