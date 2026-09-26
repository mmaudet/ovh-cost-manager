/**
 * The checks of a back-channel logout token, as OpenID Connect Back-Channel
 * Logout 1.0 (section 2.6) lists them. openid-client v6 has none, so jose's
 * jwtVerify, with the options below, checks the signature against the
 * provider's JWKS and the registered claims; checkLogoutTokenClaims checks the
 * claims of a logout token, and a replay guard refuses a token seen before.
 */

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

// The provider sends the token as the user signs out: an older one is refused
const MAX_AGE_SECONDS = 5 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * The options of jose's jwtVerify for a logout token: issued by the provider,
 * for this client, less than 5 minutes ago, with the exp and the jti the
 * specification requires, and signed with an algorithm of the provider's ID
 * tokens (RS256 by default, as for ID tokens), never none.
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
    requiredClaims: ['iat', 'exp', 'jti'],
    maxTokenAge: MAX_AGE_SECONDS,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  };
}

/**
 * Checks the claims of a verified logout token that are its own: the
 * back-channel logout event, no nonce, which tells it from an ID token, a jti,
 * which tells a replay, and a sid or a sub, which says whose sessions end.
 *
 * @param {object} claims - the payload that jwtVerify returned
 * @returns {{ sid: (string|undefined), sub: (string|undefined), jti: string }}
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
  if (!jti) {
    throw new Error('no jti');
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
 * Remembers the jti of the logout tokens accepted, until the verification
 * refuses them anyway, so that a token replayed meanwhile is refused: without
 * a sid, a replay would end the sessions opened since the sign-out.
 *
 * @returns {{ firstUse: function(string, number, number=): boolean, size: function(): number }}
 */
function createReplayGuard() {
  const seen = new Map();
  return {
    // true for the first use of jti; until: see replayWindowEnd
    firstUse(jti, until, now = Date.now()) {
      for (const [id, end] of seen) {
        if (end <= now) {
          seen.delete(id);
        }
      }
      if (seen.has(jti)) {
        return false;
      }
      seen.set(jti, until);
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
  replayWindowEnd,
  createReplayGuard,
};
