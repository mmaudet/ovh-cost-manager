import { describe, it, expect } from 'vitest';
import { publicCloudProductLabel } from '../../src/utils/publicCloudProducts.js';
import { translations } from '../../src/i18n/translations.js';

// The page's translations in a language, as useLanguage() gives them
const tIn = (language) => (key) => translations[language][key] || key;

// The products of the other services of the Public Cloud tab, and of a project's detail (#145)
describe('publicCloudProductLabel', () => {
  it('names each product in the language of the page', () => {
    expect(publicCloudProductLabel('volumeBackups', tIn('fr'))).toBe('Sauvegardes de volumes');
    expect(publicCloudProductLabel('volumeBackups', tIn('en'))).toBe('Volume backups');
    expect(publicCloudProductLabel('databases', tIn('fr'))).toBe('Bases de données');
    expect(publicCloudProductLabel('registry', tIn('en'))).toBe('Container registry');
    expect(publicCloudProductLabel('other', tIn('fr'))).toBe('Divers');
  });

  it('writes a product that the server names since as it is written', () => {
    expect(publicCloudProductLabel('quantum', tIn('fr'))).toBe('quantum');
  });
});
