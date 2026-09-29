/**
 * The charges of a Public Cloud project's products over a period (#195), which the Compare
 * tab's comparison of the project unfolds each product into, on the server started in a child
 * process over a database that the test seeds. The products route gives each product its
 * charges (see CONTEXT.md): what its bill lines pay for, as their descriptions name it without
 * the period that ends them in brackets on some accounts' bills, the lines of one charge added
 * up, to the cent, the most expensive first, those at 0 € left out, as the products at 0 € are.
 * The credit that the bills used pays for no product: it has none.
 */

const { LYON, PARIS, bill, project } = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');
const { classifyService } = require('../data/classify');

// A Public Cloud project of the Lyon subsidiary, billed on the bills of Paris too, as a project
// moved from one account to the other is
const PRODUCTION = 'project-production';

// A bill line of the Production project, whose service is the project, classified as the import
// classifies it
const line = (id, billId, description, price) => ({
  id, bill_id: billId, project_id: PRODUCTION, domain: PRODUCTION, description, quantity: 1,
  unit_price: price, total_price: price, service_type: classifyService(description),
  resource_type: 'cloud_project',
});

// What the lines of the project pay for, as OVHcloud words them: a bucket's storage, the
// bandwidth of the buckets of a class and region, and the additional disks of a type in a region
const BUCKET_STORAGE = 'Stockage Standard - Bucket assets sur la région gra';
const BANDWIDTH = 'Bande passante - stockage d\'objects Public Cloud - gra';
const DISKS = 'Disques supplémentaires à gra11 de type classic';
// An instance's monthly plan, which names its flavor, the instance and its region, and the
// prorata of another's, for the month its plan started; the hourly use of a flavor in a region
const monthlyPlan = (instance) => 'Forfait mensuel pour une instance r3-32 '
  + `(id 5a1c2e3d-0000-4000-8000-00000000000${instance}, region sbg5) - 01 mois`;
const PRORATA = 'Prorata de la facturation mensuelle d\'une instance r3-32 '
  + '(id 5a1c2e3d-0000-4000-8000-000000000003, region sbg5)';
const HOURLY_USE = 'Consommation à l\'heure pour les instances b3-8 gra11';
// The same, with the curly apostrophe that some bills write
const HOURLY_USE_CURLY = 'Consommation à l’heure pour les instances b3-8 gra11';
// The snapshots of a region
const snapshotsIn = (region) => `Snapshots Public Cloud - ${region}`;
// An AI Endpoints model's input tokens
const INPUT_TOKENS = 'Nombre de tokens d\'entrée pour le modèle AI Endpoints gpt-oss-20b';
// The Public Cloud credit that a bill used
const CREDIT = 'Utilisation du credit cloud';

// A description as the bills of Paris word it: ending with the period that the line covers, the
// month before its bill's for a Public Cloud project
const endingWith = (period, description) => `${description} (${period})`;
const AUGUST_PERIOD = '01/08/2026-31/08/2026';
const JULY_PERIOD = '01/07/2026-31/07/2026';

// The Lyon subsidiary, whose descriptions carry no period, and Paris, whose descriptions end with
// their period, both billed the project. Every NIC handle, name, identifier and amount is made
// up; the descriptions are OVHcloud's.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  project(db, PRODUCTION, 'Production', LYON);
  // Two bills of Lyon in September, and one of Paris, and Paris's of August
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-09-25', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  bill(db, 'FR2002', '2026-08-10', PARIS);
  db.details.insertMany([
    line('FR1001-1', 'FR1001', BUCKET_STORAGE, 14),
    line('FR1001-2', 'FR1001', BANDWIDTH, 0.25),
    line('FR1001-3', 'FR1001', DISKS, 4.5),
    line('FR1001-4', 'FR1001', monthlyPlan(2), 64),
    line('FR1001-5', 'FR1001', monthlyPlan(1), 64),
    line('FR1001-6', 'FR1001', PRORATA, 20),
    line('FR1001-7', 'FR1001', HOURLY_USE, 30),
    line('FR1001-8', 'FR1001', INPUT_TOKENS, 1.004),
    line('FR1001-9', 'FR1001', snapshotsIn('gra11'), 4),
    line('FR1001-10', 'FR1001', snapshotsIn('sbg5'), 2),
    line('FR1001-11', 'FR1001', snapshotsIn('bhs5'), 0),
    line('FR1001-12', 'FR1001', CREDIT, -10),
    line('FR1002-1', 'FR1002', BUCKET_STORAGE, 6),
    line('FR1002-2', 'FR1002', INPUT_TOKENS, 2.003),
    // A refund of the snapshots of sbg5
    line('FR1002-3', 'FR1002', snapshotsIn('sbg5'), -2),
    line('FR2001-1', 'FR2001', endingWith(AUGUST_PERIOD, DISKS), 3),
    line('FR2001-2', 'FR2001', endingWith(AUGUST_PERIOD, HOURLY_USE_CURLY), 12),
    line('FR2002-1', 'FR2002', endingWith(JULY_PERIOD, DISKS), 2.5),
  ]);
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

const ROUTE = `/api/projects/${PRODUCTION}/products`;
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';

// The route's answer for a period, for the account that the parameter names, or for every
// account without one
const productsOf = (period, account) =>
  ocm.get(`${ROUTE}?${period}${account === undefined ? '' : `&account=${account}`}`);

// The charges of a product in an answer, each as [charge, cost]
const chargesOf = ({ body }, product) => body.products
  .find((entry) => entry.product === product).charges
  .map(({ charge, total }) => [charge, total]);

describe('GET /api/projects/:id/products: the charges of each product', () => {
  // The lines of a charge on each of Lyon's two bills of September
  test("adds up the lines of each charge, and gives a bucket's storage and its bandwidth",
    async () => {
      expect(chargesOf(await productsOf(SEPTEMBER, LYON), 'objectStorage')).toEqual([
        [BUCKET_STORAGE, 20],
        [BANDWIDTH, 0.25],
      ]);
    });

  // Paris's bill of September ends it with its period, Lyon's do not: the same charge
  test('gives one charge for a description that ends with its period and the same without it',
    async () => {
      expect(chargesOf(await productsOf(SEPTEMBER), 'volumes')).toEqual([[DISKS, 7.5]]);
    });

  // Two instances of the same flavor in the same region, on monthly plans, and a third, whose
  // plan started during the month: the brackets that name an instance and its region are no
  // period. Charges of the same cost come by charge.
  test("gives each instance's monthly plan, and a prorata, a charge of its own", async () => {
    expect(chargesOf(await productsOf(SEPTEMBER, LYON), 'instances')).toEqual([
      [monthlyPlan(1), 64],
      [monthlyPlan(2), 64],
      [HOURLY_USE, 30],
      [PRORATA, 20],
    ]);
  });

  // Lyon's bill writes its apostrophe straight, Paris's curly: the same charge, as the bills
  // write it straight
  test('gives one charge for descriptions whose apostrophes differ, straight or curly',
    async () => {
      expect(chargesOf(await productsOf(SEPTEMBER), 'instances')).toEqual([
        [monthlyPlan(1), 64],
        [monthlyPlan(2), 64],
        [HOURLY_USE, 42],
        [PRORATA, 20],
      ]);
    });

  // 1.004 € and 2.003 € of a model's input tokens, on Lyon's two bills of September
  test('adds up the lines of a charge to the cent', async () => {
    expect(chargesOf(await productsOf(SEPTEMBER, LYON), 'ai')).toEqual([[INPUT_TOKENS, 3.01]]);
  });

  // The snapshots of sbg5, which a refund cancels out, and those of bhs5, which cost nothing
  test('leaves out the charges at 0 €, as the products at 0 € are', async () => {
    expect(chargesOf(await productsOf(SEPTEMBER, LYON), 'snapshots'))
      .toEqual([[snapshotsIn('gra11'), 4]]);
  });

  // As the Compare tab pairs the charges of months A and B by name: the lines of a charge in two
  // months differ by their period only
  test("names a charge alike in each month, whatever the period of its bill's lines",
    async () => {
      expect(chargesOf(await productsOf(AUGUST, PARIS), 'volumes')).toEqual([[DISKS, 2.5]]);
      expect(chargesOf(await productsOf(SEPTEMBER, PARIS), 'volumes')).toEqual([[DISKS, 3]]);
    });

  // The credit that the bills used stays apart, as it pays for no product
  test('gives the credit no charge', async () => {
    const { body } = await productsOf(SEPTEMBER, LYON);

    expect(body.credits).toBe(-10);
    expect(body.products.map(({ product }) => product)).not.toContain('credits');
    expect(body.products.flatMap(({ charges }) => charges.map(({ charge }) => charge)))
      .not.toContain(CREDIT);
  });
});
