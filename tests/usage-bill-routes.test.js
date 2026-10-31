/**
 * The routes of one bill, of the server started in a child process, with a throwaway HOME and
 * DATA_DIR, over a database that the test seeds as the import writes it: they give OVH's bills
 * alone, and no usage bill (CONTEXT.md), whose lines included (ADR 0004).
 */

const { startOcm } = require('./support/ocm-server');
const {
  LYON, recordAccounts, bill, project,
} = require('./support/accounts');

const PROJECT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// The usage bill of the account's September, dated on 1 October, as the import names it
const USAGE_BILL = `usage-${LYON}-2026-09`;

// A line of a bill of the project, an hourly flavor's, without its id and bill
const LINE = {
  project_id: PROJECT, domain: PROJECT, description: 'b3-8 instance in GRA9', quantity: 100,
  unit_price: 0.08, total_price: 8, service_type: 'compute', resource_type: null,
};

// The account, read from its Public Cloud usage since October: its project, its OVH bill of
// September, and its usage bill of September, as the import stores them
function seed(db) {
  recordAccounts(db, { nic: LYON, costSource: 'cloudUsage' });
  project(db, PROJECT, 'Project', LYON);
  bill(db, 'FR1', '2026-09-01', LYON, { priceWithoutTax: 8 });
  db.details.insert({ ...LINE, id: 'FR1_1', bill_id: 'FR1' });
  db.usage.replacePeriod({
    bill: { id: USAGE_BILL, date: '2026-10-01', currency: 'EUR', account: LYON },
    projectId: PROJECT,
    usageId: 'RUN2_202609',
    month: '2026-09',
    lastUpdate: '2026-10-01T06:00:00.000Z',
    lines: [LINE],
  });
}

let ocm;
beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

test('gives an OVH bill and its lines', async () => {
  expect((await ocm.get('/api/bills/FR1')).status).toBe(200);
  const { status, body } = await ocm.get('/api/bills/FR1/details');

  expect(status).toBe(200);
  expect(body.map(({ id }) => id)).toEqual(['FR1_1']);
});

test('gives no line of a usage bill, as of a bill that does not exist', async () => {
  expect((await ocm.get(`/api/bills/${USAGE_BILL}`)).status).toBe(404);
  const { status, body } = await ocm.get(`/api/bills/${USAGE_BILL}/details`);

  expect(status).toBe(200);
  expect(body).toEqual([]);
});
