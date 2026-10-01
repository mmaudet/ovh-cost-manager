/**
 * Logs Data Platform's resource type of its own (#246), on the server started in a child process
 * over a database that the test seeds as the versions before #246 stored the bills: they typed the
 * bill lines of a Logs Data Platform service, `ldp-` and a code, as storage. As it opens the
 * database, the server gives those lines the resource type that the classification gives them now
 * (data/classify.js), so that the bills already imported show Logs Data Platform apart without a
 * new import, and « Storage » no longer counts it. Their service type stays Database.
 */

const { LYON, bill } = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');
const { classifyService } = require('../data/classify');

// A bill line of a service, of the resource type that the versions before #246 gave it, and of
// the service type that the import reads from its description
const line = (id, billId, service, resourceType, description, price) => ({
  id, bill_id: billId, project_id: null, domain: service, description, quantity: 1,
  unit_price: price, total_price: price, service_type: classifyService(description),
  resource_type: resourceType,
});

// The account's Logs Data Platform service, its NetApp file storage, and the lines of each
const LDP = 'ldp-ab-12345';
const NETAPP = 'netapp-5f2c9a1e';
const ACCOUNT_RENTAL = 'Logs - Account rental for 1 month';
const HOT_STORAGE = 'Logs - Streams - Hot Storage 1 to 100 GB';
const COLD_STORAGE = 'Logs - Streams - Cold Storage Standard';
const FILE_STORAGE = 'Enterprise File Storage 1 TB - 1 mois';

// What the versions before #246 stored of an account's bills of August and September: the lines
// of its Logs Data Platform service, the rental of its account and the storage of its streams,
// typed as storage, and those of its NetApp file storage, which are storage. Every identifier and
// amount is made up; the charges are those of an invoice's DBAAS-LOGS lines.
function seedAsBefore246(db) {
  bill(db, 'FR1001', '2026-08-05', LYON);
  bill(db, 'FR1002', '2026-09-05', LYON);
  db.details.insertMany([
    line('FR1001-1', 'FR1001', LDP, 'storage', ACCOUNT_RENTAL, 30),
    line('FR1001-2', 'FR1001', LDP, 'storage', HOT_STORAGE, 12.5),
    line('FR1001-3', 'FR1001', NETAPP, 'storage', FILE_STORAGE, 64.8),
    line('FR1002-1', 'FR1002', LDP, 'storage', ACCOUNT_RENTAL, 30),
    line('FR1002-2', 'FR1002', LDP, 'storage', HOT_STORAGE, 18.4),
    line('FR1002-3', 'FR1002', LDP, 'storage', COLD_STORAGE, 2.1),
    line('FR1002-4', 'FR1002', NETAPP, 'storage', FILE_STORAGE, 64.8),
  ]);
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed: seedAsBefore246 });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

// The costs by resource type of a period, each as its resource type, its cost, and its numbers
// of bill lines and of services
const costsByResourceType = async (period) => {
  const { status, body } = await ocm.get(`/api/analysis/by-resource-type?${period}`);
  return {
    status,
    body: body.map((row) => [row.resource_type, row.value, row.detailsCount, row.serviceCount]),
  };
};
// The services of a resource type in a period, as the Infrastructure tab lists them, and the
// Compare tab under the row it unfolds
const servicesOf = (type, period) =>
  ocm.get(`/api/analysis/resource-type-details?type=${type}&${period}`);

describe('the Logs Data Platform lines that the versions before #246 stored as storage', () => {
  test('are of their own resource type once the server starts, apart from the storage',
    async () => {
      expect(await costsByResourceType(SEPTEMBER)).toEqual({
        status: 200,
        body: [
          // The file storage alone, which the Logs Data Platform lines no longer join
          ['storage', 64.8, 1, 1],
          // 30 + 18.4 + 2.1
          ['logs_data_platform', 50.5, 3, 1],
        ],
      });
      expect(await costsByResourceType('from=2026-08-01&to=2026-08-31')).toEqual({
        status: 200,
        body: [['storage', 64.8, 1, 1], ['logs_data_platform', 42.5, 2, 1]],
      });
    });

  test('are the lines of its services, as the storage keeps the file storage', async () => {
    // Described by the most expensive of its lines
    expect(await servicesOf('logs_data_platform', SEPTEMBER)).toEqual({
      status: 200,
      body: [{ domain: LDP, description: ACCOUNT_RENTAL, total: 50.5, line_count: 3 }],
    });
    expect(await servicesOf('storage', SEPTEMBER)).toEqual({
      status: 200,
      body: [{ domain: NETAPP, description: FILE_STORAGE, total: 64.8, line_count: 1 }],
    });
  });

  // OVHcloud bills Logs Data Platform as « DBAAS-LOGS »: only its resource type changes
  test('keep their service type: Database', async () => {
    const { status, body } = await ocm.get(`/api/analysis/by-service?${SEPTEMBER}`);

    expect(status).toBe(200);
    expect(body.map(({ name, value }) => [name, value])).toEqual([
      ['Storage', 64.8], ['Database', 50.5],
    ]);
  });
});

// The routes by resource type name it, and the dashboard's Overview and Trends tab show it as they
// name it: as OVHcloud names the product, in both languages, and in a colour of its own, lime,
// which no other resource type comes close to
describe('the Logs Data Platform resource type', () => {
  test('has its label and colour among the costs by resource type', async () => {
    const { body } = await ocm.get(`/api/analysis/by-resource-type?${SEPTEMBER}`);

    expect(body.map(({ name, resource_type: type, color }) => [name, type, color])).toEqual([
      ['Storage', 'storage', '#10b981'],
      ['Logs Data Platform', 'logs_data_platform', '#65a30d'],
    ]);
  });

  test('has its label and colour in the trend by resource type, a line of its own', async () => {
    expect(await ocm.get('/api/analysis/monthly-trend-by-category?months=2&end=2026-09'))
      .toEqual({
        status: 200,
        body: {
          // The storage first, which cost the more over the two months
          categories: [
            { key: 'storage', label: 'Storage', color: '#10b981' },
            { key: 'logs_data_platform', label: 'Logs Data Platform', color: '#65a30d' },
          ],
          data: [
            { yearMonth: '2026-08', storage: 64.8, logs_data_platform: 42.5 },
            { yearMonth: '2026-09', storage: 64.8, logs_data_platform: 50.5 },
          ],
        },
      });
  });
});

// Last, as it starts the server again. An import may hold the write lock while the server starts:
// once the lines are reclassified, the server only reads whether any remains (#114).
describe('the server started again over the reclassified bills', () => {
  test('changes nothing, and starts while an import holds the write lock', async () => {
    const release = ocm.holdWriteLock();
    try {
      await ocm.restart();
    } finally {
      release();
    }

    expect(await costsByResourceType(SEPTEMBER)).toEqual({
      status: 200,
      body: [['storage', 64.8, 1, 1], ['logs_data_platform', 50.5, 3, 1]],
    });
    expect(await servicesOf('logs_data_platform', SEPTEMBER)).toEqual({
      status: 200,
      body: [{ domain: LDP, description: ACCOUNT_RENTAL, total: 50.5, line_count: 3 }],
    });
  }, 30000);
});
