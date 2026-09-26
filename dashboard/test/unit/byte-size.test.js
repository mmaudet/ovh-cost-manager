import { describe, it, expect } from 'vitest';
import { fmtBytes } from '../../src/utils/format.js';

// The size of a bucket, as the Public Cloud tab shows it. The same in every language: it
// takes none, and writes a decimal point in French too.
describe('fmtBytes', () => {
  it('writes a dash for a size the API does not know', () => {
    // A bucket billed but gone from the inventory
    expect(fmtBytes(null)).toBe('-');
    expect(fmtBytes(undefined)).toBe('-');
  });

  it('writes an empty bucket in bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
  });

  it('writes a size below a kilobyte in bytes', () => {
    expect(fmtBytes(1)).toBe('1 B');
    expect(fmtBytes(999)).toBe('999 B');
  });

  it('counts in powers of 1000, as the OVH manager does', () => {
    expect(fmtBytes(1000)).toBe('1.0 KB');
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1000000)).toBe('1.0 MB');
    expect(fmtBytes(4200000000)).toBe('4.2 GB');
    expect(fmtBytes(1500000000000)).toBe('1.5 TB');
    expect(fmtBytes(2500000000000000)).toBe('2.5 PB');
  });

  it('keeps one decimal below 10 of a unit, and none from 10', () => {
    expect(fmtBytes(1500)).toBe('1.5 KB');
    expect(fmtBytes(10000)).toBe('10 KB');
    expect(fmtBytes(12345)).toBe('12 KB');
  });

  it('rounds in the unit it picks, up to 1000 of it', () => {
    expect(fmtBytes(9999)).toBe('10.0 KB');
    expect(fmtBytes(999999)).toBe('1000 KB');
  });

  it('counts in petabytes beyond', () => {
    expect(fmtBytes(5000000000000000000)).toBe('5000 PB');
  });
});
