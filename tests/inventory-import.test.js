/**
 * Tests for the service inventory import (Phase 3), against a simulated OVH
 * API: what it stores of each VPS.
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
