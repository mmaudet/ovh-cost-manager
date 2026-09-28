import { describe, it, expect } from 'vitest';
import { importStateOf } from '../../src/utils/accounts.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount,
} from '../fixtures/accounts.js';

// How the account shown is imported, which tells why it has no carbon footprint (#153)
describe('importStateOf', () => {
  const { accounts } = severalAccounts;

  it('tells the Unknown account, whose rows no import claimed', () => {
    expect(importStateOf(accounts, unknownAccount.id)).toBe('unknown');
  });

  it('tells an account that config.json no longer lists, which is no longer imported', () => {
    expect(importStateOf(accounts, removedAccount.id)).toBe('removed');
  });

  it('tells a configured account imported, and so are all accounts', () => {
    expect(importStateOf(accounts, lyonAccount.id)).toBe('imported');
    expect(importStateOf(accounts, null)).toBe('imported');
  });

  it('tells imported while the accounts load, or for an account that they do not list', () => {
    expect(importStateOf(undefined, lyonAccount.id)).toBe('imported');
    expect(importStateOf(accounts, 'ww4444-ovh')).toBe('imported');
  });
});
