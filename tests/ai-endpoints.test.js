/**
 * The AI Endpoints models of a period (#193), which the Public Cloud tab lists, and their cost
 * month by month, which the Trends tab charts (#196), on the server started in a child process
 * over a database that the test seeds with several accounts, as the Trends tab's account tests
 * do for the GPU costs. The route reads the AI Endpoints model that each bill line of a Public
 * Cloud project names (see CONTEXT.md), and what the line counts: a model's input tokens and
 * output tokens, in French and in English, whose number is the line's quantity, and its cost,
 * all its lines together, the projects together. As on the other routes (#115), a NIC handle
 * that the accounts table records selects that account's bills, the reserved value `unknown`
 * the bills without an account (the Unknown account), and no parameter every account. Any
 * other value is refused.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');
const { classifyService } = require('../data/classify');

// A bill line of a Public Cloud project, whose id is the service it bills: its quantity, its
// unit price and its amount. Classified as the import classifies it.
const line = (id, billId, projectId, description, [quantity, unitPrice, price]) => ({
  id, bill_id: billId, project_id: projectId, domain: projectId, description,
  quantity, unit_price: unitPrice, total_price: price,
  service_type: classifyService(description), resource_type: 'cloud_project',
});

// The French descriptions of the lines of a model's tokens, which end with the model
const INPUT_TOKENS = 'Nombre de tokens d\'entrée pour le modèle AI Endpoints';
const OUTPUT_TOKENS = 'Nombre de tokens de sortie pour le modèle AI Endpoints';
// And their English descriptions, as OVHcloud's public order catalog gives them
const inputTokensOf = (model) => `Amount of input tokens for AI Endpoints ${model} model`;
const outputTokensOf = (model) => `Amount of output tokens for AI Endpoints ${model} model`;

// Two accounts whose projects called AI Endpoints models in September, and a third, recorded
// without a bill:
// - the Lyon subsidiary, whose bills are in French: a language model and an embedding model,
//   besides a notebook of AI Notebooks and a service fee of AI Endpoints, which name no model,
//   and instances; and in August, the language model's input tokens alone;
// - Paris, whose bills are in English: the same language model, a speech-to-text model, billed
//   by the second of audio, and an image model, whose calls are free;
// - and the Unknown account, whose bills end each description with its period in brackets:
//   the same language model.
// Every NIC handle, name, identifier and amount is made up; the models and the descriptions
// of their lines are OVHcloud's.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so they are written as the database held them
  const sqlite = db.getDb();
  sqlite.prepare(
    "INSERT INTO projects (id, name, account) VALUES ('project-legacy', 'Legacy', NULL)",
  ).run();
  sqlite.prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();
  // What the bills of September charge for August
  const inAugust = (description) => `${description} (01/08/2026-31/08/2026)`;
  db.details.insertMany([
    line('FR1001-1', 'FR1001', 'project-production', `${INPUT_TOKENS} gpt-oss-20b`,
      [12500000, 0.00000008, 1]),
    line('FR1001-2', 'FR1001', 'project-production', `${OUTPUT_TOKENS} gpt-oss-20b`,
      [4000000, 0.0000003, 1.2]),
    line('FR1001-3', 'FR1001', 'project-production', `${INPUT_TOKENS} bge-m3`,
      [30000000, 0.00000001, 0.3]),
    line('FR1001-4', 'FR1001', 'project-production', 'AI Notebooks l4-1-gpu gra',
      [10, 1.93, 19.3]),
    line('FR1001-5', 'FR1001', 'project-production', 'Frais de service AI Endpoints',
      [1, 5, 5]),
    line('FR1001-6', 'FR1001', 'project-production',
      'Consommation à l\'heure pour les instances b3-8 gra11', [312, 0.0385, 12.01]),
    line('FR1002-1', 'FR1002', 'project-production', `${INPUT_TOKENS} gpt-oss-20b`,
      [8000000, 0.00000008, 0.64]),
    line('FR2001-1', 'FR2001', 'project-staging', inputTokensOf('gpt-oss-20b'),
      [2000000, 0.00000008, 0.16]),
    line('FR2001-2', 'FR2001', 'project-staging', outputTokensOf('gpt-oss-20b'),
      [500000, 0.0000003, 0.15]),
    line('FR2001-3', 'FR2001', 'project-staging',
      'Duration of data processed by AI Endpoints whisper-large-v3 model (in s)',
      [3600, 0.0001, 0.36]),
    line('FR2001-4', 'FR2001', 'project-staging',
      'Amount of calls for AI Endpoints stable-diffusion-xl-base-v10 model', [40, 0, 0]),
    line('FR0001-1', 'FR0001', 'project-legacy', inAugust(`${INPUT_TOKENS} gpt-oss-20b`),
      [1000000, 0.00000008, 0.08]),
    line('FR0001-2', 'FR0001', 'project-legacy', inAugust(`${OUTPUT_TOKENS} gpt-oss-20b`),
      [300000, 0.0000003, 0.09]),
  ]);
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

const ROUTE = '/api/analysis/ai-endpoints';
// September and August 2026, as the Public Cloud tab asks for a month
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';
// July to September 2026, as the Trends tab asks for its 3 months (#196)
const JULY_TO_SEPTEMBER = 'from=2026-07-01&to=2026-09-30';

// The route's answer for a period, for the account that the parameter names, or for every
// account without one
const aiEndpointsOf = (period, account) =>
  ocm.get(`${ROUTE}?${period}${account === undefined ? '' : `&account=${account}`}`);
// The row of a model in an answer, found by its name
const rowOf = ({ body }, model) => body.models.find((row) => row.model === model);
// A model's row, as the route gives it
const modelRow = (model, inputTokens, outputTokens, total) => ({
  model, inputTokens, outputTokens, total,
});

describe('GET /api/analysis/ai-endpoints', () => {
  test('reads a model\'s input tokens, output tokens and cost from French lines', async () => {
    expect(rowOf(await aiEndpointsOf(SEPTEMBER, LYON), 'gpt-oss-20b'))
      .toEqual(modelRow('gpt-oss-20b', 12500000, 4000000, 2.2));
  });

  test('reads them from English lines, as OVHcloud\'s catalog describes them', async () => {
    expect(rowOf(await aiEndpointsOf(SEPTEMBER, PARIS), 'gpt-oss-20b'))
      .toEqual(modelRow('gpt-oss-20b', 2000000, 500000, 0.31));
  });

  // Rather than 0, which would read as none generated
  test('gives an embedding model\'s input tokens alone, its output tokens null', async () => {
    expect(rowOf(await aiEndpointsOf(SEPTEMBER, LYON), 'bge-m3'))
      .toEqual(modelRow('bge-m3', 30000000, null, 0.3));
  });

  // Rather than read the seconds of audio or the calls as tokens
  test('counts any other line that names a model in its cost only, its tokens null',
    async () => {
      const paris = await aiEndpointsOf(SEPTEMBER, PARIS);

      expect(rowOf(paris, 'whisper-large-v3'))
        .toEqual(modelRow('whisper-large-v3', null, null, 0.36));
      // Free, and in use all the same
      expect(rowOf(paris, 'stable-diffusion-xl-base-v10'))
        .toEqual(modelRow('stable-diffusion-xl-base-v10', null, null, 0));
    });

  // So that a model is one row, whether its lines carry their period or not
  test('reads the same model from a description that ends with its period', async () => {
    expect(rowOf(await aiEndpointsOf(SEPTEMBER, UNKNOWN_ACCOUNT), 'gpt-oss-20b'))
      .toEqual(modelRow('gpt-oss-20b', 1000000, 300000, 0.17));
  });

  // AI Notebooks, AI Training and AI Deploy name no model: they stay in the AI product of the
  // Public Cloud tab's other services. Nor does a line that names AI Endpoints alone, such as
  // a service fee, which the query's prefilter keeps, as it names AI Endpoints: the reader
  // leaves it out.
  test('adds up the cost of the models, and of no line that names none', async () => {
    expect(await aiEndpointsOf(SEPTEMBER, LYON)).toEqual({
      status: 200,
      body: {
        total: 2.5,
        models: [
          modelRow('gpt-oss-20b', 12500000, 4000000, 2.2),
          modelRow('bge-m3', 30000000, null, 0.3),
        ],
        monthlyTrend: [{ month: '2026-09', models: { 'gpt-oss-20b': 2.2, 'bge-m3': 0.3 } }],
      },
    });
  });

  test('gives the models most expensive first', async () => {
    expect(await aiEndpointsOf(SEPTEMBER, PARIS)).toEqual({
      status: 200,
      body: {
        total: 0.67,
        models: [
          modelRow('whisper-large-v3', null, null, 0.36),
          modelRow('gpt-oss-20b', 2000000, 500000, 0.31),
          modelRow('stable-diffusion-xl-base-v10', null, null, 0),
        ],
        monthlyTrend: [{
          month: '2026-09',
          models: {
            'whisper-large-v3': 0.36, 'gpt-oss-20b': 0.31, 'stable-diffusion-xl-base-v10': 0,
          },
        }],
      },
    });
  });

  // Those of the month that the Public Cloud tab shows: the month of its bills
  test('counts the bills of the period alone', async () => {
    expect(await aiEndpointsOf(AUGUST, LYON)).toEqual({
      status: 200,
      body: {
        total: 0.64,
        models: [modelRow('gpt-oss-20b', 8000000, null, 0.64)],
        monthlyTrend: [{ month: '2026-08', models: { 'gpt-oss-20b': 0.64 } }],
      },
    });
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

// The cost of each model month by month, which the Trends tab charts (#196): over the months of
// the period whose bills name AI Endpoints models, each by the month of its bills, as the rest
// of the tab counts them
describe('the monthly trend of GET /api/analysis/ai-endpoints', () => {
  // The Unknown account's bill of September charges for August: its lines count in September
  test('gives the cost of each model in each month of its bills', async () => {
    expect((await aiEndpointsOf(JULY_TO_SEPTEMBER, UNKNOWN_ACCOUNT)).body.monthlyTrend)
      .toEqual([{ month: '2026-09', models: { 'gpt-oss-20b': 0.17 } }]);
  });

  // So that the bars of the months compare: Lyon's bill of August names the language model
  // alone, and none of its bills is of July
  test('gives every model of the period in each of its months, at 0 in one that billed none',
    async () => {
      expect((await aiEndpointsOf(JULY_TO_SEPTEMBER, LYON)).body.monthlyTrend).toEqual([
        { month: '2026-08', models: { 'gpt-oss-20b': 0.64, 'bge-m3': 0 } },
        { month: '2026-09', models: { 'gpt-oss-20b': 2.2, 'bge-m3': 0.3 } },
      ]);
    });
});

// The tests above give the models of an account whose NIC handle the parameter gives, and of
// the Unknown account, the bills without an account
describe('the account parameter of GET /api/analysis/ai-endpoints', () => {
  // As the Public Cloud cards do: each model once, with every account's lines
  test('adds up every account without it', async () => {
    expect(await aiEndpointsOf(SEPTEMBER)).toEqual({
      status: 200,
      body: {
        total: 3.34,
        models: [
          modelRow('gpt-oss-20b', 15500000, 4800000, 2.68),
          modelRow('whisper-large-v3', null, null, 0.36),
          modelRow('bge-m3', 30000000, null, 0.3),
          modelRow('stable-diffusion-xl-base-v10', null, null, 0),
        ],
        monthlyTrend: [{
          month: '2026-09',
          models: {
            'gpt-oss-20b': 2.68, 'whisper-large-v3': 0.36, 'bge-m3': 0.3,
            'stable-diffusion-xl-base-v10': 0,
          },
        }],
      },
    });
  });

  test('gives no model for an account without a bill', async () => {
    expect(await aiEndpointsOf(SEPTEMBER, NEW_ACCOUNT))
      .toEqual({ status: 200, body: { total: 0, models: [], monthlyTrend: [] } });
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
