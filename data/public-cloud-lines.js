/**
 * The instance, volume and AI Endpoints lines of a Public Cloud project's bills, as OVH words
 * them:
 *
 * - a monthly plan names its flavor, its instance and its region: "Forfait mensuel pour une
 *   instance b2-30 (id <uuid>, region gra7) - 01 mois";
 * - so does its prorata, for the month the plan starts, most often with its region:
 *   "Prorata de la facturation mensuelle d'une instance s1-8 (id <uuid>, region gra5)";
 * - the hourly instances of a flavor are billed on one line, most often per region:
 *   "Consommation à l'heure pour les instances r3-16 gra11".
 *
 * - the additional disks of a type are billed on one line per region: "Disques
 *   supplémentaires à gra9 de type high-speed".
 *
 * - an AI Endpoints model (see CONTEXT.md) is billed on a line per charge, most often its input
 *   tokens and its output tokens: "Nombre de tokens d'entrée pour le modèle AI Endpoints
 *   gpt-oss-20b", or "Amount of input tokens for AI Endpoints gpt-oss-20b model" on English
 *   bills.
 *
 * The per-instance costs pick the instance lines with instanceLineCondition() and read them
 * with readInstanceLine(), the per-volume costs read the volume lines with readVolumeLine(),
 * and so do the ties of the carbon footprint (#155). The AI Endpoints models pick their lines
 * with aiEndpointsLineCondition() and read them with readAiEndpointsLine() (#193). This module
 * has no side effect.
 */

// How the description of each kind of instance line starts, with `_` for the apostrophe,
// which OVH may write straight or curly: `_` is any one character in a LIKE pattern, and in
// the regular expressions below. A monthly plan's line and its prorata's, then an hourly
// line.
const MONTHLY_STARTS = [
  'Forfait mensuel pour une instance',
  'Prorata de la facturation mensuelle d_une instance',
];
const HOURLY_STARTS = ['Consommation à l_heure pour les instances'];

// The regular expression of the descriptions that start one of these ways
const startingWith = (starts) => new RegExp(`^(?:${starts
  .map(start => start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'))
  .join('|')})`, 'i');

const MONTHLY = startingWith(MONTHLY_STARTS);
const HOURLY = startingWith(HOURLY_STARTS);

// A region as OVH names it (gra11, rbx-a, eu-west-par): a prorata may carry the placeholder
// "#REGION#" instead, which names none
const REGION = /^[a-z0-9-]+$/i;

/**
 * Reads an instance bill line.
 * @param {?string} description - The bill line's description
 * @returns {?{flavor: ?string, region: ?string, monthly: boolean, instanceId: ?string}} The
 *   flavor that the line names and its region, as the line words them, or null when it names
 *   none; whether it is a monthly plan or its prorata; and the id of the instance it names, a
 *   monthly plan's or its prorata's. Null for any other line, a savings plan's included.
 */
function readInstanceLine(description) {
  const text = description || '';

  const monthly = text.match(MONTHLY);
  if (monthly) {
    const region = text.match(/,\s*region ([^)\s]+)\)/i)?.[1];
    return {
      flavor: text.slice(monthly[0].length).match(/^\s*([^\s(]+)/)?.[1] ?? null,
      region: region && REGION.test(region) ? region : null,
      monthly: true,
      instanceId: text.match(/\(id ([0-9a-f-]{36})/i)?.[1] ?? null,
    };
  }

  const hourly = text.match(HOURLY);
  if (hourly) {
    // "<flavor> <region>", or the flavor alone: a flavor's words, if it has several, are
    // those before the region
    const words = text.slice(hourly[0].length).trim().split(/\s+/).filter(Boolean);
    return {
      flavor: words.length > 1 ? words.slice(0, -1).join('-') : (words[0] ?? null),
      region: words.length > 1 ? words[words.length - 1] : null,
      monthly: false,
      instanceId: null,
    };
  }

  return null;
}

/**
 * The condition that keeps the instance lines of a query's bill lines, to join with AND to
 * its WHERE clause, with its parameters, as the conditions of data/sql-conditions.js.
 * @param {string} column - The column of the query that holds the lines' descriptions
 * @returns {{sql: string, params: string[]}}
 */
function instanceLineCondition(column) {
  const starts = [...MONTHLY_STARTS, ...HOURLY_STARTS];
  return {
    sql: `(${starts.map(() => `${column} LIKE ?`).join(' OR ')})`,
    params: starts.map(start => `${start}%`),
  };
}

// An additional disks' line: its region, and the type of its volumes
const VOLUME = /^Disques supplémentaires à\s+(\S+)\s+de type\s+(.+)$/i;

/**
 * Reads a volume bill line, of the additional disks of a type in a region.
 * @param {?string} description - The bill line's description
 * @returns {?{region: string, type: string}} As the line words them, null for any other line
 */
function readVolumeLine(description) {
  const volume = String(description ?? '').match(VOLUME);
  return volume ? { region: volume[1], type: volume[2].trim() } : null;
}

// The lines of an AI Endpoints model's tokens, by what their quantity counts, as OVHcloud words
// them in French, which end with the model, and in English, as its public order catalog does.
// A model's name is one word, as OVHcloud's catalog names it: gpt-oss-20b, bge-m3…
const AI_ENDPOINTS_TOKENS = [
  ['inputTokens', /^Nombre de tokens d['’]entrée pour le modèle AI Endpoints (\S+)$/i],
  ['inputTokens', /^Amount of input tokens for AI Endpoints (\S+) model$/i],
  ['outputTokens', /^Nombre de tokens de sortie pour le modèle AI Endpoints (\S+)$/i],
  ['outputTokens', /^Amount of output tokens for AI Endpoints (\S+) model$/i],
];

// How any line of an AI Endpoints model names it, such as the line of a speech-to-text model's
// seconds of audio, "Duration of data processed by AI Endpoints whisper-large-v3 model (in s)":
// « modèle AI Endpoints <model> » in French, "AI Endpoints <model> model" in English
const AI_ENDPOINTS_MODEL = [/\bmodèle AI Endpoints (\S+)/i, /\bAI Endpoints (\S+) model\b/i];

// The period in brackets that ends each description on some accounts' bills, such as
// « (01/08/2026-31/08/2026) »: no part of what the line names
const PERIOD = /\s*\([^()]*\d[^()]*\)$/;

/**
 * Reads a bill line of an AI Endpoints model (#193): a line that names no model, such as those
 * of AI Notebooks, AI Training or AI Deploy, is not AI Endpoints'.
 * @param {?string} description - The bill line's description
 * @returns {?{model: string, counts: ?string}} The model that the line names, as the line
 *   words it, and what the line's quantity counts: inputTokens or outputTokens, their number,
 *   or null for any other line of the model, such as its seconds of audio, which counts in its
 *   cost only. Null for a line that names no model.
 */
function readAiEndpointsLine(description) {
  const text = String(description ?? '').trim().replace(PERIOD, '');
  for (const [counts, wording] of AI_ENDPOINTS_TOKENS) {
    const model = text.match(wording)?.[1];
    if (model) return { model, counts };
  }
  for (const naming of AI_ENDPOINTS_MODEL) {
    const model = text.match(naming)?.[1];
    if (model) return { model, counts: null };
  }
  return null;
}

/**
 * The condition that keeps the lines that may name an AI Endpoints model, which
 * readAiEndpointsLine() reads, of a query's bill lines, to join with AND to its WHERE clause,
 * with its parameters, as instanceLineCondition(). LIKE ignores the case, as the reader does.
 * @param {string} column - The column of the query that holds the lines' descriptions
 * @returns {{sql: string, params: string[]}}
 */
function aiEndpointsLineCondition(column) {
  return { sql: `${column} LIKE ?`, params: ['%AI Endpoints%'] };
}

module.exports = {
  aiEndpointsLineCondition, instanceLineCondition, readAiEndpointsLine, readInstanceLine,
  readVolumeLine,
};
