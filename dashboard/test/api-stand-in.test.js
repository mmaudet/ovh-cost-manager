import { describe, it, expect, vi } from 'vitest';
import { api } from './support/api.js';

// setup.js replaces src/services/api.js with support/api.js in every test file
describe('API stand-in', () => {
  it('replaces every function of the API service module', async () => {
    const apiModule = await vi.importActual('../src/services/api.js');
    const functions = Object.keys(apiModule).filter((name) => name !== 'default');

    expect(Object.keys(api).sort()).toEqual(functions.sort());
  });
});
