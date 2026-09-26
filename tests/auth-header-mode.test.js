/**
 * Tests for header mode, the authentication without OIDC: the SSO reverse proxy
 * passes the user in the Auth-User, Auth-Mail and Auth-CN headers, and
 * AUTH_REQUIRED=true makes Auth-User required on the API.
 *
 * Express routes paths without case and with or without a trailing slash, so
 * the check must cover every variant of a path that reaches an API route.
 */

const express = require('express');
const { mountHeaderMode } = require('../server/auth/header-mode');
const { serve } = require('./support/http');

// Wired as server/index.js wires it: header mode, then the API routes, then the
// dashboard's page for any other GET
function createApp(options) {
  const app = express();
  mountHeaderMode(app, options);
  app.get('/api/months', (req, res) => res.json({ route: 'months', user: req.user }));
  app.get('/api/projects/:id/costs', (req, res) => res.json({ route: 'costs' }));
  app.post('/api/import/run', (req, res) => res.status(202).json({ route: 'import' }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('*', (req, res) => res.send('page'));
  return app;
}

const ALICE = { 'Auth-User': 'alice', 'Auth-Mail': 'alice@example.com', 'Auth-CN': 'Alice' };

describe('header mode with AUTH_REQUIRED=true', () => {
  let server;

  beforeAll(async () => {
    server = await serve(createApp({ required: true }));
  });

  afterAll(() => server.close());

  test.each([
    '/api/months',
    '/API/months',
    '/Api/Months',
    '/api/MONTHS',
    '/api/months/',
    '/API/MONTHS/',
    '/api/months?x=1',
    '/API/months?x=1',
    '/API/PROJECTS/1/COSTS',
    // Under /api, whatever follows: Express does not route these to the API
    '/api//months',
    '/api/%6Donths',
    '/api/months%2F',
  ])('answers 401 on GET %s without Auth-User', async (path) => {
    const res = await server.request('GET', path);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Authentication required' });
  });

  test.each(['/api/import/run', '/API/import/run', '/api/IMPORT/run/'])(
    'answers 401 on POST %s without Auth-User',
    async (path) => {
      const res = await server.request('POST', path);
      expect(res.status).toBe(401);
    }
  );

  // Not under /api, nor routed to it: the page, which needs no Auth-User
  test.each(['//api/months', '/%61pi/months', '/%41PI/months'])(
    'serves the page, not the API, on %s',
    async (path) => {
      const res = await server.request('GET', path);
      expect(res.status).toBe(200);
      expect(res.body).toBe('page');
    }
  );

  test('serves the page without Auth-User', async () => {
    const res = await server.request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('page');
  });

  test.each(['/api/health', '/API/health'])('serves %s without Auth-User', async (path) => {
    const res = await server.request('GET', path);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  test.each(['/api/months', '/API/months'])('serves %s with Auth-User', async (path) => {
    const res = await server.request('GET', path, ALICE);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      route: 'months',
      user: { id: 'alice', email: 'alice@example.com', name: 'Alice' },
    });
  });
});

describe('header mode without AUTH_REQUIRED', () => {
  let server;

  beforeAll(async () => {
    server = await serve(createApp({ required: false }));
  });

  afterAll(() => server.close());

  test('serves the API without Auth-User, to an anonymous user', async () => {
    const res = await server.request('GET', '/api/months');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ route: 'months', user: null });
  });

  test('reads the user from the headers, the name defaulting to Auth-User', async () => {
    const res = await server.request('GET', '/api/months', { 'Auth-User': 'bob' });
    expect(JSON.parse(res.body).user).toEqual({ id: 'bob', email: null, name: 'bob' });
  });
});
