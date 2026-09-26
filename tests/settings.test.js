/**
 * Tests for the one way the server reads its settings: a value other than the
 * setting takes stops the server, naming the setting, rather than turn a
 * protection off. The true/false settings are tested with the auth and rate
 * limiting settings; here, the numbers and the sections of config.json.
 */

const { parsePositiveInteger, readSection } = require('../server/settings');

const SOURCE = '/etc/ocm/config.json';

describe('parsePositiveInteger, from the environment', () => {
  const read = (value) => parsePositiveInteger(value, { name: 'RATE_LIMIT_API_MAX' });

  test.each([
    ['1', 1],
    ['100', 100],
    ['900000', 900000],
  ])('reads %s', (value, expected) => {
    expect(read(value)).toBe(expected);
  });

  test.each([undefined, ''])('gives undefined for %p, as unset', (value) => {
    expect(read(value)).toBeUndefined();
  });

  // parseInt read 100abc as 100 and 1e3 as 1, abc, 0 or -5 as the default
  test.each(['abc', '0', '-5', '1.5', '100abc', '1e3', ' 100', '0x10', '99999999999999999999'])(
    'refuses %s',
    (value) => {
      expect(() => read(value))
        .toThrow(`RATE_LIMIT_API_MAX must be a positive integer, not "${value}"`);
    }
  );
});

describe('parsePositiveInteger, from config.json', () => {
  const name = `rateLimit.api.max in ${SOURCE}`;
  const read = (value) => parsePositiveInteger(value, { name, fromFile: true });

  test('reads a JSON number', () => {
    expect(read(300)).toBe(300);
  });

  test('gives undefined when the key is absent', () => {
    expect(read(undefined)).toBeUndefined();
  });

  test.each([
    ['"abc"', 'abc'],
    ['"100"', '100'],
    ['""', ''],
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['null', null],
    ['true', true],
  ])('refuses %s', (shown, value) => {
    expect(() => read(value))
      .toThrow(`${name} must be a positive integer (a JSON number), not ${shown}`);
  });
});

// "auth": true turned authentication off: its settings were read from true
describe('readSection', () => {
  const read = (file) => readSection(file, 'auth', { name: `auth in ${SOURCE}` });

  test('gives the section', () => {
    expect(read({ auth: { enabled: true } })).toEqual({ enabled: true });
  });

  test('gives an empty section when the key is absent', () => {
    expect(read({})).toEqual({});
  });

  test.each([
    ['true', true],
    ['false', false],
    ['1', 1],
    ['null', null],
    ['a string', 'oidc'],
    ['an array', [{ enabled: true }]],
  ])('refuses %s', (shown, value) => {
    expect(() => read({ auth: value }))
      .toThrow(`auth in ${SOURCE} must be an object, not ${shown}`);
  });
});
