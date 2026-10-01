/**
 * The projection of the month in progress in the charges of the Logs Data Platform services
 * (CONTEXT.md, #248), which the Compare tab's row of their resource type unfolds into, on the
 * server started in a child process over a database that the test seeds. With `projected=true`,
 * the month in progress, when the period covers it, counts each recurring service that it has not
 * billed yet at its bill lines of the month before, as the row of the resource type counts them:
 * each charge and what they cost in all give their projected parts, 0 when they have none, and a
 * charge that projected lines alone make is listed too. Without the parameter, the route answers
 * as before. The bills are dated from the real date (see support/month-in-progress.js).
 */

const { LYON, PARIS, UNKNOWN_ACCOUNT } = require('./support/accounts');
const { LDP_CHARGES } = require('./support/logs-data-platform');
const {
  ALL_ACCOUNTS, LYON_BILLED_LATE, MONTH_BEFORE, MONTH_OF_TODAY, MONTHS_BEFORE, OF_BOTH_MONTHS,
  OF_MONTH_BEFORE, OF_TODAY, PARIS_BILLED, UNKNOWN_BILLED_LATE, billOf,
} = require('./support/month-in-progress');
const { startOcm } = require('./support/ocm-server');

// The charges of an invoice's DBAAS-LOGS lines, as OVHcloud words them
const {
  accountRental: ACCOUNT_RENTAL, hotStorage: HOT_STORAGE, freeTier: FREE_TIER,
  coldStorage: COLD_STORAGE, inputInstances: INPUT_INSTANCES,
} = LDP_CHARGES;

// A bill line of a Logs Data Platform service, `ldp-` and a code, of their resource type, and of
// the service type that OVHcloud's « DBAAS-LOGS » heading gives them
const ldpLine = (service, description, price) => [
  service, 'logs_data_platform', price, { description, serviceType: 'Database' },
];

// The Lyon subsidiary, billed on the first day of each month for a Logs Data Platform service,
// and late in the month for another, whose streams' hot storage grew in the month before: the bill
// of the month of today charged the first, a bit more hot storage than before, and the one that
// will charge the second, the only one with input instances, has not come yet. Paris, whose bill
// of the month of today came. And the Unknown account, billed late for its own service, whose
// streams alone have cold storage, and on the first day of each month for a domain: its month of
// today has begun (#258). Each late service has a free tier of its hot storage, at 0 €. Every NIC
// handle, identifier and amount is made up; the charges are an invoice's.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
    const ofToday = yearMonth === MONTH_OF_TODAY;
    billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [
      ldpLine('ldp-cd-67890', ACCOUNT_RENTAL, 30),
      ldpLine('ldp-cd-67890', HOT_STORAGE, ofToday ? 4.1 : 3.6),
    ]);
    billOf(db, `FR2${index}01`, PARIS, `${yearMonth}-10`, [
      ldpLine('ldp-ef-24680', ACCOUNT_RENTAL, 30),
      ldpLine('ldp-ef-24680', INPUT_INSTANCES, 6),
    ]);
    billOf(db, `FR0${index}01`, null, `${yearMonth}-01`, [['example.com', 'domain', 15]]);
  });
  MONTHS_BEFORE.forEach((yearMonth, index) => {
    billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [
      ldpLine('ldp-ab-12345', ACCOUNT_RENTAL, 30),
      ldpLine('ldp-ab-12345', HOT_STORAGE, yearMonth === MONTH_BEFORE ? 18.4 : 12.5),
      ldpLine('ldp-ab-12345', FREE_TIER, 0),
      ldpLine('ldp-ab-12345', INPUT_INSTANCES, 12),
    ]);
    billOf(db, `FR0${index}02`, null, `${yearMonth}-25`, [
      ldpLine('ldp-gh-13579', ACCOUNT_RENTAL, 30),
      ldpLine('ldp-gh-13579', FREE_TIER, 0),
      ldpLine('ldp-gh-13579', COLD_STORAGE, 1.4),
    ]);
  });
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

const ROUTE = '/api/analysis/logs-data-platform';

// The answer of a route for a period, with the parameters given besides, and for the account that
// the parameter names, or for every account without one
const answerOf = (route, parameters, account) => ocm.get(
  `${route}?${parameters}${account === undefined ? '' : `&account=${account}`}`,
);
const chargesOf = (parameters, account) => answerOf(ROUTE, parameters, account);
// The route's answer with projected=true: what the charges cost in all and its projected part,
// each charge as [charge, cost, projected part], the most expensive first
const projectedCharges = ([total, projected], charges) => ({
  status: 200,
  body: {
    total,
    projected,
    charges: charges.map(([charge, cost, part]) => ({ charge, total: cost, projected: part })),
  },
});

// What the month of today billed Lyon so far: its first service, without a projected part
const LYON_BILLED = {
  total: 34.1,
  charges: [{ charge: ACCOUNT_RENTAL, total: 30 }, { charge: HOT_STORAGE, total: 4.1 }],
};
// And with the projected lines of its second service
const LYON_PROJECTED = projectedCharges(
  [94.5, 60.4], [[ACCOUNT_RENTAL, 60, 30], [HOT_STORAGE, 22.5, 18.4], [INPUT_INSTANCES, 12, 12]],
);

describe('GET /api/analysis/logs-data-platform with projected=true (#248)', () => {
  // Lyon's second service at its lines of the month before: its rental, 30 €, its hot storage,
  // 18.40 €, and its input instances, 12 €, which only projected lines make; its free tier, at 0 €,
  // left out. The first, which the month billed, at what it cost.
  test('adds the projected lines of the month in progress, and gives each charge its part',
    async () => {
      expect(await chargesOf(`${OF_TODAY}&projected=true`, LYON)).toEqual(LYON_PROJECTED);
    });

  // Byte for byte: no projected part, nor any other change
  test.each([
    ['without the parameter', OF_TODAY],
    ['with projected=false', `${OF_TODAY}&projected=false`],
  ])('answers as before %s: what the month billed so far', async (_, parameters) => {
    const { status, body } = await ocm.getText(`${ROUTE}?${parameters}&account=${LYON}`);

    expect(status).toBe(200);
    expect(body).toBe(JSON.stringify(LYON_BILLED));
  });

  // Complete months are never projected: Lyon's two services billed in the month before
  test('projects nothing over a complete month', async () => {
    expect(await chargesOf(`${OF_MONTH_BEFORE}&projected=true`, LYON)).toEqual(projectedCharges(
      [94, 0], [[ACCOUNT_RENTAL, 60, 0], [HOT_STORAGE, 22, 0], [INPUT_INSTANCES, 12, 0]],
    ));
  });

  // The lines of the month before, those of the month of today, and the projected lines, of the
  // month before, again in the month of today
  test('projects the month in progress over a period that covers it', async () => {
    expect(await chargesOf(`${OF_BOTH_MONTHS}&projected=true`, LYON)).toEqual(projectedCharges(
      [188.5, 60.4],
      [[ACCOUNT_RENTAL, 120, 30], [HOT_STORAGE, 44.5, 18.4], [INPUT_INSTANCES, 24, 12]],
    ));
  });

  // As the months list's mark (#216) and the other routes (#217, #218, #219): the recurring
  // services of the account asked, those of the Unknown account for `unknown`, and every
  // account's without it, whose projections add up
  test.each([
    [...LYON_BILLED_LATE, LYON_PROJECTED],
    [...PARIS_BILLED, projectedCharges(
      [36, 0], [[ACCOUNT_RENTAL, 30, 0], [INPUT_INSTANCES, 6, 0]],
    )],
    [...UNKNOWN_BILLED_LATE, projectedCharges(
      [31.4, 31.4], [[ACCOUNT_RENTAL, 30, 30], [COLD_STORAGE, 1.4, 1.4]],
    )],
    [...ALL_ACCOUNTS, projectedCharges([161.9, 91.8], [
      [ACCOUNT_RENTAL, 120, 60], [HOT_STORAGE, 22.5, 18.4], [INPUT_INSTANCES, 18, 12],
      [COLD_STORAGE, 1.4, 1.4],
    ])],
  ])('projects the charges of %s', async (_, account, answer) => {
    expect(await chargesOf(`${OF_TODAY}&projected=true`, account)).toEqual(answer);
  });

  // What the Compare tab's row of Logs Data Platform unfolds into: its row of the costs by
  // resource type, of the same account and period, its projected part included
  test.each([
    LYON_BILLED_LATE, PARIS_BILLED, UNKNOWN_BILLED_LATE, ALL_ACCOUNTS,
  ])('add up to the cost of the resource type of %s, and to its projected part',
    async (_, account) => {
      const { body: { total, projected } } = await chargesOf(`${OF_TODAY}&projected=true`, account);
      const { body: resourceTypes } = await answerOf(
        '/api/analysis/by-resource-type', `${OF_TODAY}&projected=true`, account,
      );

      expect(resourceTypes.find((row) => row.resource_type === 'logs_data_platform'))
        .toMatchObject({ value: total, projected });
    });

  test.each([
    'projected=yes',
    'projected=true&projected=true',
  ])('refuses a projected parameter that is neither true nor false: %s', async (parameter) => {
    expect(await ocm.get(`${ROUTE}?${OF_TODAY}&${parameter}`)).toEqual({
      status: 400, body: { error: "Invalid 'projected' parameter: expected true or false" },
    });
  });
});
