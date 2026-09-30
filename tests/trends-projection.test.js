/**
 * The projection of the month in progress in the routes of the Trends tab (CONTEXT.md, #217), on
 * the server started in a child process over a database that the test seeds. With
 * `projected=true`, the month in progress, when their window covers it, counts each recurring
 * service that it has not billed yet at its bill lines of the month before, as they were: its
 * projected cost. Each month gives its projected part. Without the parameter, they answer as
 * before. The bills are dated from the real date (see support/month-in-progress.js).
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, project,
} = require('./support/accounts');
const {
  MONTH_BEFORE, MONTH_OF_TODAY, MONTHS_BEFORE, THREE_MONTHS_BEFORE, TWO_MONTHS_BEFORE, billOf,
} = require('./support/month-in-progress');
const { startOcm } = require('./support/ocm-server');

// The names that the monthly trend gives the months, in French only
const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov',
  'Déc'];
// A month of the monthly trend, as the route answers it: with its projected part, when given
const month = (yearMonth, cost, projected) => ({
  month: MONTH_NAMES[Number(yearMonth.slice(5)) - 1],
  yearMonth,
  cost,
  ...(projected === undefined ? {} : { projected }),
});

// The 3 months up to the month of today, and those up to the month before
const UP_TO_TODAY = `months=3&end=${MONTH_OF_TODAY}`;
const UP_TO_MONTH_BEFORE = `months=3&end=${MONTH_BEFORE}`;

// A single account, billed early in the month for its Public Cloud project, and late for its
// dedicated server and its licence: the bill of the month of today charged the project, and the
// one that will charge the server and the licence has not come yet. The server cost more in the
// month before than in the two months before it. A domain was renewed for a year in the month
// before. Every NIC handle, identifier and amount is made up.
const PROJECT = 'project-production';
const SERVER = 'ns3000001.ip-203-0-113.eu';
const LICENCE = 'windows-2022-std-0001';
function seedLateBill(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR' });
  project(db, PROJECT, 'Production', LYON);
  [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
    billOf(db, `FR10${index}1`, LYON, `${yearMonth}-01`, [
      [PROJECT, 'cloud_project', yearMonth === MONTH_OF_TODAY ? 610 : 600],
    ]);
  });
  billOf(db, 'FR1002', LYON, `${THREE_MONTHS_BEFORE}-25`, [
    [SERVER, 'dedicated_server', 200], [LICENCE, 'license', 30],
  ]);
  billOf(db, 'FR1012', LYON, `${TWO_MONTHS_BEFORE}-25`, [
    [SERVER, 'dedicated_server', 200], [LICENCE, 'license', 30],
  ]);
  billOf(db, 'FR1022', LYON, `${MONTH_BEFORE}-25`, [
    [SERVER, 'dedicated_server', 210], [LICENCE, 'license', 30], ['example.com', 'domain', 15],
  ]);
}

describe('GET /api/analysis/monthly-trend?projected=true (#217)', () => {
  const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend?${parameters}`);
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedLateBill });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // The server's 210 € and the licence's 30 € of the month before; the project, which the
  // month of today billed, at what it cost
  test('counts each recurring service not billed yet at its bill lines of the month before',
    async () => {
      expect(await trend(`${UP_TO_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [
          month(TWO_MONTHS_BEFORE, 830, 0),
          month(MONTH_BEFORE, 855, 0),
          month(MONTH_OF_TODAY, 850, 240),
        ],
      });
    });

  test.each([
    ['without the parameter', UP_TO_TODAY],
    ['with projected=false', `${UP_TO_TODAY}&projected=false`],
  ])('answers as before %s: the billed costs, and no projected part', async (_, parameters) => {
    expect(await trend(parameters)).toEqual({
      status: 200,
      body: [
        month(TWO_MONTHS_BEFORE, 830),
        month(MONTH_BEFORE, 855),
        month(MONTH_OF_TODAY, 610),
      ],
    });
  });

  // Complete months are never projected
  test('projects nothing over months that end before the month in progress', async () => {
    expect(await trend(`${UP_TO_MONTH_BEFORE}&projected=true`)).toEqual({
      status: 200,
      body: [
        month(THREE_MONTHS_BEFORE, 830, 0),
        month(TWO_MONTHS_BEFORE, 830, 0),
        month(MONTH_BEFORE, 855, 0),
      ],
    });
  });

  test('refuses a projected parameter that is neither true nor false', async () => {
    expect(await trend(`${UP_TO_TODAY}&projected=yes`)).toEqual({
      status: 400, body: { error: "Invalid 'projected' parameter: expected true or false" },
    });
  });
});

// The resource types of the trend by resource type, as the route presents them
const PUBLIC_CLOUD = { key: 'cloud_project', label: 'Public Cloud', color: '#3b82f6' };
const DEDICATED_SERVERS = { key: 'dedicated_server', label: 'Dedicated Servers', color: '#ef4444' };
const LICENSES = { key: 'license', label: 'Licenses', color: '#0891b2' };
const DOMAINS = { key: 'domain', label: 'Domains', color: '#8b5cf6' };

describe('GET /api/analysis/monthly-trend-by-category?projected=true (#217)', () => {
  const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend-by-category?${parameters}`);
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedLateBill });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // Each projected line under its own resource type, as its bill line was: the server's under
  // the dedicated servers, the licence's under the licences
  test('counts the projected lines under their resource types, with their projected parts',
    async () => {
      const nothingProjected = { cloud_project: 0, dedicated_server: 0, license: 0, domain: 0 };

      expect(await trend(`${UP_TO_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: {
          // By their costs over the months, projected lines included
          categories: [PUBLIC_CLOUD, DEDICATED_SERVERS, LICENSES, DOMAINS],
          data: [
            {
              yearMonth: TWO_MONTHS_BEFORE,
              cloud_project: 600, dedicated_server: 200, license: 30, domain: 0,
              projected: nothingProjected,
            },
            {
              yearMonth: MONTH_BEFORE,
              cloud_project: 600, dedicated_server: 210, license: 30, domain: 15,
              projected: nothingProjected,
            },
            {
              yearMonth: MONTH_OF_TODAY,
              cloud_project: 610, dedicated_server: 210, license: 30, domain: 0,
              projected: { ...nothingProjected, dedicated_server: 210, license: 30 },
            },
          ],
        },
      });
    });

  test('answers as before without the parameter: the billed costs, and no projected part',
    async () => {
      expect(await trend(UP_TO_TODAY)).toEqual({
        status: 200,
        body: {
          categories: [PUBLIC_CLOUD, DEDICATED_SERVERS, LICENSES, DOMAINS],
          data: [
            {
              yearMonth: TWO_MONTHS_BEFORE,
              cloud_project: 600, dedicated_server: 200, license: 30, domain: 0,
            },
            {
              yearMonth: MONTH_BEFORE,
              cloud_project: 600, dedicated_server: 210, license: 30, domain: 15,
            },
            {
              yearMonth: MONTH_OF_TODAY,
              cloud_project: 610, dedicated_server: 0, license: 0, domain: 0,
            },
          ],
        },
      });
    });

  // Over the month of today alone, which has billed its project only
  test('lists a resource type that projected lines alone make', async () => {
    const monthOfToday = `months=1&end=${MONTH_OF_TODAY}`;

    expect((await trend(monthOfToday)).body.categories).toEqual([PUBLIC_CLOUD]);
    expect(await trend(`${monthOfToday}&projected=true`)).toEqual({
      status: 200,
      body: {
        categories: [PUBLIC_CLOUD, DEDICATED_SERVERS, LICENSES],
        data: [{
          yearMonth: MONTH_OF_TODAY,
          cloud_project: 610, dedicated_server: 210, license: 30,
          projected: { cloud_project: 0, dedicated_server: 210, license: 30 },
        }],
      },
    });
  });

  test('refuses a projected parameter that is neither true nor false', async () => {
    expect(await trend(`${UP_TO_TODAY}&projected=1`)).toEqual({
      status: 400, body: { error: "Invalid 'projected' parameter: expected true or false" },
    });
  });
});

// Read when the server reads the bills: no re-import, nor any restart
describe('GET /api/analysis/monthly-trend?projected=true once the late bill comes', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedLateBill });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // The server and the licence cost less than in the month before: the month costs what its
  // bills charged
  test('projects nothing once the import stores the bill of each recurring service', async () => {
    ocm.write((db) => billOf(db, 'FR1032', LYON, `${MONTH_OF_TODAY}-01`, [
      [SERVER, 'dedicated_server', 190], [LICENCE, 'license', 25],
    ]));

    expect(await ocm.get(`/api/analysis/monthly-trend?${UP_TO_TODAY}&projected=true`)).toEqual({
      status: 200,
      body: [
        month(TWO_MONTHS_BEFORE, 830, 0),
        month(MONTH_BEFORE, 855, 0),
        month(MONTH_OF_TODAY, 825, 0),
      ],
    });
  });
});

// As the months list's mark (#216), the projection follows the account parameter: the recurring
// services of the account asked, those of the Unknown account for `unknown`, and those of every
// account without it, whose projections add up
describe('GET /api/analysis/monthly-trend?projected=true with several accounts', () => {
  const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend?${parameters}`);
  let ocm;

  // Lyon, billed late for its dedicated server, and the Unknown account, billed late for its
  // own: the bills of the month of today that will charge them have not come yet. Paris, whose
  // bill of the month of today charged its project. Each account's bill of the month of today
  // charged its other services.
  function seedAccounts(db) {
    db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
    db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
    project(db, 'project-lyon', 'Lyon', LYON);
    project(db, 'project-paris', 'Paris', PARIS);
    [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
      billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [['project-lyon', 'cloud_project', 600]]);
      billOf(db, `FR2${index}01`, PARIS, `${yearMonth}-01`, [
        ['project-paris', 'cloud_project', 400],
      ]);
      billOf(db, `FR0${index}01`, null, `${yearMonth}-01`, [['example.com', 'domain', 15]]);
    });
    MONTHS_BEFORE.forEach((yearMonth, index) => {
      billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [[SERVER, 'dedicated_server', 200]]);
      billOf(db, `FR0${index}02`, null, `${yearMonth}-25`, [
        ['ns3000004.ip-203-0-113.eu', 'dedicated_server', 80],
      ]);
    });
  }

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedAccounts });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  test.each([
    ['an account billed late', `&account=${LYON}`, [800, 800, 800], 200],
    ['an account whose bill of the month of today came', `&account=${PARIS}`, [400, 400, 400], 0],
    ['the Unknown account, billed late', `&account=${UNKNOWN_ACCOUNT}`, [95, 95, 95], 80],
    ['all accounts', '', [1295, 1295, 1295], 280],
  ])('projects the recurring services of %s', async (_, account, costs, projected) => {
    expect(await trend(`${UP_TO_TODAY}${account}&projected=true`)).toEqual({
      status: 200,
      body: [
        month(TWO_MONTHS_BEFORE, costs[0], 0),
        month(MONTH_BEFORE, costs[1], 0),
        month(MONTH_OF_TODAY, costs[2], projected),
      ],
    });
  });

  test('gives projections of the accounts that add up to that of all accounts', async () => {
    const monthOfToday = async (account) => (
      await trend(`${UP_TO_TODAY}${account}&projected=true`)).body[2];
    const ofEachAccount = await Promise.all([LYON, PARIS, UNKNOWN_ACCOUNT]
      .map((account) => monthOfToday(`&account=${account}`)));
    const ofAllAccounts = await monthOfToday('');

    expect(ofEachAccount.reduce((sum, { cost }) => sum + cost, 0)).toBe(ofAllAccounts.cost);
    expect(ofEachAccount.reduce((sum, { projected }) => sum + projected, 0))
      .toBe(ofAllAccounts.projected);
  });

  // Lyon's server and the Unknown account's, under the dedicated servers
  test('projects the resource types of all accounts in the trend by resource type', async () => {
    const { body } = await ocm.get(
      `/api/analysis/monthly-trend-by-category?${UP_TO_TODAY}&projected=true`,
    );

    expect(body.data[2]).toEqual({
      yearMonth: MONTH_OF_TODAY,
      cloud_project: 1000, dedicated_server: 280, domain: 15,
      projected: { cloud_project: 0, dedicated_server: 280, domain: 0 },
    });
  });
});

// A recurring service is a service by its identifier and its account; but it lacks no bill once
// any account's bill of the month of today charges its identifier (#214)
describe('GET /api/analysis/monthly-trend?projected=true with a service moved to another account',
  () => {
    const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend?${parameters}`);
    let ocm;

    // Lyon rented the dedicated server until last month, and Paris since: the bill of the month
    // of today that charged it is Paris's
    function seedMovedServer(db) {
      db.accounts.upsert({ nic: LYON, currency: 'EUR' });
      db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
      project(db, 'project-lyon', 'Lyon', LYON);
      [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
        billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [
          ['project-lyon', 'cloud_project', 600],
        ]);
      });
      MONTHS_BEFORE.forEach((yearMonth, index) => {
        billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [[SERVER, 'dedicated_server', 200]]);
      });
      billOf(db, 'FR2032', PARIS, `${MONTH_OF_TODAY}-01`, [[SERVER, 'dedicated_server', 200]]);
    }

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedMovedServer });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    // Rather than count it twice with all accounts shown
    test.each([
      ['the account it moved from', `&account=${LYON}`, 600],
      ['all accounts', '', 800],
    ])('projects nothing for %s', async (_, account, cost) => {
      const { body } = await trend(`${UP_TO_TODAY}${account}&projected=true`);

      expect(body[2]).toEqual(month(MONTH_OF_TODAY, cost, 0));
    });
  });
