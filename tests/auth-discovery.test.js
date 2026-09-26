/**
 * Tests for the OIDC discovery at startup: when the provider is not reachable,
 * the server keeps authentication on. It retries the discovery with backoff and,
 * meanwhile, answers 503 on the API and the sign-in routes, never falling back to
 * header mode.
 */

const express = require('express');
const { discoveryRetryDelay, createDiscoveryGate } = require('../server/auth/discovery');
const { serve } = require('./support/http');

describe('discoveryRetryDelay', () => {
  test.each([
    [0, 1000],
    [1, 2000],
    [2, 4000],
    [5, 32000],
  ])('waits twice as long after each failure: %i failure(s) before, %i ms', (failures, delay) => {
    expect(discoveryRetryDelay(failures)).toBe(delay);
  });

  test.each([6, 7, 30, 1000])('waits one minute at most, after %i failures', (failures) => {
    expect(discoveryRetryDelay(failures)).toBe(60000);
  });
});

describe('createDiscoveryGate, mounted as server/index.js mounts it', () => {
  let discovered;
  let server;

  beforeAll(async () => {
    const app = express();
    const isDiscovered = () => discovered;
    app.use('/api', createDiscoveryGate(isDiscovered));
    app.use('/auth', createDiscoveryGate(isDiscovered));
    // The routes come after the gates, as in server/index.js
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    app.get('/api/months', (req, res) => res.json({ route: 'months' }));
    app.get('/auth/login', (req, res) => res.redirect('https://sso.example.com/authorize'));
    app.get('*', (req, res) => res.send('page'));
    server = await serve(app);
  });

  afterAll(() => server.close());

  describe('until the provider is discovered', () => {
    beforeEach(() => {
      discovered = false;
    });

    test.each([
      '/api/months',
      '/API/months',
      '/api/months/',
      '/api/healthz',
      '/api/health/x',
      '/auth/login',
      '/AUTH/login',
      '/auth/callback?code=x&state=y',
    ])('answers 503 with a JSON error on %s', async (path) => {
      const res = await server.request('GET', path);
      expect(res.status).toBe(503);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(JSON.parse(res.body)).toEqual({ error: expect.any(String) });
    });

    test.each(['/api/health', '/API/HEALTH', '/api/health/'])(
      'keeps %s up, for the container\'s healthcheck',
      async (path) => {
        const res = await server.request('GET', path);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
      }
    );

    test('leaves the pages to the authentication middleware', async () => {
      const res = await server.request('GET', '/');
      expect(res.status).toBe(200);
      expect(res.body).toBe('page');
    });
  });

  describe('once the provider is discovered', () => {
    beforeAll(() => {
      discovered = true;
    });

    test('lets the API through', async () => {
      const res = await server.request('GET', '/api/months');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ route: 'months' });
    });

    test('lets the sign-in routes through', async () => {
      const res = await server.request('GET', '/auth/login');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://sso.example.com/authorize');
    });
  });
});
