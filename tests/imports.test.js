/**
 * Tests for the one rule that says whether the server runs imports: the resync route
 * refuses to start one when it says no, and /api/config tells the dashboard, which then
 * offers no resync button (#51). scripts/cron-import.sh reads IMPORT_ENABLED the same way.
 */

const { importsEnabled } = require('../server/imports');

describe('importsEnabled', () => {
  it('is true when IMPORT_ENABLED is not set', () => {
    expect(importsEnabled({})).toBe(true);
  });

  it('is false with IMPORT_ENABLED=false', () => {
    expect(importsEnabled({ IMPORT_ENABLED: 'false' })).toBe(false);
  });

  // As the other true/false settings, and the cron, read it: FALSE left the imports on
  it.each([
    ['true', true],
    ['TRUE', true],
    ['FALSE', false],
    ['False', false],
  ])('reads IMPORT_ENABLED=%s in any case', (value, expected) => {
    expect(importsEnabled({ IMPORT_ENABLED: value })).toBe(expected);
  });

  it('is true with an empty IMPORT_ENABLED, as an unset one', () => {
    expect(importsEnabled({ IMPORT_ENABLED: '' })).toBe(true);
  });

  // The server checks it at startup, and stops on such a value
  it.each(['0', 'no', 'off', 'disabled'])('refuses IMPORT_ENABLED=%s', (value) => {
    expect(() => importsEnabled({ IMPORT_ENABLED: value }))
      .toThrow(`IMPORT_ENABLED must be true or false, not "${value}"`);
  });

  it("reads the server's environment by default", () => {
    const saved = process.env.IMPORT_ENABLED;
    try {
      process.env.IMPORT_ENABLED = 'false';
      expect(importsEnabled()).toBe(false);
      delete process.env.IMPORT_ENABLED;
      expect(importsEnabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.IMPORT_ENABLED;
      else process.env.IMPORT_ENABLED = saved;
    }
  });
});
