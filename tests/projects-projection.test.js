/**
 * The projection of the month in progress in the Compare tab's projects and their products
 * (CONTEXT.md, #219), on the server started in a child process over a database that the test
 * seeds: the costs by project, and a project's products with their charges and the Public Cloud
 * credit that its bills used. With `projected=true`, the month in progress, when their period
 * covers it, counts each recurring service that it has not billed yet at its bill lines of the
 * month before, counted as they were: its projected cost. A Public Cloud project is such a
 * service, which each of its lines names, its credit's included: a project that the month in
 * progress has not billed yet counts every line of the month before, its credit with the rest.
 * Each project, product and charge gives its projected part, 0 when it has none, and the credit
 * its own; a project, product or charge that projected lines alone make is listed too. Without
 * the parameter, they answer as before. The bills are dated from the real date (see
 * support/month-in-progress.js).
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, project,
} = require('./support/accounts');
const {
  MONTH_BEFORE, MONTH_OF_TODAY, MONTHS_BEFORE, billOf,
} = require('./support/month-in-progress');
const { startOcm } = require('./support/ocm-server');
const { monthBounds, shiftMonth } = require('../data/months');

// The month of today and the month before, as the Compare tab asks for them, and both
const MONTH_IN_PROGRESS = monthBounds(MONTH_OF_TODAY);
const COMPLETE_MONTH = monthBounds(MONTH_BEFORE);
const period = ({ from, to }) => `from=${from}&to=${to}`;
const OF_TODAY = period(MONTH_IN_PROGRESS);
const OF_MONTH_BEFORE = period(COMPLETE_MONTH);
const UP_TO_TODAY = period({ from: COMPLETE_MONTH.from, to: MONTH_IN_PROGRESS.to });

// The projects, each as [id, name]
const PRODUCTION = ['project-production', 'Production'];
const STAGING = ['project-staging', 'Staging'];
const PARIS_PROJECT = ['project-paris', 'Paris'];
const LEGACY = ['project-legacy', 'Legacy'];

// What the lines of the projects pay for, as OVHcloud words them: the hourly use of a flavor in a
// region, a bucket's storage, a registry's plan, additional disks, and the Public Cloud credit
// that a bill used
const hourlyUse = (flavor) => `Consommation à l'heure pour les instances ${flavor} gra11`;
const BUCKET_STORAGE = 'Stockage Standard - Bucket assets sur la région gra';
const REGISTRY = 'Managed Private Registry - plan M';
const DISKS = 'Disques supplémentaires à gra11 de type classic';
const CREDIT = 'Utilisation du crédit cloud';

// A description as the bills of some accounts word it: ending with the period that its line
// covers in brackets, the month before its bill's for a Public Cloud project, which OVHcloud
// bills after use, such as « (01/08/2026-31/08/2026) »
const frenchDate = (date) => date.split('-').reverse().join('/');
const endingWithPeriod = (billMonth, description) => {
  const { from, to } = monthBounds(shiftMonth(billMonth, -1));
  return `${description} (${frenchDate(from)}-${frenchDate(to)})`;
};

// A bill line of a Public Cloud project, whose service is the project
const cloudLine = ([projectId], description, price) => [
  projectId, 'cloud_project', price, { description },
];

// The Lyon subsidiary, billed on the first day of each month for its Production project, and
// late in the month for its Staging project, whose bills used a Public Cloud credit: the bill of
// the month of today charged Production, a bit more than before, and the one that will charge
// Staging has not come yet. Staging's instances cost more in the month before than in the two
// months before it. Paris, whose bill of the month of today came, and the Unknown account, billed
// late for its Legacy project, word their lines with the period that they cover. Every NIC
// handle, name, identifier and amount is made up; the descriptions are OVHcloud's.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  project(db, PRODUCTION[0], PRODUCTION[1], LYON);
  project(db, STAGING[0], STAGING[1], LYON);
  project(db, PARIS_PROJECT[0], PARIS_PROJECT[1], PARIS);
  project(db, LEGACY[0], LEGACY[1], null);
  [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
    billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [
      cloudLine(PRODUCTION, hourlyUse('b3-8'), yearMonth === MONTH_OF_TODAY ? 320 : 300),
      cloudLine(PRODUCTION, BUCKET_STORAGE, 20),
    ]);
    billOf(db, `FR2${index}01`, PARIS, `${yearMonth}-10`, [
      cloudLine(PARIS_PROJECT, endingWithPeriod(yearMonth, DISKS), 50),
    ]);
  });
  MONTHS_BEFORE.forEach((yearMonth, index) => {
    billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [
      cloudLine(STAGING, hourlyUse('b3-16'), yearMonth === MONTH_BEFORE ? 110 : 100),
      cloudLine(STAGING, REGISTRY, 40.5),
      cloudLine(STAGING, CREDIT, -20),
    ]);
    billOf(db, `FR0${index}02`, null, `${yearMonth}-25`, [
      cloudLine(LEGACY, endingWithPeriod(yearMonth, hourlyUse('d2-4')), 8),
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

// The answer of a route for a period, with the parameters given besides, and for the account
// that the parameter names, or for every account without one
const answerOf = (route, parameters, account) => ocm.get(
  `${route}?${parameters}${account === undefined ? '' : `&account=${account}`}`,
);

// The accounts that the parameter names, and all accounts, without it
const LYON_BILLED_LATE = ['an account billed late', LYON];
const PARIS_BILLED = ['an account whose bills of the month of today came', PARIS];
const UNKNOWN_BILLED_LATE = ['the Unknown account, billed late', UNKNOWN_ACCOUNT];
const ALL_ACCOUNTS = ['all accounts', undefined];

describe('GET /api/analysis/by-project with projected=true (#219)', () => {
  const projectsOf = (parameters, account) => answerOf(
    '/api/analysis/by-project', parameters, account,
  );
  // A project as the route gives it: its cost, its number of lines, and its projected part when
  // the request asks for it
  const costs = ([projectId, projectName], total, detailsCount, projected) => ({
    projectId, projectName, total, detailsCount,
    ...(projected === undefined ? {} : { projected }),
  });

  // Staging at its lines of the month before: its instances, 110 €, its registry, 40.50 €, and
  // the credit that they used, -20 €; Legacy at its own. Production and Paris's project, which
  // the month billed, at what they cost.
  test('adds the projected lines of the month in progress, and gives each project its part',
    async () => {
      expect(await projectsOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [
          costs(PRODUCTION, 340, 2, 0),
          costs(STAGING, 130.5, 3, 130.5),
          costs(PARIS_PROJECT, 50, 1, 0),
          costs(LEGACY, 8, 1, 8),
        ],
      });
    });

  test.each([
    ['without the parameter', OF_TODAY],
    ['with projected=false', `${OF_TODAY}&projected=false`],
  ])('answers as before %s: what the month billed so far', async (_, parameters) => {
    expect(await projectsOf(parameters)).toEqual({
      status: 200,
      body: [costs(PRODUCTION, 340, 2), costs(PARIS_PROJECT, 50, 1)],
    });
  });

  // Complete months are never projected
  test('projects nothing over a complete month', async () => {
    const { body: billed } = await projectsOf(OF_MONTH_BEFORE);

    expect(await projectsOf(`${OF_MONTH_BEFORE}&projected=true`)).toEqual({
      status: 200, body: billed.map((row) => ({ ...row, projected: 0 })),
    });
    expect(billed).toEqual([
      costs(PRODUCTION, 320, 2), costs(STAGING, 130.5, 3), costs(PARIS_PROJECT, 50, 1),
      costs(LEGACY, 8, 1),
    ]);
  });

  // The projected lines, of the month before, count in the month in progress too
  test('projects the month in progress over a period that covers it', async () => {
    expect(await projectsOf(`${UP_TO_TODAY}&projected=true`)).toEqual({
      status: 200,
      body: [
        costs(PRODUCTION, 660, 4, 0),
        costs(STAGING, 261, 6, 130.5),
        costs(PARIS_PROJECT, 100, 2, 0),
        costs(LEGACY, 16, 2, 8),
      ],
    });
  });

  // As the months list's mark (#216) and the other routes (#217, #218): the recurring services of
  // the account asked, those of the Unknown account for `unknown`, and every account's without it
  test.each([
    [...LYON_BILLED_LATE, [costs(PRODUCTION, 340, 2, 0), costs(STAGING, 130.5, 3, 130.5)]],
    [...PARIS_BILLED, [costs(PARIS_PROJECT, 50, 1, 0)]],
    [...UNKNOWN_BILLED_LATE, [costs(LEGACY, 8, 1, 8)]],
  ])('projects the projects of %s', async (_, account, projects) => {
    expect(await projectsOf(`${OF_TODAY}&projected=true`, account))
      .toEqual({ status: 200, body: projects });
  });

  // Each project once for each account that billed it, with that account and its own part
  test('gives each project with its account and its part, by account', async () => {
    expect(await projectsOf(`${OF_TODAY}&byAccount=true&projected=true`)).toEqual({
      status: 200,
      body: [
        { ...costs(PRODUCTION, 340, 2), account: LYON, projected: 0 },
        { ...costs(STAGING, 130.5, 3), account: LYON, projected: 130.5 },
        { ...costs(PARIS_PROJECT, 50, 1), account: PARIS, projected: 0 },
        { ...costs(LEGACY, 8, 1), account: null, projected: 8 },
      ],
    });
  });

  test('answers as before by account without the parameter', async () => {
    expect(await projectsOf(`${OF_TODAY}&byAccount=true`)).toEqual({
      status: 200,
      body: [
        { ...costs(PRODUCTION, 340, 2), account: LYON },
        { ...costs(PARIS_PROJECT, 50, 1), account: PARIS },
      ],
    });
  });
});

describe('GET /api/projects/:id/products with projected=true (#219)', () => {
  const productsOf = ([projectId], parameters, account) => answerOf(
    `/api/projects/${projectId}/products`, parameters, account,
  );
  // The products of a project as the route gives them with projected=true: what they cost in all
  // and its projected part, each product as [product, cost, projected part, charges], each charge
  // as [charge, cost, projected part], and the credit that the bills used and its projected part
  const projectedProducts = ([total, projected], products, [credits, projectedCredits]) => ({
    total,
    projected,
    products: products.map(([product, cost, part, charges]) => ({
      product,
      total: cost,
      projected: part,
      charges: charges.map(([charge, chargeCost, chargePart]) => ({
        charge, total: chargeCost, projected: chargePart,
      })),
    })),
    credits,
    projectedCredits,
  });
  // The same without the parameter, as before: without the projected parts
  const billedProducts = (total, products, credits) => ({
    total,
    products: products.map(([product, cost, charges]) => ({
      product,
      total: cost,
      charges: charges.map(([charge, chargeCost]) => ({ charge, total: chargeCost })),
    })),
    credits,
  });
  // Staging's products in the month of today, which its lines of the month before alone make,
  // their charges, and the credit that they used
  const STAGING_PROJECTED = projectedProducts([150.5, 150.5], [
    ['instances', 110, 110, [[hourlyUse('b3-16'), 110, 110]]],
    ['registry', 40.5, 40.5, [[REGISTRY, 40.5, 40.5]]],
  ], [-20, -20]);
  // Legacy's, whose charge is named without the period that its line ends with, as the lines of
  // the months before name it (#195)
  const LEGACY_PROJECTED = projectedProducts([8, 8], [
    ['instances', 8, 8, [[hourlyUse('d2-4'), 8, 8]]],
  ], [0, 0]);
  const NOTHING = projectedProducts([0, 0], [], [0, 0]);

  // Its credit is projected with its other lines, as one of them (#214)
  test('gives a project that only projected lines make its products, charges and credit',
    async () => {
      expect(await productsOf(STAGING, `${OF_TODAY}&projected=true`))
        .toEqual({ status: 200, body: STAGING_PROJECTED });
    });

  test('gives no projected part to the products and charges of a project that the month billed',
    async () => {
      expect(await productsOf(PRODUCTION, `${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: projectedProducts([340, 0], [
          ['instances', 320, 0, [[hourlyUse('b3-8'), 320, 0]]],
          ['objectStorage', 20, 0, [[BUCKET_STORAGE, 20, 0]]],
        ], [0, 0]),
      });
    });

  test.each([
    ['without the parameter', OF_TODAY],
    ['with projected=false', `${OF_TODAY}&projected=false`],
  ])('answers as before %s: what the month billed so far', async (_, parameters) => {
    expect(await productsOf(STAGING, parameters))
      .toEqual({ status: 200, body: billedProducts(0, [], 0) });
    expect(await productsOf(PRODUCTION, parameters)).toEqual({
      status: 200,
      body: billedProducts(340, [
        ['instances', 320, [[hourlyUse('b3-8'), 320]]],
        ['objectStorage', 20, [[BUCKET_STORAGE, 20]]],
      ], 0),
    });
  });

  test('projects nothing over a complete month', async () => {
    const { body: billed } = await productsOf(STAGING, OF_MONTH_BEFORE);

    expect(await productsOf(STAGING, `${OF_MONTH_BEFORE}&projected=true`)).toEqual({
      status: 200,
      body: projectedProducts([150.5, 0], [
        ['instances', 110, 0, [[hourlyUse('b3-16'), 110, 0]]],
        ['registry', 40.5, 0, [[REGISTRY, 40.5, 0]]],
      ], [-20, 0]),
    });
    expect(billed).toEqual(billedProducts(150.5, [
      ['instances', 110, [[hourlyUse('b3-16'), 110]]],
      ['registry', 40.5, [[REGISTRY, 40.5]]],
    ], -20));
  });

  // The lines of the month before, and the same again, projected, in the month in progress
  test('projects the month in progress over a period that covers it', async () => {
    expect(await productsOf(STAGING, `${UP_TO_TODAY}&projected=true`)).toEqual({
      status: 200,
      body: projectedProducts([301, 150.5], [
        ['instances', 220, 110, [[hourlyUse('b3-16'), 220, 110]]],
        ['registry', 81, 40.5, [[REGISTRY, 81, 40.5]]],
      ], [-40, -20]),
    });
  });

  // A project's bill lines belong to the account of their bill (ADR 0002), and so do its
  // projected lines, those of its bills of the month before
  test.each([
    [...LYON_BILLED_LATE, STAGING, STAGING_PROJECTED],
    [...ALL_ACCOUNTS, STAGING, STAGING_PROJECTED],
    // Which never billed Staging
    [...PARIS_BILLED, STAGING, NOTHING],
    [...UNKNOWN_BILLED_LATE, LEGACY, LEGACY_PROJECTED],
    [...ALL_ACCOUNTS, LEGACY, LEGACY_PROJECTED],
    // The charge of its disks named without the period of their line
    [...PARIS_BILLED, PARIS_PROJECT, projectedProducts([50, 0], [
      ['volumes', 50, 0, [[DISKS, 50, 0]]],
    ], [0, 0])],
  ])('projects the products of %s', async (_, account, projectOfAccount, products) => {
    expect(await productsOf(projectOfAccount, `${OF_TODAY}&projected=true`, account))
      .toEqual({ status: 200, body: products });
  });

  // What the Compare tab's detail of a project breaks down: its row of the comparison by
  // project, of the same account and period, its projected part included
  test.each([
    [...LYON_BILLED_LATE, STAGING, OF_TODAY],
    [...ALL_ACCOUNTS, STAGING, OF_TODAY],
    [...UNKNOWN_BILLED_LATE, LEGACY, OF_TODAY],
    [...LYON_BILLED_LATE, PRODUCTION, OF_TODAY],
    [...ALL_ACCOUNTS, STAGING, UP_TO_TODAY],
  ])('add up, with the credit, to the cost by project of %s, and to its projected part',
    async (_, account, projectOfAccount, parameters) => {
      const { body: { total, projected, credits, projectedCredits } } = await productsOf(
        projectOfAccount, `${parameters}&projected=true`, account,
      );
      const { body: projects } = await answerOf(
        '/api/analysis/by-project', `${parameters}&projected=true`, account,
      );
      const [projectId] = projectOfAccount;

      expect(projects.find((row) => row.projectId === projectId))
        .toMatchObject({ total: total + credits, projected: projected + projectedCredits });
    });
});

test.each([
  ['/api/analysis/by-project', 'projected=yes'],
  ['/api/analysis/by-project', 'projected=true&projected=true'],
  [`/api/projects/${STAGING[0]}/products`, 'projected=yes'],
  [`/api/projects/${STAGING[0]}/products`, 'projected=true&projected=true'],
])('%s refuses a projected parameter that is neither true nor false: %s',
  async (route, parameter) => {
    expect(await ocm.get(`${route}?${OF_TODAY}&${parameter}`)).toEqual({
      status: 400, body: { error: "Invalid 'projected' parameter: expected true or false" },
    });
  });
