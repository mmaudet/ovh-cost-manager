/**
 * A fake OpenID provider, served in the test's own process, for the tests that
 * sign in through the server: it signs in its current user without asking,
 * checks PKCE, and signs ID tokens and logout tokens with a key pair of its
 * own. A test can make its next answer fail through `next`.
 */

const crypto = require('crypto');
const http = require('http');

const KEY_ID = 'test-key';

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Signs claims as a JWT with RS256, or leaves it unsigned with alg none.
 *
 * @param {object} claims
 * @param {crypto.KeyObject} privateKey
 * @param {object} [header] - more header parameters, such as { alg: 'none' }
 * @returns {string}
 */
function signJwt(claims, privateKey, header = {}) {
  const fullHeader = { alg: 'RS256', typ: 'JWT', kid: KEY_ID, ...header };
  const input = `${base64url(fullHeader)}.${base64url(claims)}`;
  if (fullHeader.alg === 'none') {
    return `${input}.`;
  }
  return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Starts the provider on a free local port.
 *
 * @returns {Promise<object>} the provider: issuer, clientId, clientSecret,
 *   user (the sub it signs in), next (what its next answers do), lastPkce,
 *   logoutToken(claims, options) and close()
 */
async function startFakeProvider() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const codes = new Map();
  const provider = {
    clientId: 'ocm-test',
    clientSecret: 'test-secret',
    user: 'alice',
    // deny: the next authorization is refused; wrongIss: it names another
    // issuer; wrongNonce: the next ID token holds another nonce
    next: {},
    lastPkce: null,
    // The provider's session of the last authorization, as its tokens' sid
    lastSid: null,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, provider.issuer);
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        return sendJson(res, 200, {
          issuer: provider.issuer,
          authorization_endpoint: `${provider.issuer}/authorize`,
          token_endpoint: `${provider.issuer}/token`,
          userinfo_endpoint: `${provider.issuer}/userinfo`,
          jwks_uri: `${provider.issuer}/jwks`,
          end_session_endpoint: `${provider.issuer}/end_session`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          // Its authorization responses name it (RFC 9207)
          authorization_response_iss_parameter_supported: true,
          backchannel_logout_supported: true,
          backchannel_logout_session_supported: true,
        });
      case '/jwks': {
        const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KEY_ID, alg: 'RS256' };
        return sendJson(res, 200, { keys: [{ ...jwk, use: 'sig' }] });
      }
      case '/authorize': {
        const target = new URL(url.searchParams.get('redirect_uri'));
        target.searchParams.set('state', url.searchParams.get('state'));
        const iss = provider.next.wrongIss ? 'http://evil.example' : provider.issuer;
        target.searchParams.set('iss', iss);
        provider.next.wrongIss = false;
        if (provider.next.deny) {
          provider.next.deny = false;
          target.searchParams.set('error', 'access_denied');
        } else {
          const code = crypto.randomUUID();
          provider.lastSid = `op-session-${crypto.randomUUID()}`;
          codes.set(code, {
            sub: provider.user,
            sid: provider.lastSid,
            nonce: url.searchParams.get('nonce'),
            challenge: url.searchParams.get('code_challenge'),
            method: url.searchParams.get('code_challenge_method'),
          });
          target.searchParams.set('code', code);
        }
        res.writeHead(302, { Location: target.href });
        return res.end();
      }
      case '/token': {
        const form = new URLSearchParams(await readBody(req));
        const grant = codes.get(form.get('code'));
        // A code serves once
        codes.delete(form.get('code'));
        if (!grant) {
          return sendJson(res, 400, { error: 'invalid_grant' });
        }
        const verifier = form.get('code_verifier') || '';
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        provider.lastPkce = {
          method: grant.method,
          verified: grant.method === 'S256' && challenge === grant.challenge,
        };
        if (!provider.lastPkce.verified) {
          return sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
        }
        const now = Math.floor(Date.now() / 1000);
        const nonce = provider.next.wrongNonce ? 'another-nonce' : grant.nonce;
        provider.next.wrongNonce = false;
        return sendJson(res, 200, {
          access_token: `${grant.sub}.${crypto.randomUUID()}`,
          token_type: 'Bearer',
          expires_in: 300,
          id_token: signJwt({
            iss: provider.issuer,
            aud: provider.clientId,
            sub: grant.sub,
            sid: grant.sid,
            nonce,
            iat: now,
            exp: now + 300,
          }, privateKey),
        });
      }
      case '/userinfo': {
        const sub = (req.headers.authorization || '').replace(/^Bearer /, '').split('.')[0];
        return sendJson(res, 200, { sub, name: sub, email: `${sub}@example.test` });
      }
      default:
        return sendJson(res, 404, { error: 'not_found' });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  provider.issuer = `http://127.0.0.1:${server.address().port}`;

  /**
   * A logout token of this provider, for its client, which the claims
   * complete or change: a claim set to undefined is left out.
   *
   * @param {object} claims - such as { sid } or { sub }
   * @param {object} [options]
   * @param {boolean} [options.otherKey] - signed with a key the provider does not publish
   * @param {object} [options.header] - more header parameters, such as { alg: 'none' }
   * @returns {string}
   */
  provider.logoutToken = (claims, { otherKey: useOtherKey = false, header } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const full = {
      iss: provider.issuer,
      aud: provider.clientId,
      iat: now,
      exp: now + 120,
      jti: crypto.randomUUID(),
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      ...claims,
    };
    for (const [name, value] of Object.entries(full)) {
      if (value === undefined) {
        delete full[name];
      }
    }
    return signJwt(full, useOtherKey ? otherKey : privateKey, header);
  };

  provider.close = () => new Promise((resolve) => server.close(resolve));
  return provider;
}

module.exports = { startFakeProvider };
