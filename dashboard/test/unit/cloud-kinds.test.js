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

  // As OVH's answer named them for a project of the maintainer's, on 29 September 2026
  it('names the types of the typed resources that OVH gives', () => {
    expect(cloudKindLabel('gateway', tIn('fr'))).toBe('Gateways');
    expect(cloudKindLabel('publicip', tIn('fr'))).toBe('IP publiques');
    expect(cloudKindLabel('floatingip', tIn('en'))).toBe('Floating IPs');
    expect(cloudKindLabel('octavia-loadbalancer', tIn('fr'))).toBe('Load balancers');
    expect(cloudKindLabel('databases', tIn('fr'))).toBe('Bases de données');
    expect(cloudKindLabel('s3.deeparchive.3az.size', tIn('en'))).toBe('Cold Archive storage');
  });

  it('writes a kind that OVH added since as OVH names it', () => {
    expect(cloudKindLabel('ai-notebook', tIn('fr'))).toBe('ai-notebook');
  });
});
