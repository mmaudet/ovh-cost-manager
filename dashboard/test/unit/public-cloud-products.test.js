import { describe, it, expect } from 'vitest';
import { publicCloudProductLabel } from '../../src/utils/publicCloudProducts.js';
import { translations } from '../../src/i18n/translations.js';

// The page's translations in a language, as useLanguage() gives them
const tIn = (language) => (key) => translations[language][key] || key;

// The products of the other services of the Public Cloud tab, of a project's detail (#145), and
// of the Compare tab's comparison of a project's products (#181)
describe('publicCloudProductLabel', () => {
  it('names each product in the language of the page', () => {
    expect(publicCloudProductLabel('volumeBackups', tIn('fr'))).toBe('Sauvegardes de volumes');
    expect(publicCloudProductLabel('volumeBackups', tIn('en'))).toBe('Volume backups');
    expect(publicCloudProductLabel('databases', tIn('fr'))).toBe('Bases de données');
    expect(publicCloudProductLabel('registry', tIn('en'))).toBe('Container registry');
    expect(publicCloudProductLabel('other', tIn('fr'))).toBe('Divers');
  });

  // Which the Compare tab compares too (#181)
  it('names the products that have a card of their own in the language of the page', () => {
    expect(publicCloudProductLabel('instances', tIn('fr'))).toBe('Instances');
    expect(publicCloudProductLabel('instances', tIn('en'))).toBe('Instances');
    expect(publicCloudProductLabel('objectStorage', tIn('fr'))).toBe('Stockage objet');
    expect(publicCloudProductLabel('objectStorage', tIn('en'))).toBe('Object storage');
    expect(publicCloudProductLabel('volumes', tIn('fr'))).toBe('Volumes');
    expect(publicCloudProductLabel('snapshots', tIn('en'))).toBe('Snapshots');
    expect(publicCloudProductLabel('savingsPlans', tIn('fr'))).toBe('Savings plans');
    expect(publicCloudProductLabel('kubernetes', tIn('en'))).toBe('Kubernetes');
    expect(publicCloudProductLabel('registry', tIn('fr'))).toBe('Registre');
  });

  it('writes a product that the server names since as it is written', () => {
    expect(publicCloudProductLabel('quantum', tIn('fr'))).toBe('quantum');
  });
});
