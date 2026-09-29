/**
 * The AI Endpoints models (see CONTEXT.md) that the bill lines of a Public Cloud project name,
 * and what the lines add up to by model (#193), in all and month by month (#196). OVHcloud
 * bills a model's use on a line per charge, most often its input tokens and its output tokens,
 * whose quantity is the number of tokens: « Nombre de tokens d'entrée pour le modèle AI
 * Endpoints gpt-oss-20b », or "Amount of input tokens for AI Endpoints gpt-oss-20b model" on
 * English bills. The model's other lines, such as a speech-to-text model's seconds of audio,
 * count in its cost only.
 *
 * data/db.js selects the lines of a period, which aiEndpointsLineCondition() narrows down, and
 * modelFigures() adds them up, when the server reads the bills: no re-import. This module has
 * no side effect.
 */

const { chargeOf } = require('./public-cloud-products');

// The charges of a model's tokens, by what their lines' quantity counts, its input or its output
// tokens: in French, which end with the model, and in English, as OVHcloud's public order catalog
// gives them, as chargeOf() writes them, without their period and with a straight apostrophe. A
// model's name is one word, as the catalog names it: gpt-oss-20b, bge-m3…
const TOKEN_PATTERNS = [
  ['input', /^Nombre de tokens d'entrée pour le modèle AI Endpoints (\S+)$/i],
  ['input', /^Amount of input tokens for AI Endpoints (\S+) model$/i],
  ['output', /^Nombre de tokens de sortie pour le modèle AI Endpoints (\S+)$/i],
  ['output', /^Amount of output tokens for AI Endpoints (\S+) model$/i],
];

// How any line of a model names it, such as that of a speech-to-text model's seconds of audio,
// "Duration of data processed by AI Endpoints whisper-large-v3 model (in s)": « modèle AI
// Endpoints <model> » in French, "AI Endpoints <model> model" in English
const MODEL_PATTERNS = [/\bmodèle AI Endpoints (\S+)/i, /\bAI Endpoints (\S+) model\b/i];

/**
 * Reads a bill line of an AI Endpoints model, from its charge (chargeOf()), which names the model
 * alike whatever the period of the line: a line that names no model, such as those of AI
 * Notebooks, AI Training or AI Deploy, or a line that names AI Endpoints alone, is not a
 * model's.
 * @param {?string} description - The bill line's description
 * @returns {?{model: string, counts: ?string}} The model that the line names, as its
 *   description gives it, and what the line's quantity counts: 'input' or 'output', the number
 *   of the model's input or output tokens, or null for any other line of the model, such as its
 *   seconds of audio, which counts in its cost only. Null for a line that names no model.
 */
function readAiEndpointsLine(description) {
  const text = chargeOf(description);
  for (const [counts, pattern] of TOKEN_PATTERNS) {
    const model = text.match(pattern)?.[1];
    if (model) return { model, counts };
  }
  for (const pattern of MODEL_PATTERNS) {
    const model = text.match(pattern)?.[1];
    if (model) return { model, counts: null };
  }
  return null;
}

/**
 * The condition that narrows a query's bill lines down to those that may name an AI Endpoints
 * model, to join with AND to its WHERE clause, with its parameters, as the conditions of
 * data/sql-conditions.js: those whose description names AI Endpoints, LIKE ignoring the case as
 * the reader does. A prefilter only: a line may name AI Endpoints and no model, and the reader
 * decides.
 * @param {string} column - The column of the query that holds the lines' descriptions
 * @returns {{sql: string, params: string[]}}
 */
function aiEndpointsLineCondition(column) {
  return { sql: `${column} LIKE ?`, params: ['%AI Endpoints%'] };
}

const toCents = (amount) => Math.round(amount * 100) / 100;

// The entry of a key in a map, which `create` makes the first time
const entryOf = (map, key, create) => {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
};

/**
 * What bill lines add up to, by the AI Endpoints model that each names: those that name none
 * are left out.
 * @param {{description: ?string, month: string, quantity: ?number, total_price: ?number}[]}
 *   lines - Each with the month of its bill, YYYY-MM
 * @returns {{total: number, models: {model: string, tokens: {input: ?number, output: ?number},
 *   cost: number}[], monthlyTrend: {month: string, costs: Object<string, number>}[]}} Each
 *   model, the most expensive first, then by name, with its input and output tokens, what the
 *   quantities of its lines that count them add up to, null when none does, such as an
 *   embedding model's output tokens, and its cost, all its lines together, to the cent. What
 *   the models cost in all: the sum of their costs to the cent, rather than of their lines, so
 *   that the models' costs add up to it, as the other services' do to theirs in
 *   productFigures(). And each month of the bills that name a model, the earliest first, with
 *   the cost of each model in it, to the cent.
 */
function modelFigures(lines) {
  const byModel = new Map();
  // What each model cost in each month of the bills, by month, then by model
  const byMonth = new Map();
  for (const line of lines) {
    const aiLine = readAiEndpointsLine(line.description);
    if (aiLine === null) continue;
    const cost = line.total_price || 0;
    const figures = entryOf(byModel, aiLine.model,
      () => ({ model: aiLine.model, tokens: { input: null, output: null }, cost: 0 }));
    if (aiLine.counts !== null) {
      figures.tokens[aiLine.counts] = (figures.tokens[aiLine.counts] ?? 0) + (line.quantity || 0);
    }
    figures.cost += cost;
    const costsOfMonth = entryOf(byMonth, line.month, () => new Map());
    costsOfMonth.set(aiLine.model, (costsOfMonth.get(aiLine.model) ?? 0) + cost);
  }
  const models = [...byModel.values()]
    .map((figures) => ({ ...figures, cost: toCents(figures.cost) }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));
  // Every model of the lines in each month, at 0 in a month that billed it nothing, so that the
  // months compare, in the order of the models; the months in theirs, YYYY-MM
  const monthlyTrend = [...byMonth.keys()].sort().map((month) => ({
    month,
    costs: Object.fromEntries(models.map(({ model }) => [
      model, toCents(byMonth.get(month).get(model) ?? 0),
    ])),
  }));
  return {
    total: toCents(models.reduce((sum, { cost }) => sum + cost, 0)), models, monthlyTrend,
  };
}

module.exports = { aiEndpointsLineCondition, modelFigures };
