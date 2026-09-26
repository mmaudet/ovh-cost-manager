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

  // As the cron reads it: only "false" turns the imports off, and an empty value is unset
  it('is true with any other value', () => {
    expect(importsEnabled({ IMPORT_ENABLED: 'true' })).toBe(true);
    expect(importsEnabled({ IMPORT_ENABLED: '' })).toBe(true);
    expect(importsEnabled({ IMPORT_ENABLED: 'FALSE' })).toBe(true);
    expect(importsEnabled({ IMPORT_ENABLED: '0' })).toBe(true);
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
