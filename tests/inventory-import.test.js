/**
 * Tests for the service inventory import (Phase 3), against a simulated OVH
 * API: what it stores of each VPS.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Simulated OVH API: route -> handler returning a promise. Unknown routes
// answer 404, like the real API does.
const mockRoutes = new Map();
jest.mock('ovh', () => () => ({
  requestPromised: (method, route) => {
    const handler = mockRoutes.get(route);
    return handler ? handler() : Promise.reject({ error: 404, message: `Not found: ${route}` });
  }
}));

// Never read the real credentials of the machine running the tests
jest.mock('jsonfile', () => ({
  readFileSync: () => ({ appKey: 'test', appSecret: 'test', consumerKey: 'test' })
}));

const VPS = 'vps-0a1b2c3d.vps.ovh.net';

const ok = (value) => () => Promise.resolve(value);
const fail = (error, message) => () => Promise.reject({ error, message });

let db;
let importer;
let dataDir;
const previousDataDir = process.env.DATA_DIR;

// One VPS, whose model has a 40 GB disk
function serveVps() {
  mockRoutes.clear();
  mockRoutes.set('/vps', ok([VPS]));
  mockRoutes.set(`/vps/${VPS}`, ok({
    name: VPS,
    displayName: VPS,
    state: 'running',
    zone: 'Region OpenStack: os-gra7',
    model: { name: 'vps-le-2-2-40', vcore: 2, memory: 2048, disk: 40 },
  }));
}

// Retry delays run on fake timers, so a rate-limited call costs no real time
async function importInventory() {
  const done = importer.importInventory({});
  await jest.runAllTimersAsync();
  await done;
}

// The stored VPS as [operating system, disk size in GB]
const storedVps = () => db.inventory.getAllVps().map(v => [v.os, v.disk_gb]);

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-inventory-import-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');
  importer = require('../data/import');
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db.clearAll();
  serveVps();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('VPS inventory import', () => {
  // The image installed on the VPS, as images/current describes it
  const currentImage = (imageName) => ok({ id: 'image-debian-12', name: imageName });
  // The distribution route, which OVH removes on 15 October 2026
  const distribution = (fields) => ok({ id: 1, bitFormat: 64, locale: 'en', ...fields });
  const removed = fail(404, 'The requested object (serviceName) does not exist');

  test('stores the operating system of a VPS, and its disk size apart', async () => {
    mockRoutes.set(`/vps/${VPS}/images/current`, currentImage('Debian 12'));
    mockRoutes.set(`/vps/${VPS}/distribution`, removed);

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  // The two answer different names here, to tell which one is read
  test('reads the operating system from the current image first', async () => {
    mockRoutes.set(`/vps/${VPS}/images/current`, currentImage('Debian 12'));
    mockRoutes.set(`/vps/${VPS}/distribution`, distribution({ name: 'Debian 11' }));

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  test.each([
    ['cannot be read', fail(403, 'This call has not been granted')],
    ['names none', ok({ id: 'image-debian-12' })],
  ])('falls back on the distribution when the current image %s', async (_, image) => {
    mockRoutes.set(`/vps/${VPS}/images/current`, image);
    mockRoutes.set(`/vps/${VPS}/distribution`, distribution({ name: 'Debian 12' }));

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  test('falls back on the distribution field when the distribution has no name', async () => {
    mockRoutes.set(`/vps/${VPS}/images/current`, removed);
    mockRoutes.set(`/vps/${VPS}/distribution`, distribution({ distribution: 'debian12' }));

    await importInventory();

    expect(storedVps()).toEqual([['debian12', 40]]);
  });

  test('leaves the operating system empty when both calls fail', async () => {
    mockRoutes.set(`/vps/${VPS}/images/current`, fail(403, 'This call has not been granted'));
    mockRoutes.set(`/vps/${VPS}/distribution`, removed);

    await importInventory();

    expect(storedVps()).toEqual([['', 40]]);
  });

  // The ovh client answers null for an empty body
  test.each([
    ['name none', { id: 1, bitFormat: 64 }],
    ['are empty', null],
  ])('leaves the operating system empty when the current image and the distribution %s',
    async (_, answer) => {
    mockRoutes.set(`/vps/${VPS}/images/current`, ok(answer));
    mockRoutes.set(`/vps/${VPS}/distribution`, ok(answer));

    await importInventory();

    expect(storedVps()).toEqual([['', 40]]);
  });
});
