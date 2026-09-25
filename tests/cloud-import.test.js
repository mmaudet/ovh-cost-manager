/**
 * Tests for the cloud inventory import (Phase 4), against a simulated OVH API:
 * a call that fails must never wipe the inventory already stored.
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

const PROJECT = 'proj-1';
const BASE = `/cloud/project/${PROJECT}`;

const ok = (value) => () => Promise.resolve(value);
const fail = (error, message) => () => Promise.reject({ error, message });

let db;
let importer;
let dataDir;
const previousDataDir = process.env.DATA_DIR;

// One S3 region (GRA), one legacy alias without detail route (GRA1, left to
// the 404 default) and one Public Cloud Archive Swift container.
function serveProject() {
  mockRoutes.clear();
  mockRoutes.set(`${BASE}/region`, ok(['GRA', 'GRA1']));
  mockRoutes.set(`${BASE}/region/GRA`, ok({ services: [{ name: 'storage-s3-standard', status: 'UP' }] }));
  mockRoutes.set(`${BASE}/region/GRA/storage`, ok([
    { name: 'photos', objectsCount: 2, objectsSize: 2048, createdAt: '2025-01-01T00:00:00Z' }
  ]));
  mockRoutes.set(`${BASE}/region/GRA/storage/photos/object`, ok([{ storageClass: 'STANDARD' }]));
  mockRoutes.set(`${BASE}/storage`, ok([
    { id: 'c-1', name: 'archives', region: 'GRA', storedObjects: 1, storedBytes: 4096 }
  ]));
  mockRoutes.set(`${BASE}/storage/c-1`, ok({ archive: true }));
  mockRoutes.set(`${BASE}/volume`, ok([
    { id: 'vol-1', name: 'data', region: 'GRA11', type: 'classic', size: 100, status: 'available', attachedTo: [] }
  ]));
  mockRoutes.set(`${BASE}/snapshot`, ok([
    { id: 'snap-1', name: 'before-upgrade', region: 'GRA11', size: 10, status: 'active', visibility: 'private', type: 'linux' }
  ]));
}

// Retry delays run on fake timers, so a rate-limited call costs no real time
async function importProject() {
  const done = importer.importCloudDetails([PROJECT]);
  await jest.runAllTimersAsync();
  await done;
}

const storedBuckets = () =>
  db.cloudDetails.getBucketsByProject(PROJECT, '2026-01-01', '2026-12-31')
    .map(b => `${b.name}:${b.storage_class}`)
    .sort();

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-import-'));
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
  db.projects.upsert({ id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null });
  serveProject();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('object storage inventory import', () => {
  test('stores the S3 buckets and Swift containers, skipping legacy region aliases', async () => {
    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('retries a region detail call that is rate limited', async () => {
    let calls = 0;
    mockRoutes.set(`${BASE}/region/GRA`, () => (++calls === 1
      ? Promise.reject({ error: 429, message: 'Too many requests' })
      : Promise.resolve({ services: [{ name: 'storage-s3-standard', status: 'UP' }] })));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  // The ovh client puts the HTTP status in `error`, not in `statusCode`
  test('retries a region detail call that answers a server error', async () => {
    let calls = 0;
    mockRoutes.set(`${BASE}/region/GRA`, () => (++calls === 1
      ? Promise.reject({ error: 503, message: 'Service unavailable' })
      : Promise.resolve({ services: [{ name: 'storage-s3-standard', status: 'UP' }] })));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('keeps the stored buckets when a region detail call keeps failing', async () => {
    await importProject();
    mockRoutes.set(`${BASE}/region/GRA`, fail(429, 'Too many requests'));
    // Replacing the inventory now would also drop the Swift container
    mockRoutes.set(`${BASE}/storage`, ok([]));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored buckets'));
  });

  test('keeps the stored buckets when a Swift container detail call fails', async () => {
    await importProject();
    // Without the detail, the archive container would be stored as plain Swift
    mockRoutes.set(`${BASE}/storage/c-1`, fail(500, 'Internal server error'));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });

  test('keeps the stored buckets when the Swift container list fails', async () => {
    await importProject();
    mockRoutes.set(`${BASE}/storage`, fail(503, 'Service unavailable'));

    await importProject();

    expect(storedBuckets()).toEqual(['archives:Public Cloud Archive', 'photos:Standard']);
  });
});

describe('volume and snapshot inventory import', () => {
  test('keeps the stored volumes and snapshots when their listing fails', async () => {
    await importProject();
    mockRoutes.set(`${BASE}/volume`, fail(429, 'Too many requests'));
    mockRoutes.set(`${BASE}/snapshot`, fail(503, 'Service unavailable'));

    await importProject();

    const volumes = db.cloudDetails.getVolumesByProject(PROJECT, '2026-01-01', '2026-12-31');
    const snapshots = db.cloudDetails.getSnapshotsByProject(PROJECT, '2026-01-01', '2026-12-31');
    expect(volumes.map(v => v.id)).toEqual(['vol-1']);
    expect(snapshots.map(s => s.id)).toEqual(['snap-1']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored volumes'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the stored snapshots'));
  });
});
