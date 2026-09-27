import { describe, it, expect } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import {
  accountColumnOf, accountNameOf, accountsOf, showsAccountColumn,
} from '../../src/utils/accounts.js';
import {
  lyonAccount, removedAccount, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';

// The Account column of the lists (#121), which the tabs share: none unless the page offers
// several accounts and shows all of them, and then its label and what it shows for the account
// of a row, from the NIC handle that the routes give

// The translations of the page, in French and in English
const inFrench = (key) => translations.fr[key];
const inEnglish = (key) => translations.en[key];

// The accounts of the instance, as the page reads them from the accounts route
const accounts = accountsOf([lyonAccount, unnamedAccount, removedAccount, unknownAccount]);

describe('accountColumnOf', () => {
  // A single-account installation keeps its lists as they were, and so does one account shown
  it.each([
    ['while the accounts load', undefined, null],
    ['without any account', [], null],
    ['with a single account', accountsOf([lyonAccount]), null],
    ['with an account selected', accounts, lyonAccount.id],
    ['with the Unknown account selected', accounts, unknownAccount.id],
    ['while the page does not know the account shown yet', accounts, undefined],
  ])('is none %s', (_, accountList, selectedAccount) => {
    expect(accountColumnOf(accountList, selectedAccount, inFrench)).toBeNull();
  });

  it('is a column of the lists with all accounts shown, when there are two or more', () => {
    expect(accountColumnOf(accountsOf([lyonAccount, unnamedAccount]), null, inFrench))
      .toEqual({ label: 'Compte', nameOf: expect.any(Function) });
  });

  describe('what it shows for the account of a row', () => {
    const { nameOf } = accountColumnOf(accounts, null, inFrench);

    it('is the name of the account', () => {
      expect(nameOf(lyonAccount.nic)).toBe('Lyon subsidiary');
    });

    // The route names an account by its NIC handle when config.json gives it no name
    it('is else its NIC handle, whether or not config.json still lists it', () => {
      expect(nameOf(unnamedAccount.nic)).toBe('yy2222-ovh');
      expect(nameOf(removedAccount.nic)).toBe('zz3333-ovh');
    });

    it('is the NIC handle of an account that the accounts route does not list', () => {
      expect(nameOf('ww4444-ovh')).toBe('ww4444-ovh');
    });

    it('is the Unknown account for a row without an account', () => {
      expect(nameOf(null)).toBe('Compte inconnu');
    });
  });

  it('speaks the language of the page', () => {
    const column = accountColumnOf(accounts, null, inEnglish);

    expect(column.label).toBe('Account');
    expect(column.nameOf(null)).toBe('Unknown account');
  });
});

// The Account column of the Overview's lists (#118)
describe('showsAccountColumn', () => {
  it('shows the column with all accounts shown, when the page offers several', () => {
    expect(showsAccountColumn(accounts, null)).toBe(true);
    // An account and the Unknown account are two
    expect(showsAccountColumn(accountsOf([lyonAccount, unknownAccount]), null)).toBe(true);
  });

  it('hides it with an account shown, or while the page does not know which one yet', () => {
    expect(showsAccountColumn(accounts, lyonAccount.id)).toBe(false);
    expect(showsAccountColumn(accounts, unknownAccount.id)).toBe(false);
    expect(showsAccountColumn(accounts, undefined)).toBe(false);
  });

  // The lists of a single-account installation stay as they were
  it('hides it when the page offers no account to select', () => {
    expect(showsAccountColumn(accountsOf([lyonAccount]), null)).toBe(false);
    expect(showsAccountColumn([], null)).toBe(false);
    // While the list of the accounts loads
    expect(showsAccountColumn(undefined, null)).toBe(false);
  });
});

describe('accountNameOf', () => {
  it('names an account as the accounts route does: by its name, or else its NIC handle', () => {
    expect(accountNameOf('xx1111-ovh', accounts, inFrench)).toBe('Lyon subsidiary');
    expect(accountNameOf('yy2222-ovh', accounts, inFrench)).toBe('yy2222-ovh');
  });

  // The selector says it is no longer configured; the column names it only
  it('names an account no longer configured by its name alone', () => {
    const named = accountsOf([lyonAccount, { ...removedAccount, name: 'Paris branch' }]);

    expect(accountNameOf('zz3333-ovh', named, inFrench)).toBe('Paris branch');
  });

  it('names the account of a row without one the Unknown account, in the page language',
    () => {
      expect(accountNameOf(null, accounts, inFrench)).toBe('Compte inconnu');
      expect(accountNameOf(null, accounts, (key) => translations.en[key]))
        .toBe('Unknown account');
    });

  it('gives the NIC handle of an account that the accounts route does not list', () => {
    expect(accountNameOf('ww4444-ovh', accounts, inFrench)).toBe('ww4444-ovh');
  });
});
