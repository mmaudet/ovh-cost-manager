import { describe, it, expect } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import {
  accountColumnOf, accountCsvColumns, accountInBrackets, accountsOf, withAccountNames,
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
    // The Unknown account counts among them (#118)
    expect(accountColumnOf(accountsOf([lyonAccount, unknownAccount]), null, inFrench))
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

    // Which the account selector says, but not the column (#118)
    it('is the name alone of an account that config.json no longer lists', () => {
      const named = accountsOf([lyonAccount, { ...removedAccount, name: 'Paris branch' }]);

      expect(accountColumnOf(named, null, inFrench).nameOf(removedAccount.nic))
        .toBe('Paris branch');
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

// How a line that names a service, rather than a table, names its account too (#123)
describe('accountInBrackets', () => {
  const column = accountColumnOf(accounts, null, inFrench);

  // So that it does not read as part of the service's name
  it('is the name of the account in brackets', () => {
    expect(accountInBrackets(column, lyonAccount.nic)).toBe('(Lyon subsidiary)');
    expect(accountInBrackets(column, removedAccount.nic)).toBe('(zz3333-ovh)');
    expect(accountInBrackets(column, null)).toBe('(Compte inconnu)');
  });

  it('is none without the Account column', () => {
    expect(accountInBrackets(null, lyonAccount.nic)).toBeNull();
  });
});

// The rows of a list as its table and its CSV file show them (#122, #123)
describe('withAccountNames', () => {
  const column = accountColumnOf(accounts, null, inFrench);
  const rows = [
    { id: 'ns3000001.ip-203-0-113.eu', account: lyonAccount.nic },
    { id: 'ns3000004.ip-203-0-113.eu', account: null },
  ];

  it('gives each row the name of its account with the Account column', () => {
    expect(withAccountNames(rows, column)).toEqual([
      { ...rows[0], accountName: 'Lyon subsidiary' },
      { ...rows[1], accountName: 'Compte inconnu' },
    ]);
    // The rows it was given stay as they were
    expect(rows[0]).not.toHaveProperty('accountName');
  });

  it('gives the rows as they are without it', () => {
    expect(withAccountNames(rows, null)).toBe(rows);
  });
});

// So that a spreadsheet can pivot the rows of a list by account (#122, #123)
describe('accountCsvColumns', () => {
  it("is the column of the name of each row's account, with the Account column's label", () => {
    expect(accountCsvColumns(accountColumnOf(accounts, null, inEnglish)))
      .toEqual([{ key: 'accountName', label: 'Account' }]);
  });

  it('is none without the Account column', () => {
    expect(accountCsvColumns(null)).toEqual([]);
  });
});
