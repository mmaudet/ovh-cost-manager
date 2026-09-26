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
  replayKey,
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

  // exp bounds the token's life, as the specification requires. jti, which
  // it requires too, is not: LemonLDAP-NG, the provider of the demo stack,
  // may leave it out, and a replay is then told by the token itself
  test('requires iat and exp, iat no more than 5 minutes ago, 30 s of skew', () => {
    const options = logoutTokenVerifyOptions(metadata, 'ocm');
    expect(options.requiredClaims).toEqual(['iat', 'exp']);
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

  test('accepts a token without jti', () => {
    const { jti: _, ...withoutJti } = claims;
    expect(checkLogoutTokenClaims(withoutJti)).toEqual({
      sid: '08a5019c-17e1-4977-8f42-65a12843ea02',
      sub: 'alice',
      jti: undefined,
    });
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

// What tells a replay: the token's jti, or without one, the token itself
describe('replayKey', () => {
  // A compact token, and the SHA-256 of its signed part, header and payload,
  // computed apart:
  // printf %s "${TOKEN%.*}" | openssl dgst -sha256
  const HEADER = 'eyJhbGciOiJSUzI1NiJ9';
  const PAYLOAD = 'eyJzaWQiOiJvcC1zZXNzaW9uLTEifQ';
  // An RSA-2048 signature is 342 characters: its last one holds 4 unused bits
  const SIGNATURE = `${'a'.repeat(341)}Q`;
  const TOKEN = `${HEADER}.${PAYLOAD}.${SIGNATURE}`;
  const DIGEST = '8ed382af453f504bef1523fee3d4c754390b259d426fe5cfa7476f20651e2e27';

  test('is the issuer and the jti, when the token has one', () => {
    expect(replayKey({ iss: 'https://sso.example.com', jti: 'bWJq' }, TOKEN))
      .toBe('jti:["https://sso.example.com","bWJq"]');
  });

  test('is the SHA-256 of the signed part, when the token has no jti', () => {
    expect(replayKey({ iss: 'https://sso.example.com' }, TOKEN)).toBe(`sha256:${DIGEST}`);
  });

  // jose decodes base64url leniently: these signatures verify as the original
  const signed = `${HEADER}.${PAYLOAD}`;
  test.each([
    ['a space in the signature', `${signed}.${SIGNATURE.slice(0, 10)} ${SIGNATURE.slice(10)}`],
    ['a newline in the signature', `${signed}.${SIGNATURE.slice(0, 20)}\n${SIGNATURE.slice(20)}`],
    ['other unused bits in its last character', `${signed}.${SIGNATURE.slice(0, -1)}R`],
    ['== padding', `${TOKEN}==`],
  ])('is the same with %s', (label, variant) => {
    expect(replayKey({}, variant)).toBe(`sha256:${DIGEST}`);
  });

  test('tells apart two tokens without jti', () => {
    expect(replayKey({}, TOKEN)).not.toBe(replayKey({}, `${HEADER}.${PAYLOAD}x.${SIGNATURE}`));
  });
});

// jose, with maxTokenAge 300 and clockTolerance 30, compares whole seconds,
// rounded down: it accepts a token until iat + 331 s and exp + 30 s, both
// excluded, as a scratch run of jwtVerify at those instants showed. The key
// must outlive that: it is kept one second more
describe('replayWindowEnd', () => {
  const IAT = 1790000000;

  test('ends a second after jose\'s last acceptance by iat, when exp is later', () => {
    expect(replayWindowEnd({ iat: IAT, exp: IAT + 3600 })).toBe((IAT + 332) * 1000);
  });

  test('ends a second after jose\'s last acceptance by exp, when exp comes first', () => {
    expect(replayWindowEnd({ iat: IAT, exp: IAT + 120 })).toBe((IAT + 151) * 1000);
  });

  test.each([
    ['iat + 330.999 s, the last instant by iat', IAT + 3600, (IAT + 330) * 1000 + 999],
    ['exp + 29.999 s, the last instant by exp', IAT + 120, (IAT + 149) * 1000 + 999],
  ])('keeps the key at %s that jose accepts the token', (label, exp, lastAccepted) => {
    const guard = createReplayGuard();
    const end = replayWindowEnd({ iat: IAT, exp });
    guard.firstUse('key', end, IAT * 1000);
    expect(guard.firstUse('key', end, lastAccepted)).toBe(false);
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

  test('accepts again a key whose token is no longer valid', () => {
    const guard = createReplayGuard();
    guard.firstUse('jti-1', UNTIL, NOW);
    expect(guard.firstUse('jti-1', UNTIL + 60 * 1000, UNTIL)).toBe(true);
  });

  test('keeps no more keys than its bound, evicting the oldest', () => {
    const guard = createReplayGuard({ maxSize: 3 });
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) {
      guard.firstUse(key, UNTIL, NOW);
    }
    expect(guard.size()).toBe(3);
    expect(guard.firstUse('k5', UNTIL, NOW)).toBe(false);
    expect(guard.firstUse('k1', UNTIL, NOW)).toBe(true);
  });

  // No scan of the whole cache: eviction stops at the oldest key still valid,
  // so that each key is evicted once, in constant time on average
  test('evicts expired keys from the oldest on, and stops at a valid one', () => {
    const guard = createReplayGuard();
    guard.firstUse('valid-longer', UNTIL + 60 * 1000, NOW);
    guard.firstUse('expired-behind', NOW + 1000, NOW);
    guard.firstUse('new', UNTIL, NOW + 2000);
    expect(guard.size()).toBe(3);
  });
});
