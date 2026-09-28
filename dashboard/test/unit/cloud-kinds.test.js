import { describe, it, expect } from 'vitest';
import { cloudKindLabel } from '../../src/utils/cloudKinds.js';
import { translations } from '../../src/i18n/translations.js';

// The page's translations in a language, as useLanguage() gives them
const tIn = (language) => (key) => translations[language][key] || key;

// The kinds of a project's current consumption, which its detail and the Compare tab split it
// by (#145)
describe('cloudKindLabel', () => {
  it('names each kind that the import reads in the language of the page', () => {
    expect(cloudKindLabel('registry', tIn('fr'))).toBe('Registre');
    expect(cloudKindLabel('registry', tIn('en'))).toBe('Container registry');
    expect(cloudKindLabel('storage', tIn('fr'))).toBe('Stockage objet');
    expect(cloudKindLabel('instance_monthly', tIn('en'))).toBe('Instances (monthly plan)');
    expect(cloudKindLabel('other', tIn('fr'))).toBe('Autres');
  });

  it('writes a kind that OVH added since as OVH names it', () => {
    expect(cloudKindLabel('databases', tIn('fr'))).toBe('databases');
  });
});
