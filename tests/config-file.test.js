/**
 * Tests for the reading of config.json by the server: a file that exists but
 * cannot be read stops the server, rather than let it run without its
 * settings, authentication included.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readConfigFile } = require('../server/config-file');

describe('readConfigFile', () => {
  let dir;
  let first;
  let second;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-config-'));
    first = path.join(dir, 'first', 'config.json');
    second = path.join(dir, 'second', 'config.json');
    fs.mkdirSync(path.dirname(first));
    fs.mkdirSync(path.dirname(second));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads the first file that exists', () => {
    fs.writeFileSync(second, '{ "auth": { "enabled": true } }');
    expect(readConfigFile([first, second])).toEqual({
      path: second,
      config: { auth: { enabled: true } },
    });
  });

  test('gives an empty configuration when no file exists', () => {
    expect(readConfigFile([first, second])).toEqual({ path: null, config: {} });
  });

  test.each([
    ['text that is no JSON', '{ "auth": { "enabled": true, } }'],
    ['nothing', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"config"'],
  ])('refuses a file holding %s, naming it', (label, content) => {
    fs.writeFileSync(first, content);
    expect(() => readConfigFile([first, second])).toThrow(first);
  });

  test('refuses a broken file rather than read the next one', () => {
    fs.writeFileSync(first, '{ broken');
    fs.writeFileSync(second, '{}');
    expect(() => readConfigFile([first, second])).toThrow(first);
  });

  test('refuses a file it cannot read', () => {
    fs.mkdirSync(first);
    expect(() => readConfigFile([first, second])).toThrow(first);
  });
});
