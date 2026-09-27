import { describe, it, expect } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { accountsOf, scopeLabel } from '../../src/utils/accounts.js';
import {
  lyonAccount, removedAccount, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';

// What the page shows, as the report names it in its title (#124): all accounts, or the
// account selected, as the account selector names them. Nothing unless the page offers
// accounts to select, so that a single-account installation's report names none.

// The translations of the page, in French and in English
const inFrench = (key) => translations.fr[key];
const inEnglish = (key) => translations.en[key];

// The accounts of the instance, as the page reads them from the accounts route
const accounts = accountsOf([lyonAccount, unnamedAccount, removedAccount, unknownAccount]);

describe('scopeLabel', () => {
  it.each([
    ['while the accounts load', undefined, null],
    ['without any account', [], null],
    ['with a single account', accountsOf([lyonAccount]), null],
    ['while the page does not know the account shown yet', accounts, undefined],
  ])('is none %s', (_, accountList, selectedAccount) => {
    expect(scopeLabel(accountList, selectedAccount, inFrench)).toBeNull();
  });

  it('is all accounts while the page shows them, in its language', () => {
    expect(scopeLabel(accounts, null, inFrench)).toBe('Tous les comptes');
    expect(scopeLabel(accounts, null, inEnglish)).toBe('All accounts');
  });

  // By its name, or else its NIC handle, which says when config.json no longer lists it
  it.each([
    ['a named account', lyonAccount, 'Lyon subsidiary', 'Lyon subsidiary'],
    ['an account without a name', unnamedAccount, 'yy2222-ovh', 'yy2222-ovh'],
    ['an account no longer configured', removedAccount,
      'zz3333-ovh (non configuré)', 'zz3333-ovh (not configured)'],
    ['the Unknown account', unknownAccount, 'Compte inconnu', 'Unknown account'],
  ])('is the account selected as the account selector names it: %s',
    (_, { id }, french, english) => {
      expect(scopeLabel(accounts, id, inFrench)).toBe(french);
      expect(scopeLabel(accounts, id, inEnglish)).toBe(english);
    });

  // Rather than fail: the page shows only an account that the route lists
  it('is the NIC handle of an account that the accounts route does not list', () => {
    expect(scopeLabel(accounts, 'ww4444-ovh', inFrench)).toBe('ww4444-ovh');
  });
});
