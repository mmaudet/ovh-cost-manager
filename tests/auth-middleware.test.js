/**
 * Tests for the OIDC authentication middleware: without a session, the API
 * answers 401 JSON, which the dashboard turns into a sign-in, on every path
 * Express routes to it, whatever its case; the pages redirect to the sign-in.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const sessionStore = require('../server/auth/session-store');
const { createAuthMiddleware } = require('../server/auth/middleware');
const { signValue } = require('../server/auth/session-cookie');
const { serve } = require('./support/http');

const SECRET = '0123456789abcdef0123456789abcdef';
const AUTH = { auth: { enabled: true, session: { name: 'ocm.sid', secret: SECRET } } };

// Wired as server/index.js wires it: the middleware, then the API routes, then
// the dashboard's page for any other GET
function createApp() {
  const app = express();
  app.use(cookieParser());
  app.use(createAuthMiddleware(AUTH));
  app.get('/auth/login', (req, res) => res.send('sign-in'));
  app.get('/api/months', (req, res) => res.json({ route: 'months', user: req.user.id }));
  app.post('/api/import/run', (req, res) => res.status(202).json({ route: 'import' }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('*', (req, res) => res.send('page'));
  return app;
}

describe('the OIDC authentication middleware', () => {
  let db;
  let server;

  beforeAll(async () => {
    db = new Database(':memory:');
    sessionStore.init(db);
    server = await serve(createApp());
  });

  afterAll(async () => {
    await server.close();
    db.close();
  });

  describe('without a session', () => {
    test.each([
      '/api/months',
      '/API/months',
      '/Api/Months/',
      '/api/MONTHS',
      '/API/months?x=1',
      '/api',
      '/API',
      '/api//months',
      '/api/%6Donths',
    ])('answers 401 JSON on GET %s', async (path) => {
      const res = await server.request('GET', path);
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({
        error: 'Authentication required',
        loginUrl: '/auth/login',
      });
    });

    test.each(['/api/import/run', '/API/import/run'])('answers 401 on POST %s', async (path) => {
      const res = await server.request('POST', path);
      expect(res.status).toBe(401);
    });

    // As Express routes them to the health check: without case, with or
    // without a trailing slash
    test.each(['/api/health', '/API/HEALTH', '/api/health/'])('serves %s', async (path) => {
      const res = await server.request('GET', path);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });

    test('lets the sign-in through', async () => {
      const res = await server.request('GET', '/auth/login');
      expect(res.body).toBe('sign-in');
    });

    // Not under /api, nor routed to it: pages
    test.each([
      ['/', '%2F'],
      ['/projects', '%2Fprojects'],
      ['//api/months', '%2F%2Fapi%2Fmonths'],
      ['/%61pi/months', '%2F%2561pi%2Fmonths'],
      ['/apimonths', '%2Fapimonths'],
    ])('redirects the page %s to the sign-in', async (path, returnTo) => {
      const res = await server.request('GET', path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/auth/login?returnTo=${returnTo}`);
    });
  });

  describe('with a session', () => {
    test.each(['/api/months', '/API/months'])('serves %s', async (path) => {
      const sid = sessionStore.create('alice', { name: 'Alice' }, {}, null, 60 * 1000);
      const cookie = `ocm.sid=${signValue(sid, SECRET, 'session')}`;
      const res = await server.request('GET', path, { Cookie: cookie });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ route: 'months', user: 'alice' });
    });
  });
});
