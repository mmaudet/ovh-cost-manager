import { describe, it, expect } from 'vitest';
import { publicCloudProductLabel } from '../../src/utils/publicCloudProducts.js';

// The products that the other services card of the Public Cloud tab names (#145)
describe('publicCloudProductLabel', () => {
  it('names each product in the language of the page', () => {
    expect(publicCloudProductLabel('volumeBackups', 'fr')).toBe('Sauvegardes de volumes');
    expect(publicCloudProductLabel('volumeBackups', 'en')).toBe('Volume backups');
    expect(publicCloudProductLabel('databases', 'fr')).toBe('Bases de données');
    expect(publicCloudProductLabel('credits', 'en')).toBe('Cloud credit');
    expect(publicCloudProductLabel('other', 'fr')).toBe('Divers');
  });

  it('writes a product that the server names since as it is written', () => {
    expect(publicCloudProductLabel('quantum', 'fr')).toBe('quantum');
  });
});
