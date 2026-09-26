/**
 * Tests for the checks of a back-channel logout token (OpenID Connect
 * Back-Channel Logout 1.0, section 2.6). jose's jwtVerify checks the signature
 * against the provider's JWKS, and the claims its options name; the other
 * checks are the logout token's own.
 */

const {
  BACKCHANNEL_LOGOUT_EVENT,
  logoutTokenVerifyOptions,
  checkLogoutTokenClaims,
  sessionsToEnd,
  replayWindowEnd,
  createReplayGuard,
} = require('../server/auth/logout-token');

describe('logoutTokenVerifyOptions', () => {
  const metadata = {
    issuer: 'https://sso.example.com',
    jwks_uri: 'https://sso.example.com/jwks',
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  };

  test('expects the provider as issuer and the client as audience', () => {
    const options = logoutTokenVerifyOptions(metadata, 'ocm-dashboard');
    expect(options.issuer).toBe('https://sso.example.com');
    expect(options.audience).toBe('ocm-dashboard');
  });

  test('accepts the algorithms of the provider\'s ID tokens', () => {
    expect(logoutTokenVerifyOptions(metadata, 'ocm').algorithms).toEqual(['RS256', 'ES256']);
  });

  test('accepts RS256 when the provider lists no algorithm', () => {
    const { id_token_signing_alg_values_supported: _, ...bare } = metadata;
    expect(logoutTokenVerifyOptions(bare, 'ocm').algorithms).toEqual(['RS256']);
  });

  test('never accepts an unsigned token, even when the provider lists none', () => {
    const withNone = { ...metadata, id_token_signing_alg_values_supported: ['none', 'RS256'] };
    expect(logoutTokenVerifyOptions(withNone, 'ocm').algorithms).toEqual(['RS256']);
  });

  // exp and jti are required by the specification: exp bounds the token's
  // life, jti lets a replay be told apart
  test('requires iat, exp and jti, iat no more than 5 minutes ago, 30 s of skew', () => {
    const options = logoutTokenVerifyOptions(metadata, 'ocm');
    expect(options.requiredClaims).toEqual(['iat', 'exp', 'jti']);
    expect(options.maxTokenAge).toBe(300);
    expect(options.clockTolerance).toBe(30);
  });
});

describe('checkLogoutTokenClaims', () => {
  const claims = {
    iss: 'https://sso.example.com',
    aud: 'ocm-dashboard',
    iat: 1790000000,
    exp: 1790000120,
    jti: 'bWJq',
    sid: '08a5019c-17e1-4977-8f42-65a12843ea02',
    sub: 'alice',
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };

  test('names the back-channel logout event of the specification', () => {
    expect(BACKCHANNEL_LOGOUT_EVENT).toBe('http://schemas.openid.net/event/backchannel-logout');
  });

  test('returns the sid, the sub and the jti', () => {
    expect(checkLogoutTokenClaims(claims)).toEqual({
      sid: '08a5019c-17e1-4977-8f42-65a12843ea02',
      sub: 'alice',
      jti: 'bWJq',
    });
  });

  test('accepts a token with a sid only', () => {
    const { sub: _, ...sidOnly } = claims;
    expect(checkLogoutTokenClaims(sidOnly)).toEqual({
      sid: '08a5019c-17e1-4977-8f42-65a12843ea02',
      sub: undefined,
      jti: 'bWJq',
    });
  });

  test('accepts a token with a sub only', () => {
    const { sid: _, ...subOnly } = claims;
    expect(checkLogoutTokenClaims(subOnly)).toEqual({ sid: undefined, sub: 'alice', jti: 'bWJq' });
  });

  test.each([
    ['no events claim', { events: undefined }],
    ['events that are not an object', { events: 'backchannel-logout' }],
    ['events without the back-channel logout event', { events: { 'https://example/x': {} } }],
    ['a back-channel logout event that is not an object', {
      events: { [BACKCHANNEL_LOGOUT_EVENT]: true },
    }],
    // An ID token has a nonce: one replayed as a logout token must fail
    ['a nonce', { nonce: 'n-0S6_WzA2Mj' }],
    ['a nonce, even empty', { nonce: '' }],
    ['neither sid nor sub', { sid: undefined, sub: undefined }],
    ['an empty sid and no sub', { sid: '', sub: undefined }],
    ['a sid that is not a string and no sub', { sid: 42, sub: undefined }],
    ['no jti', { jti: undefined }],
    ['an empty jti', { jti: '' }],
    ['a jti that is not a string', { jti: 7 }],
  ])('refuses a token with %s', (label, change) => {
    const token = { ...claims, ...change };
    for (const [name, value] of Object.entries(change)) {
      if (value === undefined) {
        delete token[name];
      }
    }
    expect(() => checkLogoutTokenClaims(token)).toThrow();
  });
});

// A sid names one session at the provider: only the dashboard's sessions of
// that one end, even when none matches. Without sid, every session of the sub
describe('sessionsToEnd', () => {
  test('ends the sessions of the sid only, when the token has one', () => {
    expect(sessionsToEnd({ sid: 'op-session-1', sub: 'alice' })).toEqual({ sid: 'op-session-1' });
  });

  test('ends every session of the sub, when the token has no sid', () => {
    expect(sessionsToEnd({ sid: undefined, sub: 'alice' })).toEqual({ sub: 'alice' });
  });
});

describe('replayWindowEnd', () => {
  // Refused anyway once iat is 5 minutes old, or at exp, with 30 s of skew
  test('ends 5 minutes after iat, with the skew, when exp is later', () => {
    expect(replayWindowEnd({ iat: 1790000000, exp: 1790003600 })).toBe((1790000300 + 30) * 1000);
  });

  test('ends at exp, with the skew, when exp comes first', () => {
    expect(replayWindowEnd({ iat: 1790000000, exp: 1790000120 })).toBe((1790000120 + 30) * 1000);
  });
});

describe('createReplayGuard', () => {
  const NOW = 1790000000 * 1000;
  const UNTIL = NOW + 60 * 1000;

  test('accepts the first use of a jti', () => {
    expect(createReplayGuard().firstUse('jti-1', UNTIL, NOW)).toBe(true);
  });

  test('refuses the same jti again while the token is valid', () => {
    const guard = createReplayGuard();
    guard.firstUse('jti-1', UNTIL, NOW);
    expect(guard.firstUse('jti-1', UNTIL, NOW + 59 * 1000)).toBe(false);
  });

  test('accepts another jti', () => {
    const guard = createReplayGuard();
    guard.firstUse('jti-1', UNTIL, NOW);
    expect(guard.firstUse('jti-2', UNTIL, NOW)).toBe(true);
  });

  // The verification refuses the token by then: its jti need not be kept
  test('forgets a jti once its token is no longer valid', () => {
    const guard = createReplayGuard();
    guard.firstUse('jti-1', UNTIL, NOW);
    guard.firstUse('jti-2', UNTIL + 60 * 1000, NOW);
    expect(guard.size()).toBe(2);
    guard.firstUse('jti-3', UNTIL + 60 * 1000, UNTIL);
    expect(guard.size()).toBe(2);
  });
});
