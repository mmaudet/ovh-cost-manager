import { describe, it, expect } from 'vitest';
import * as apiModule from '../src/services/api.js';
import { api } from './support/api.js';

// The page tests replace src/services/api.js with support/api.js
describe('API stand-in', () => {
  it('replaces every function of the API service module', () => {
    const functions = Object.keys(apiModule).filter((name) => name !== 'default');

    expect(Object.keys(api).sort()).toEqual(functions.sort());
  });
});
