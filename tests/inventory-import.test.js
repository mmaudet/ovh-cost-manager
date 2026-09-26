/**
 * Tests for the service inventory import (Phase 3), against a simulated OVH
 * API: what it stores of each VPS, and the services it removes once OVH no
 * longer lists them.
 */

const { routes, ok, fail, useThrowawayImport } = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const VPS = 'vps-0a1b2c3d.vps.ovh.net';

const throwaway = useThrowawayImport('ocm-inventory-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

// One VPS, whose model has a 40 GB disk
function serveVps() {
  routes.set('/vps', ok([VPS]));
  routes.set(`/vps/${VPS}`, ok({
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

beforeEach(serveVps);

describe('VPS inventory import', () => {
  // The image installed on the VPS, as images/current describes it
  const currentImage = (imageName) => ok({ id: 'image-debian-12', name: imageName });
  // The distribution route, which OVH removes on 15 October 2026
  const distribution = (fields) => ok({ id: 1, bitFormat: 64, locale: 'en', ...fields });
  const removed = fail(404, 'The requested object (serviceName) does not exist');

  test('stores the operating system of a VPS, and its disk size apart', async () => {
    routes.set(`/vps/${VPS}/images/current`, currentImage('Debian 12'));
    routes.set(`/vps/${VPS}/distribution`, removed);

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  // The two answer different names here, to tell which one is read
  test('reads the operating system from the current image first', async () => {
    routes.set(`/vps/${VPS}/images/current`, currentImage('Debian 12'));
    routes.set(`/vps/${VPS}/distribution`, distribution({ name: 'Debian 11' }));

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  test.each([
    ['cannot be read', fail(403, 'This call has not been granted')],
    ['names none', ok({ id: 'image-debian-12' })],
  ])('falls back on the distribution when the current image %s', async (_, image) => {
    routes.set(`/vps/${VPS}/images/current`, image);
    routes.set(`/vps/${VPS}/distribution`, distribution({ name: 'Debian 12' }));

    await importInventory();

    expect(storedVps()).toEqual([['Debian 12', 40]]);
  });

  test('falls back on the distribution field when the distribution has no name', async () => {
    routes.set(`/vps/${VPS}/images/current`, removed);
    routes.set(`/vps/${VPS}/distribution`, distribution({ distribution: 'debian12' }));

    await importInventory();

    expect(storedVps()).toEqual([['debian12', 40]]);
  });

  test('leaves the operating system empty when both calls fail', async () => {
    routes.set(`/vps/${VPS}/images/current`, fail(403, 'This call has not been granted'));
    routes.set(`/vps/${VPS}/distribution`, removed);

    await importInventory();

    expect(storedVps()).toEqual([['', 40]]);
  });

  // The ovh client answers null for an empty body
  test.each([
    ['name none', { id: 1, bitFormat: 64 }],
    ['are empty', null],
  ])('leaves the operating system empty when both answers %s', async (_, answer) => {
    routes.set(`/vps/${VPS}/images/current`, ok(answer));
    routes.set(`/vps/${VPS}/distribution`, ok(answer));

    await importInventory();

    expect(storedVps()).toEqual([['', 40]]);
  });
});

// #74: a service cancelled at OVH stayed in the inventory until a full import, and the
// Overview listed it first among the services about to expire, expired for months
describe('services that OVH no longer lists', () => {
  const SERVER = 'ns3000001.ip-203-0-113.eu';
  const STORAGE = 'netapp-8c9d0e1f';
  const CANCELLED = {
    server: 'ns3000009.ip-203-0-113.eu',
    vps: 'vps-9f8e7d6c.vps.ovh.net',
    storage: 'netapp-9a8b7c6d',
  };
  const LISTS = ['/dedicated/server', '/vps', '/storage/netapp'];

  // A service that an earlier import stored, expired in March
  const storeServer = (id) => db.inventory.upsertServer({
    id, display_name: id, reverse: '', datacenter: 'rbx8', os: '', state: 'ok', cpu: '',
    ram_size: 0, disk_info: '[]', bandwidth: 0, expiration_date: '2026-03-01', renewal_type: '',
  });
  const storeVps = (id) => db.inventory.upsertVps({
    id, display_name: id, model: '', zone: '', state: 'running', os: '', vcpus: 2,
    ram_mb: 2048, disk_gb: 40, expiration_date: '2026-03-01', renewal_type: '',
    ip_addresses: '[]',
  });
  const storeStorage = (id, serviceType = 'netapp') => db.inventory.upsertStorage({
    id, service_type: serviceType, display_name: id, region: 'eu-west-gra',
    total_size_gb: 1024, used_size_gb: 0, share_count: 0, expiration_date: '2026-03-01',
  });

  // What an earlier import stored: a service of each kind that OVH still lists, and one that
  // was cancelled since
  function storeServices() {
    for (const id of [SERVER, CANCELLED.server]) storeServer(id);
    for (const id of [VPS, CANCELLED.vps]) storeVps(id);
    for (const id of [STORAGE, CANCELLED.storage]) storeStorage(id);
  }

  // OVH lists the services it still has: the VPS (see serveVps()), a server and a storage
  // service
  function serveLists() {
    routes.set('/dedicated/server', ok([SERVER]));
    routes.set(`/dedicated/server/${SERVER}`, ok({ datacenter: 'rbx8', state: 'ok' }));
    routes.set('/storage/netapp', ok([STORAGE]));
    routes.set(`/storage/netapp/${STORAGE}`, ok({ name: STORAGE, region: 'eu-west-gra' }));
  }

  // The ids of the services stored of each kind
  const storedIds = () => ({
    servers: db.inventory.getAllServers().map(s => s.id),
    vps: db.inventory.getAllVps().map(v => v.id),
    storage: db.inventory.getAllStorage().map(s => s.id),
  });

  test('removes the services cancelled since an earlier import', async () => {
    storeServices();
    serveLists();

    await importInventory();

    expect(storedIds()).toEqual({ servers: [SERVER], vps: [VPS], storage: [STORAGE] });
  });

  // What OVH lists decides, not what the import could read of each service
  test('keeps a service that OVH lists but whose details it could not read', async () => {
    storeServices();
    serveLists();
    routes.set(`/dedicated/server/${SERVER}`, fail(500, 'Internal server error'));

    await importInventory();

    expect(storedIds().servers).toEqual([SERVER]);
  });

  // The ids compare as text, as the table stores them: the list [123] used to delete the
  // row '123'. The simulated API does not serve its details, so the row is the one stored.
  test('keeps a service whose id its list gives as a number', async () => {
    storeServer('123');
    routes.set('/dedicated/server', ok([123]));

    await importInventory();

    expect(storedIds().servers).toEqual(['123']);
  });

  test.each([
    // As for the maintainer's own key, which is not granted these routes
    ['is not granted', fail(403, 'This call has not been granted')],
    ['fails', fail(500, 'Internal server error')],
    // The ovh client answers null for an empty body
    ['answers nothing', ok(null)],
    ['answers anything but a list', ok({})],
  ])('keeps every service when the list call %s', async (_, answer) => {
    storeServices();
    for (const list of LISTS) routes.set(list, answer);

    await importInventory();

    expect(storedIds()).toEqual({
      servers: [SERVER, CANCELLED.server],
      vps: [VPS, CANCELLED.vps],
      storage: [STORAGE, CANCELLED.storage],
    });
  });
});
