import { describe, it, expect } from 'vitest';
import { sortBucketsByName } from '../../src/components/BucketsTable.jsx';
import { instanceCsvRows } from '../../src/components/InstancesTable.jsx';
import { volumeCsvRows } from '../../src/components/VolumesTable.jsx';

// What the resource tables do to their rows, besides showing them

describe('sortBucketsByName', () => {
  it('sorts buckets by name, whatever the case and the accents', () => {
    const buckets = ['logs', 'Backups', 'éditions', 'assets'].map((name) => ({ name }));

    expect(sortBucketsByName(buckets).map((bucket) => bucket.name))
      .toEqual(['assets', 'Backups', 'éditions', 'logs']);
  });

  it('leaves the list it sorts as it is', () => {
    const buckets = [{ name: 'logs' }, { name: 'assets' }];

    sortBucketsByName(buckets);

    expect(buckets).toEqual([{ name: 'logs' }, { name: 'assets' }]);
  });
});

describe('volumeCsvRows', () => {
  it('lists the instances a volume is attached to, separated by spaces', () => {
    const volume = { id: 'vol-1', name: 'data', attachedTo: ['inst-1', 'inst-2'] };

    expect(volumeCsvRows([volume])).toEqual([{ ...volume, attached: 'inst-1 inst-2' }]);
  });

  it('lists none for a detached volume', () => {
    const rows = volumeCsvRows([{ id: 'vol-2', attachedTo: [] }, { id: 'vol-3' }]);

    expect(rows.map((row) => row.attached)).toEqual(['', '']);
  });
});

describe('instanceCsvRows', () => {
  it('gives the plan code as the flavor, or else the flavor id', () => {
    const rows = instanceCsvRows([
      { id: 'inst-1', name: 'web-1', plan_code: 'b3-8.consumption', flavor: 'b3-8' },
      { id: 'inst-2', name: 'web-2', flavor: 'b3-8' },
      { id: 'inst-3', name: 'web-3' },
    ], 'fr');

    expect(rows.map((row) => [row.name, row.flavor_display])).toEqual([
      ['web-1', 'b3-8.consumption'],
      ['web-2', 'b3-8'],
      ['web-3', ''],
    ]);
  });

  it('names the row of the unallocated cost, in the language of the page', () => {
    const unallocated = { unallocated: true, total: 42.5 };

    expect(instanceCsvRows([unallocated], 'fr')[0].name)
      .toBe('Non attribué (instances supprimées)');
    expect(instanceCsvRows([unallocated], 'en')[0].name)
      .toBe('Unallocated (deleted instances)');
  });
});
