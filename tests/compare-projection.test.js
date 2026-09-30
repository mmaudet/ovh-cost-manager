/**
 * The projection of the month in progress in the routes of the Compare tab (CONTEXT.md, #218), on
 * the server started in a child process over a database that the test seeds: the summary, the
 * costs by service type and by resource type, the services of a resource type, and the Veeam
 * backups and their services. With `projected=true`, the month in progress, when their period
 * covers it, counts each recurring service that it has not billed yet at its bill lines of the
 * month before, counted as they were, their classification included: its projected cost. Each row
 * gives its projected part, 0 when it has none, and a row that projected lines alone make is
 * listed too. Without the parameter, they answer as before. The bills are dated from the real date
 * (see support/month-in-progress.js).
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, project,
} = require('./support/accounts');
const {
  ALL_ACCOUNTS, LYON_BILLED_LATE, MONTH_BEFORE, MONTH_IN_PROGRESS, MONTH_OF_TODAY, MONTHS_BEFORE,
  OF_BOTH_MONTHS, OF_MONTH_BEFORE, OF_TODAY, PARIS_BILLED, UNKNOWN_BILLED_LATE, billOf,
} = require('./support/month-in-progress');
const { startOcm } = require('./support/ocm-server');

// The days of the month of today, which the summary's daily average divides its total by
const DAYS_OF_TODAY = Number(MONTH_IN_PROGRESS.to.slice(8));
const dailyAverage = (total) => Math.round((total / DAYS_OF_TODAY) * 100) / 100;

// The six routes of the Compare tab that project the month in progress
const ROUTES = [
  '/api/summary',
  '/api/analysis/by-service',
  '/api/analysis/by-resource-type',
  '/api/analysis/resource-type-details',
  '/api/analysis/backup-stats',
  '/api/analysis/backup-services',
];

// A single account, billed on the first day of each month for its Production project and the
// backup of one VM, and late in the month for the rest: its Staging project, a dedicated server,
// a licence, the backup of another VM and a Veeam Enterprise licence. The bill of the month of
// today charged Production, a bit more than before, and the first VM; the one that will charge the
// rest has not come yet. The server cost more in the month before than in the two months before
// it, and the second VM had extra storage then. A domain was renewed for a year in the month
// before. Every NIC handle, identifier and amount is made up.
const PRODUCTION = 'project-production';
const STAGING = 'project-staging';
const SERVER = 'ns3000001.ip-203-0-113.eu';
const SERVER_RENTAL = `Location du serveur RISE-1 ${SERVER} - 1 mois`;
const LICENCE = 'windows-2022-std-0001';
const VM_BILLED_EARLY = 'vm-db-1';
const VM_BILLED_LATE = 'vm-web-1';
const VEEAM_LICENCE = 'veeam-licence-1';
const VEEAM_ENTERPRISE = 'Veeam Enterprise Plus licence';
// What a line says besides its service, by what it pays for
const COMPUTE = { serviceType: 'Compute' };
const LICENCES = { serviceType: 'Licenses' };
const backupOf = (vm, price, description = `Veeam Backup ${vm}`) => [
  vm, 'backup', price, { description, serviceType: 'Backup' },
];

function seedLateBill(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR' });
  project(db, PRODUCTION, 'Production', LYON);
  project(db, STAGING, 'Staging', LYON);
  [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
    billOf(db, `FR10${index}1`, LYON, `${yearMonth}-01`, [
      [PRODUCTION, 'cloud_project', yearMonth === MONTH_OF_TODAY ? 610 : 600, COMPUTE],
      backupOf(VM_BILLED_EARLY, 15),
    ]);
  });
  MONTHS_BEFORE.forEach((yearMonth, index) => {
    const monthBefore = yearMonth === MONTH_BEFORE;
    billOf(db, `FR10${index}2`, LYON, `${yearMonth}-25`, [
      [STAGING, 'cloud_project', 100, COMPUTE],
      [SERVER, 'dedicated_server', monthBefore ? 210 : 200,
        { description: SERVER_RENTAL, serviceType: 'Compute' }],
      [LICENCE, 'license', 30, LICENCES],
      backupOf(VM_BILLED_LATE, 20),
      [VEEAM_LICENCE, 'license', 25, { description: VEEAM_ENTERPRISE, serviceType: 'Licenses' }],
      ...(monthBefore
        ? [
          backupOf(VM_BILLED_LATE, 5, `Veeam Backup ${VM_BILLED_LATE} - stockage supplémentaire`),
          ['example.com', 'domain', 15],
        ]
        : []),
    ]);
  });
}

// What the month of today billed so far: Production and the first VM; and what its projected
// lines add, the lines of the month before of the rest: Staging, 100 €, the server, 210 €, the
// licence, 30 €, the second VM, 20 € and 5 € of extra storage, and the Veeam licence, 25 €. Not
// the domain, which no month but the month before billed.
const BILLED = 625;
const PROJECTED = 390;

describe('the routes of the Compare tab with projected=true (#218)', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedLateBill });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  describe('GET /api/summary', () => {
    const summaryOf = (parameters) => ocm.get(`/api/summary?${parameters}`);

    // Its bill of the month only, and Staging among its projects
    test('adds the projected lines of the month in progress, and gives their part', async () => {
      expect(await summaryOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: {
          period: MONTH_IN_PROGRESS,
          total: BILLED + PROJECTED,
          projected: PROJECTED,
          cloudTotal: 710,
          nonCloudTotal: 305,
          dailyAverage: dailyAverage(BILLED + PROJECTED),
          billsCount: 1,
          projectsCount: 2,
          topProjects: [
            { name: 'Production', value: 610, projected: 0 },
            { name: 'Staging', value: 100, projected: 100 },
          ],
        },
      });
    });

    test.each([
      ['without the parameter', OF_TODAY],
      ['with projected=false', `${OF_TODAY}&projected=false`],
    ])('answers as before %s: what the month billed so far', async (_, parameters) => {
      expect(await summaryOf(parameters)).toEqual({
        status: 200,
        body: {
          period: MONTH_IN_PROGRESS,
          total: BILLED,
          cloudTotal: 610,
          nonCloudTotal: 15,
          dailyAverage: dailyAverage(BILLED),
          billsCount: 1,
          projectsCount: 1,
          topProjects: [{ name: 'Production', value: 610 }],
        },
      });
    });

    // Complete months are never projected
    test('projects nothing over a complete month', async () => {
      const { body: billed } = await summaryOf(OF_MONTH_BEFORE);

      expect(await summaryOf(`${OF_MONTH_BEFORE}&projected=true`)).toEqual({
        status: 200,
        body: {
          ...billed,
          projected: 0,
          topProjects: billed.topProjects.map((row) => ({ ...row, projected: 0 })),
        },
      });
      expect(billed.total).toBe(1020);
    });

    // The month before and the month in progress: the projected lines, of the month before, count
    // in the month in progress too
    test('projects the month in progress over a period that covers it', async () => {
      const { body } = await summaryOf(`${OF_BOTH_MONTHS}&projected=true`);

      expect(body).toMatchObject({ total: 1020 + BILLED + PROJECTED, projected: PROJECTED });
    });
  });

  describe('GET /api/analysis/by-service', () => {
    const serviceTypesOf = (parameters) => ocm.get(`/api/analysis/by-service?${parameters}`);
    const serviceType = (name, value, color, detailsCount, projected) => ({
      name, value, color, detailsCount, ...(projected === undefined ? {} : { projected }),
    });

    // Each projected line under the service type of its line: the licences, which only projected
    // lines make, are listed too
    test('adds the projected lines under their service types, with their parts', async () => {
      expect(await serviceTypesOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [
          serviceType('Compute', 920, '#3b82f6', 3, 310),
          serviceType('Licenses', 55, '#06b6d4', 2, 55),
          serviceType('Backup', 40, '#059669', 3, 25),
        ],
      });
    });

    test('answers as before without the parameter', async () => {
      expect(await serviceTypesOf(OF_TODAY)).toEqual({
        status: 200,
        body: [serviceType('Compute', 610, '#3b82f6', 1), serviceType('Backup', 15, '#059669', 1)],
      });
    });

    test('projects nothing over a complete month', async () => {
      const { body: billed } = await serviceTypesOf(OF_MONTH_BEFORE);

      expect((await serviceTypesOf(`${OF_MONTH_BEFORE}&projected=true`)).body)
        .toEqual(billed.map((row) => ({ ...row, projected: 0 })));
    });
  });

  describe('GET /api/analysis/by-resource-type', () => {
    const resourceTypesOf = (parameters) => ocm.get(
      `/api/analysis/by-resource-type?${parameters}`,
    );
    const resourceType = ([name, type, color], value, [details, services], projected) => ({
      name, resource_type: type, value, color, detailsCount: details, serviceCount: services,
      ...(projected === undefined ? {} : { projected }),
    });
    const PUBLIC_CLOUD = ['Public Cloud', 'cloud_project', '#3b82f6'];
    const DEDICATED_SERVERS = ['Dedicated Servers', 'dedicated_server', '#ef4444'];
    const LICENSES = ['Licenses', 'license', '#0891b2'];
    const BACKUP = ['Backup', 'backup', '#059669'];

    // The dedicated servers and the licences, which only projected lines make, are listed too
    test('adds the projected lines under their resource types, with their parts', async () => {
      expect(await resourceTypesOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [
          resourceType(PUBLIC_CLOUD, 710, [2, 2], 100),
          resourceType(DEDICATED_SERVERS, 210, [1, 1], 210),
          resourceType(LICENSES, 55, [2, 2], 55),
          resourceType(BACKUP, 40, [3, 2], 25),
        ],
      });
    });

    test('answers as before without the parameter', async () => {
      expect(await resourceTypesOf(OF_TODAY)).toEqual({
        status: 200,
        body: [resourceType(PUBLIC_CLOUD, 610, [1, 1]), resourceType(BACKUP, 15, [1, 1])],
      });
    });

    test('projects nothing over a complete month', async () => {
      const { body: billed } = await resourceTypesOf(OF_MONTH_BEFORE);

      expect((await resourceTypesOf(`${OF_MONTH_BEFORE}&projected=true`)).body)
        .toEqual(billed.map((row) => ({ ...row, projected: 0 })));
    });
  });

  describe('GET /api/analysis/resource-type-details', () => {
    const servicesOf = (type, parameters) => ocm.get(
      `/api/analysis/resource-type-details?type=${type}&${parameters}`,
    );

    // With the description of its projected line, as the month before billed it
    test('lists a service that only projected lines make, with its description', async () => {
      expect(await servicesOf('dedicated_server', `${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [{
          domain: SERVER, description: SERVER_RENTAL, total: 210, line_count: 1, projected: 210,
        }],
      });
      expect(await servicesOf('dedicated_server', OF_TODAY)).toEqual({ status: 200, body: [] });
    });

    // The second VM at its two lines of the month before, the most expensive's description
    test('gives each service its projected part, 0 for one that the month billed', async () => {
      expect(await servicesOf('backup', `${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: [
          {
            domain: VM_BILLED_LATE, description: `Veeam Backup ${VM_BILLED_LATE}`, total: 25,
            line_count: 2, projected: 25,
          },
          {
            domain: VM_BILLED_EARLY, description: `Veeam Backup ${VM_BILLED_EARLY}`, total: 15,
            line_count: 1, projected: 0,
          },
        ],
      });
    });

    test('answers as before without the parameter', async () => {
      expect(await servicesOf('backup', OF_TODAY)).toEqual({
        status: 200,
        body: [{
          domain: VM_BILLED_EARLY, description: `Veeam Backup ${VM_BILLED_EARLY}`, total: 15,
          line_count: 1,
        }],
      });
    });

    test('projects nothing over a complete month', async () => {
      const { body: billed } = await servicesOf('dedicated_server', OF_MONTH_BEFORE);

      expect((await servicesOf('dedicated_server', `${OF_MONTH_BEFORE}&projected=true`)).body)
        .toEqual(billed.map((row) => ({ ...row, projected: 0 })));
      expect(billed).toEqual([
        { domain: SERVER, description: SERVER_RENTAL, total: 210, line_count: 1 },
      ]);
    });
  });

  describe('GET /api/analysis/backup-stats', () => {
    const backupsOf = (parameters) => ocm.get(`/api/analysis/backup-stats?${parameters}`);

    // The second VM among the VMs, and the Veeam licence, which only its projected line makes
    test('counts the projected services among the backups, with their parts', async () => {
      expect(await backupsOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: {
          vms: { count: 2, total: 40, projected: 25 },
          enterprise: { count: 1, total: 25, projected: 25 },
        },
      });
    });

    test('answers as before without the parameter', async () => {
      expect(await backupsOf(OF_TODAY)).toEqual({
        status: 200,
        body: { vms: { count: 1, total: 15 }, enterprise: { count: 0, total: 0 } },
      });
    });

    test('projects nothing over a complete month', async () => {
      expect(await backupsOf(`${OF_MONTH_BEFORE}&projected=true`)).toEqual({
        status: 200,
        body: {
          vms: { count: 2, total: 40, projected: 0 },
          enterprise: { count: 1, total: 25, projected: 0 },
        },
      });
    });
  });

  describe('GET /api/analysis/backup-services', () => {
    const servicesOf = (parameters) => ocm.get(`/api/analysis/backup-services?${parameters}`);

    test('lists the projected services, with their descriptions and their parts', async () => {
      expect(await servicesOf(`${OF_TODAY}&projected=true`)).toEqual({
        status: 200,
        body: {
          vms: [
            {
              domain: VM_BILLED_LATE, description: `Veeam Backup ${VM_BILLED_LATE}`, total: 25,
              line_count: 2, projected: 25,
            },
            {
              domain: VM_BILLED_EARLY, description: `Veeam Backup ${VM_BILLED_EARLY}`,
              total: 15, line_count: 1, projected: 0,
            },
          ],
          enterprise: [{
            domain: VEEAM_LICENCE, description: VEEAM_ENTERPRISE, total: 25, line_count: 1,
            projected: 25,
          }],
        },
      });
    });

    test('answers as before without the parameter', async () => {
      expect(await servicesOf(OF_TODAY)).toEqual({
        status: 200,
        body: {
          vms: [{
            domain: VM_BILLED_EARLY, description: `Veeam Backup ${VM_BILLED_EARLY}`, total: 15,
            line_count: 1,
          }],
          enterprise: [],
        },
      });
    });

    test('projects nothing over a complete month', async () => {
      const { body: billed } = await servicesOf(OF_MONTH_BEFORE);
      const withoutPart = (services) => services.map((row) => ({ ...row, projected: 0 }));

      expect((await servicesOf(`${OF_MONTH_BEFORE}&projected=true`)).body).toEqual({
        vms: withoutPart(billed.vms), enterprise: withoutPart(billed.enterprise),
      });
      // The second VM, with its extra storage, the first, and the Veeam licence
      expect(billed.vms.map(({ domain, total }) => [domain, total]))
        .toEqual([[VM_BILLED_LATE, 25], [VM_BILLED_EARLY, 15]]);
      expect(billed.enterprise.map(({ domain, total }) => [domain, total]))
        .toEqual([[VEEAM_LICENCE, 25]]);
    });

    // As many as the Veeam backups count, and adding up to their cost and projected part
    test('add up to the projected backups', async () => {
      const { body: services } = await servicesOf(`${OF_TODAY}&projected=true`);
      const { body: stats } = await ocm.get(
        `/api/analysis/backup-stats?${OF_TODAY}&projected=true`,
      );
      const figures = (rowServices) => ({
        count: rowServices.length,
        total: rowServices.reduce((sum, { total }) => sum + total, 0),
        projected: rowServices.reduce((sum, { projected }) => sum + projected, 0),
      });

      expect({ vms: figures(services.vms), enterprise: figures(services.enterprise) })
        .toEqual(stats);
    });
  });

  test.each(ROUTES)('%s refuses a projected parameter that is neither true nor false',
    async (route) => {
      expect(await ocm.get(`${route}?type=backup&${OF_TODAY}&projected=yes`)).toEqual({
        status: 400, body: { error: "Invalid 'projected' parameter: expected true or false" },
      });
    });
});

// Read when the server reads the bills: no re-import, nor any restart
describe('the routes of the Compare tab with projected=true once the late bill comes', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedLateBill });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // The late bill charges the rest, for less than in the month before
  test('project nothing once the import stores the bill of each recurring service', async () => {
    ocm.write((db) => billOf(db, 'FR1032', LYON, `${MONTH_OF_TODAY}-01`, [
      [STAGING, 'cloud_project', 90, COMPUTE],
      [SERVER, 'dedicated_server', 190, { description: SERVER_RENTAL, serviceType: 'Compute' }],
      [LICENCE, 'license', 30, LICENCES],
      backupOf(VM_BILLED_LATE, 20),
      [VEEAM_LICENCE, 'license', 25, { description: VEEAM_ENTERPRISE, serviceType: 'Licenses' }],
    ]));

    expect((await ocm.get(`/api/summary?${OF_TODAY}&projected=true`)).body)
      .toMatchObject({ total: BILLED + 355, projected: 0, billsCount: 2 });
    const { body: resourceTypes } = await ocm.get(
      `/api/analysis/by-resource-type?${OF_TODAY}&projected=true`,
    );
    expect(resourceTypes.map(({ resource_type: type, value, projected }) => [
      type, value, projected,
    ])).toEqual([
      ['cloud_project', 700, 0], ['dedicated_server', 190, 0], ['license', 55, 0],
      ['backup', 35, 0],
    ]);
  });
});

// As the months list's mark (#216) and the trends (#217), the projection follows the account
// parameter: the recurring services of the account asked, those of the Unknown account for
// `unknown`, and those of every account without it, whose projections add up. The routes that
// take byAccount give each service once for each account that billed it, with that account and
// its own projected part.
describe('the routes of the Compare tab with projected=true and several accounts', () => {
  let ocm;
  const LYON_SERVER = 'ns3000001.ip-203-0-113.eu';
  const UNKNOWN_SERVER = 'ns3000004.ip-203-0-113.eu';
  const UNKNOWN_LICENCE = 'veeam-licence-0';

  // Lyon, billed late for its dedicated server and the backup of a VM, and the Unknown account,
  // billed late for its own server, the backup of a VM and a Veeam licence: the bills of the month
  // of today that will charge them have not come yet. Paris, whose bill of the month of today
  // charged all its services. Each account's bill of the month of today charged its other
  // services.
  function seedAccounts(db) {
    db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
    db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
    project(db, 'project-lyon', 'Lyon', LYON);
    project(db, 'project-paris', 'Paris', PARIS);
    [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
      billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [
        ['project-lyon', 'cloud_project', 600, COMPUTE],
      ]);
      billOf(db, `FR2${index}01`, PARIS, `${yearMonth}-01`, [
        ['project-paris', 'cloud_project', 400, COMPUTE], backupOf('vm-paris-1', 10),
      ]);
      billOf(db, `FR0${index}01`, null, `${yearMonth}-01`, [['example.com', 'domain', 15]]);
    });
    MONTHS_BEFORE.forEach((yearMonth, index) => {
      billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [
        [LYON_SERVER, 'dedicated_server', 200, COMPUTE], backupOf('vm-lyon-1', 12),
      ]);
      billOf(db, `FR0${index}02`, null, `${yearMonth}-25`, [
        [UNKNOWN_SERVER, 'dedicated_server', 80, COMPUTE], backupOf('vm-old-1', 8),
        [UNKNOWN_LICENCE, 'license', 25, { description: VEEAM_ENTERPRISE, ...LICENCES }],
      ]);
    });
  }

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedAccounts });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // The answer of a route over the month of today with projected=true, for the account that the
  // parameter names, or for every account without one, and with the parameters given besides
  const projectedOf = (route, account, parameters = '') => ocm.get(`${route}?${OF_TODAY}`
    + `${parameters}&projected=true${account === undefined ? '' : `&account=${account}`}`);
  // A service of a resource type or of the backups, as the routes give it: its description, the
  // service followed by « 1 mois », or that of a backup
  const service = (domain, total, projected, description = `${domain} - 1 mois`) => ({
    domain, description, total, line_count: 1, projected,
  });
  const backup = (vm, total, projected) => service(vm, total, projected, `Veeam Backup ${vm}`);

  test.each([
    [...LYON_BILLED_LATE, [
      ['cloud_project', 600, 0], ['dedicated_server', 200, 200], ['backup', 12, 12],
    ]],
    [...PARIS_BILLED, [['cloud_project', 400, 0], ['backup', 10, 0]]],
    [...UNKNOWN_BILLED_LATE, [
      ['dedicated_server', 80, 80], ['license', 25, 25], ['domain', 15, 0], ['backup', 8, 8],
    ]],
    [...ALL_ACCOUNTS, [
      ['cloud_project', 1000, 0], ['dedicated_server', 280, 280], ['backup', 30, 20],
      ['license', 25, 25], ['domain', 15, 0],
    ]],
  ])('project the resource types of %s', async (_, account, resourceTypes) => {
    const { body } = await projectedOf('/api/analysis/by-resource-type', account);

    expect(body.map(({ resource_type: type, value, projected }) => [type, value, projected]))
      .toEqual(resourceTypes);
  });

  // Each projected line under the service type of its line
  test.each([
    [...LYON_BILLED_LATE, [['Compute', 800, 200], ['Backup', 12, 12]]],
    [...PARIS_BILLED, [['Compute', 400, 0], ['Backup', 10, 0]]],
    [...UNKNOWN_BILLED_LATE, [
      ['Compute', 80, 80], ['Licenses', 25, 25], ['Other', 15, 0], ['Backup', 8, 8],
    ]],
    [...ALL_ACCOUNTS, [
      ['Compute', 1280, 280], ['Backup', 30, 20], ['Licenses', 25, 25], ['Other', 15, 0],
    ]],
  ])('project the service types of %s', async (_, account, serviceTypes) => {
    const { body } = await projectedOf('/api/analysis/by-service', account);

    expect(body.map(({ name, value, projected }) => [name, value, projected]))
      .toEqual(serviceTypes);
  });

  test('give summaries of the accounts that add up to that of all accounts', async () => {
    const summaryOf = async (account) => (await projectedOf('/api/summary', account)).body;
    const ofEachAccount = await Promise.all([LYON, PARIS, UNKNOWN_ACCOUNT].map(summaryOf));
    const ofAllAccounts = await summaryOf(undefined);

    expect(ofEachAccount.map(({ total, projected }) => [total, projected]))
      .toEqual([[812, 212], [410, 0], [128, 113]]);
    expect(ofAllAccounts).toMatchObject({ total: 1350, projected: 325 });
  });

  test.each([
    [...LYON_BILLED_LATE, [service(LYON_SERVER, 200, 200)]],
    [...PARIS_BILLED, []],
    [...UNKNOWN_BILLED_LATE, [service(UNKNOWN_SERVER, 80, 80)]],
  ])('give the services of a resource type of %s, with their parts', async (
    _, account, services,
  ) => {
    expect(await projectedOf('/api/analysis/resource-type-details', account,
      '&type=dedicated_server')).toEqual({ status: 200, body: services });
  });

  // The server of Lyon and that of the Unknown account, each with its account
  test('give each service of a resource type with its account and its part, by account',
    async () => {
      expect(await projectedOf('/api/analysis/resource-type-details', undefined,
        '&type=dedicated_server&byAccount=true')).toEqual({
        status: 200,
        body: [
          { ...service(LYON_SERVER, 200, 200), account: LYON },
          { ...service(UNKNOWN_SERVER, 80, 80), account: null },
        ],
      });
    });

  test.each([
    [...LYON_BILLED_LATE, { vms: [backup('vm-lyon-1', 12, 12)], enterprise: [] }],
    [...PARIS_BILLED, { vms: [backup('vm-paris-1', 10, 0)], enterprise: [] }],
    [...UNKNOWN_BILLED_LATE, {
      vms: [backup('vm-old-1', 8, 8)],
      enterprise: [service(UNKNOWN_LICENCE, 25, 25, VEEAM_ENTERPRISE)],
    }],
  ])('give the services of the backups of %s, with their parts', async (_, account, services) => {
    expect(await projectedOf('/api/analysis/backup-services', account))
      .toEqual({ status: 200, body: services });
  });

  test('give the services of the backups with their accounts and their parts, by account',
    async () => {
      const { body } = await projectedOf('/api/analysis/backup-services', undefined,
        '&byAccount=true');

      expect(body.vms.map(({ domain, total, account, projected }) => [
        domain, total, account, projected,
      ])).toEqual([
        ['vm-lyon-1', 12, LYON, 12], ['vm-paris-1', 10, PARIS, 0], ['vm-old-1', 8, null, 8],
      ]);
      expect(body.enterprise.map(({ domain, account, projected }) => [domain, account, projected]))
        .toEqual([[UNKNOWN_LICENCE, null, 25]]);
    });

  test.each([
    [...LYON_BILLED_LATE, [1, 12, 12], [0, 0, 0]],
    [...PARIS_BILLED, [1, 10, 0], [0, 0, 0]],
    [...UNKNOWN_BILLED_LATE, [1, 8, 8], [1, 25, 25]],
    [...ALL_ACCOUNTS, [3, 30, 20], [1, 25, 25]],
  ])('count the backups of %s, with their parts', async (_, account, vms, licences) => {
    const figures = ([count, total, projected]) => ({ count, total, projected });

    expect(await projectedOf('/api/analysis/backup-stats', account)).toEqual({
      status: 200, body: { vms: figures(vms), enterprise: figures(licences) },
    });
  });
});
