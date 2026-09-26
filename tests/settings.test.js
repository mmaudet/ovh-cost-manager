/**
 * Tests for the one way the server reads its settings: a value other than the
 * setting takes stops the server, naming the setting, rather than turn a
 * protection off. The true/false settings are tested with the auth and rate
 * limiting settings; here, the numbers and the sections of config.json.
 */

const { parsePositiveInteger, parseList, readSection } = require('../server/settings');

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

// A list, such as the allowed origins: a string of config.json, compared as it
// was, let through any origin it contains
describe('parseList, from the environment', () => {
  const read = (value) => parseList(value, { name: 'ALLOWED_ORIGINS' });

  test('splits the text on commas, and trims each entry', () => {
    expect(read(' https://a.example , https://b.example:8443 '))
      .toEqual(['https://a.example', 'https://b.example:8443']);
  });

  test('leaves out blank entries', () => {
    expect(read('https://a.example,, ,')).toEqual(['https://a.example']);
    expect(read(' , ')).toEqual([]);
  });

  test.each([undefined, ''])('gives undefined for %p, as unset', (value) => {
    expect(read(value)).toBeUndefined();
  });
});

describe('parseList, from config.json', () => {
  const name = `allowedOrigins in ${SOURCE}`;
  const read = (value) => parseList(value, { name, fromFile: true });

  test('reads an array of strings, trimmed, without blank entries', () => {
    expect(read([' https://a.example', 'https://b.example', ''])).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  test('reads a comma-separated string, as the environment gives it', () => {
    expect(read('https://a.example, https://b.example'))
      .toEqual(['https://a.example', 'https://b.example']);
  });

  test('reads an empty string or array as an empty list', () => {
    expect(read('')).toEqual([]);
    expect(read([])).toEqual([]);
  });

  test('gives undefined when the key is absent', () => {
    expect(read(undefined)).toBeUndefined();
  });

  test.each([
    ['true', true],
    ['42', 42],
    ['null', null],
    ['{"origin":"https://a.example"}', { origin: 'https://a.example' }],
    ['["https://a.example",42]', ['https://a.example', 42]],
  ])('refuses %s', (shown, value) => {
    expect(() => read(value))
      .toThrow(`${name} must be an array of strings or a comma-separated string, not ${shown}`);
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
