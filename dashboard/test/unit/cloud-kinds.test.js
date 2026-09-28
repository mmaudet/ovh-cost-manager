import { describe, it, expect } from 'vitest';
import { cloudKindLabel } from '../../src/utils/cloudKinds.js';

// The kinds of a project's current consumption, which its detail splits it by (#145)
describe('cloudKindLabel', () => {
  it('names each kind that the import reads in the language of the page', () => {
    expect(cloudKindLabel('registry', 'fr')).toBe('Registre');
    expect(cloudKindLabel('registry', 'en')).toBe('Container registry');
    expect(cloudKindLabel('storage', 'fr')).toBe('Stockage objet');
    expect(cloudKindLabel('instance_monthly', 'en')).toBe('Instances (monthly plan)');
    expect(cloudKindLabel('other', 'fr')).toBe('Autres');
  });

  it('writes a kind that OVH added since as OVH names it', () => {
    expect(cloudKindLabel('databases', 'fr')).toBe('databases');
  });
});
