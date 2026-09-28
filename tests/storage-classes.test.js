/**
 * The names of the storage classes of the object storage buckets (#145).
 */

const { storageClassLabel } = require('../data/storage-classes');

describe('storageClassLabel', () => {
  test('names the classes that OVH gives the objects as OVHcloud\'s guides do', () => {
    expect(storageClassLabel('STANDARD')).toBe('Standard');
    expect(storageClassLabel('STANDARD_IA')).toBe('Standard IA');
    expect(storageClassLabel('HIGH_PERF')).toBe('High Performance');
    expect(storageClassLabel('GLACIER_IR')).toBe('Active Archive');
    expect(storageClassLabel('DEEP_ARCHIVE')).toBe('Cold Archive');
  });

  test('keeps a class already named, or unknown, and none', () => {
    expect(storageClassLabel('Public Cloud Archive')).toBe('Public Cloud Archive');
    expect(storageClassLabel('ONEZONE_IA')).toBe('ONEZONE_IA');
    expect(storageClassLabel(null)).toBeNull();
  });
});
