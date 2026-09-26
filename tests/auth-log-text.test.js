/**
 * Tests for what the auth module logs of text it did not write, from the
 * provider or from a request: quoted as JSON, on one line, so that a newline
 * in it cannot forge a line of the log.
 */

const {
  quote,
  describeRefusal,
  describeDiscoveryFailure,
} = require('../server/auth/log-text');

// Every character that ends a line or drives a terminal, as JSON.stringify
// leaves some of them
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

describe('quote', () => {
  test('writes text as a JSON string', () => {
    expect(quote('alice')).toBe('"alice"');
    expect(quote('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
  });

  test.each([
    ['a newline', 'alice\nOIDC sign-in: session opened for admin', '\\n'],
    ['a carriage return', 'alice\rforged', '\\r'],
    ['an escape, which starts terminal sequences', 'alice\u001b[2Jforged', '\\u001b'],
    ['a delete', 'alice\u007fforged', '\\u007f'],
    ['a next line, NEL', 'alice\u0085forged', '\\u0085'],
    ['a control sequence introducer, CSI', 'alice\u009b2Jforged', '\\u009b'],
    ['a line separator', 'alice\u2028forged', '\\u2028'],
    ['a paragraph separator', 'alice\u2029forged', '\\u2029'],
  ])('escapes %s, and reads back as the text', (label, text, escaped) => {
    const quoted = quote(text);
    expect(quoted).toContain(escaped);
    expect(quoted).not.toMatch(CONTROLS);
    expect(JSON.parse(quoted)).toBe(text);
  });

  test('writes what is not text as its text', () => {
    expect(quote(42)).toBe('"42"');
    expect(quote(undefined)).toBe('"undefined"');
  });
});

// The error of a refused sign-in carries the provider's error, which the
// callback's URL brings, and anyone can write
describe('describeRefusal', () => {
  const refusal = (fields) => Object.assign(new Error(fields.message), fields);

  test('quotes the messages and the provider\'s error', () => {
    const err = refusal({
      name: 'AuthorizationResponseError',
      message: 'authorization response from the server is an error',
      error: 'access_denied',
      error_description: 'denied\nOIDC sign-in: session opened for admin',
      cause: new Error('first\nsecond'),
    });
    expect(describeRefusal(err)).toBe('AuthorizationResponseError: '
      + '"authorization response from the server is an error", error "access_denied", '
      + 'description "denied\\nOIDC sign-in: session opened for admin", '
      + 'because "first\\nsecond"');
  });

  test('leaves out what the error does not hold', () => {
    const err = refusal({ name: 'ClientError', message: 'unexpected JWT claim value' });
    expect(describeRefusal(err)).toBe('ClientError: "unexpected JWT claim value"');
  });

  // Its cause's data can hold the callback's parameters, the code among them
  test('tells of the cause its message only', () => {
    const cause = Object.assign(new Error('mismatch'), { parameters: 'code=the-code' });
    const err = refusal({ name: 'ClientError', message: 'unexpected', cause });
    expect(describeRefusal(err)).not.toContain('the-code');
  });
});

// A provider's answer makes the error of a failed discovery: a JSON parser's
// message holds the start of the text it failed on
describe('describeDiscoveryFailure', () => {
  test('quotes the message, and the code of the cause', () => {
    const cause = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(describeDiscoveryFailure(new Error('fetch failed', { cause })))
      .toBe('"fetch failed" ("ECONNREFUSED")');
  });

  test('quotes the message of a cause without code', () => {
    const cause = new Error('Unexpected token \'x\', "x\nOIDC: pr"');
    expect(describeDiscoveryFailure(new Error('parsing error', { cause })))
      .toBe('"parsing error" ("Unexpected token \'x\', \\"x\\nOIDC: pr\\"")');
  });

  test('quotes the message alone, without cause', () => {
    expect(describeDiscoveryFailure(new Error('a\nb'))).toBe('"a\\nb"');
  });
});
