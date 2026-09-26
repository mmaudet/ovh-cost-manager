/**
 * The checks of a back-channel logout token, as OpenID Connect Back-Channel
 * Logout 1.0 (section 2.6) lists them. openid-client v6 has none, so jose's
 * jwtVerify, with the options below, checks the signature against the
 * provider's JWKS and the registered claims; checkLogoutTokenClaims checks the
 * claims of a logout token, and a replay guard refuses a token seen before.
 */

const crypto = require('crypto');

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

// The provider sends the token as the user signs out: an older one is refused
const MAX_AGE_SECONDS = 5 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * The options of jose's jwtVerify for a logout token: issued by the provider,
 * for this client, less than 5 minutes ago, with the exp the specification
 * requires, and signed with an algorithm of the provider's ID tokens (RS256 by
 * default, as for ID tokens), never none. The jti, which the specification
 * requires too, is not: LemonLDAP-NG, the provider of the demo stack, may
 * leave it out, and replayKey then tells a replay by the token itself.
 *
 * @param {object} metadata - the provider's discovered metadata
 * @param {string} clientId - the client id of the dashboard
 * @returns {object}
 */
function logoutTokenVerifyOptions(metadata, clientId) {
  const algorithms = metadata.id_token_signing_alg_values_supported || ['RS256'];
  return {
    issuer: metadata.issuer,
    audience: clientId,
    algorithms: algorithms.filter((alg) => alg !== 'none'),
    requiredClaims: ['iat', 'exp'],
    maxTokenAge: MAX_AGE_SECONDS,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  };
}

/**
 * Checks the claims of a verified logout token that are its own: the
 * back-channel logout event, no nonce, which tells it from an ID token, a jti
 * that is text when there is one, and a sid or a sub, which says whose
 * sessions end.
 *
 * @param {object} claims - the payload that jwtVerify returned
 * @returns {{ sid: (string|undefined), sub: (string|undefined), jti: (string|undefined) }}
 * @throws {Error} when a check fails
 */
function checkLogoutTokenClaims(claims) {
  if (!isObject(claims.events) || !isObject(claims.events[BACKCHANNEL_LOGOUT_EVENT])) {
    throw new Error('no back-channel logout event');
  }
  if ('nonce' in claims) {
    throw new Error('a logout token has no nonce');
  }
  const jti = nonEmptyString(claims.jti);
  if ('jti' in claims && !jti) {
    throw new Error('a jti that is not text');
  }
  const sid = nonEmptyString(claims.sid);
  const sub = nonEmptyString(claims.sub);
  if (!sid && !sub) {
    throw new Error('neither sid nor sub');
  }
  return { sid, sub, jti };
}

/**
 * The sessions a logout token ends. A sid names one session at the provider:
 * only the dashboard's sessions of that one end, none when none matches, even
 * with a sub, so that signing out on one device ends no other. Without sid,
 * every session of the sub ends, as the specification allows.
 *
 * @param {{ sid: (string|undefined), sub: (string|undefined) }} claims
 * @returns {{ sid: string }|{ sub: string }}
 */
function sessionsToEnd({ sid, sub }) {
  return sid ? { sid } : { sub };
}

/**
 * What tells a replay of a logout token: its jti, or without one, the SHA-256
 * of the compact token, which a replay repeats byte for byte.
 *
 * @param {{ jti: (string|undefined) }} claims - checked claims
 * @param {string} logoutToken - the compact token, as posted
 * @returns {string}
 */
function replayKey({ jti }, logoutToken) {
  if (jti) {
    return `jti:${jti}`;
  }
  return `sha256:${crypto.createHash('sha256').update(logoutToken).digest('hex')}`;
}

/**
 * When the verification refuses a logout token anyway, in milliseconds: 5
 * minutes after its iat, or at its exp, with the clock tolerance. Until then,
 * its jti is remembered.
 *
 * @param {{ iat: number, exp: number }} claims - verified claims
 * @returns {number}
 */
function replayWindowEnd({ iat, exp }) {
  return (Math.min(iat + MAX_AGE_SECONDS, exp) + CLOCK_TOLERANCE_SECONDS) * 1000;
}

/**
 * Remembers the logout tokens accepted, by their replayKey, until the
 * verification refuses them anyway, so that a token replayed meanwhile is
 * refused: without a sid, a replay would end the sessions opened since the
 * sign-out.
 *
 * @returns {{ firstUse: function(string, number, number=): boolean, size: function(): number }}
 */
function createReplayGuard() {
  const seen = new Map();
  return {
    // true for the first use of key; until: see replayWindowEnd
    firstUse(key, until, now = Date.now()) {
      for (const [seenKey, end] of seen) {
        if (end <= now) {
          seen.delete(seenKey);
        }
      }
      if (seen.has(key)) {
        return false;
      }
      seen.set(key, until);
      return true;
    },
    size: () => seen.size,
  };
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

module.exports = {
  BACKCHANNEL_LOGOUT_EVENT,
  logoutTokenVerifyOptions,
  checkLogoutTokenClaims,
  sessionsToEnd,
  replayKey,
  replayWindowEnd,
  createReplayGuard,
};
