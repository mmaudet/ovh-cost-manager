import { describe, it, expect, vi } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { accountColumnOf, accountsOf, listQuery } from '../../src/utils/accounts.js';
import { lyonAccount, unnamedAccount } from '../fixtures/accounts.js';

// The query of a list, as the lists show it (#118, #194): the rows of the account shown, as
// accountQuery() asks for them, or, while the lists name the account of each row, with all
// accounts shown, those of all accounts by account. The hooks run the options it gives; their
// tests pin the keys that the page shares (shell-queries.test.jsx).

// The Account column of the lists, which shows with several accounts, all of them shown
const accountColumn = accountColumnOf(
  accountsOf([lyonAccount, unnamedAccount]), null, (key) => translations.fr[key],
);

// A list of the services of a month, which the page asks for by account while the lists name
// the account of each service, and for the account shown otherwise
const servicesOfSeptember = (account) => ({
  byAccount: {
    key: ['servicesByAccount', '2026-09-01', '2026-09-30'],
    fetch: vi.fn(() => Promise.resolve('by account')),
  },
  ofAccountShown: {
    account,
    key: ['services', '2026-09-01', '2026-09-30'],
    fetch: vi.fn((shown) => Promise.resolve(`of ${shown}`)),
  },
});

describe('listQuery', () => {
  it('asks for the rows of all accounts by account, under a key that names none', async () => {
    const list = servicesOfSeptember(null);

    const query = listQuery(accountColumn, list);

    expect(query.queryKey).toEqual(['servicesByAccount', '2026-09-01', '2026-09-30']);
    expect(query.enabled).toBe(true);
    await expect(query.queryFn()).resolves.toBe('by account');
    expect(list.ofAccountShown.fetch).not.toHaveBeenCalled();
  });

  it('asks for those of the account shown while the lists name no account', async () => {
    const list = servicesOfSeptember(lyonAccount.id);

    const query = listQuery(null, list);

    // As accountQuery() does: its key names the account last
    expect(query.queryKey).toEqual(['services', '2026-09-01', '2026-09-30', lyonAccount.id]);
    expect(query.enabled).toBe(true);
    await expect(query.queryFn()).resolves.toBe(`of ${lyonAccount.id}`);
    expect(list.byAccount.fetch).not.toHaveBeenCalled();
  });

  it('runs neither while it may not run besides', () => {
    expect(listQuery(accountColumn, { ...servicesOfSeptember(null), enabled: false }).enabled)
      .toBe(false);
    expect(listQuery(null, { ...servicesOfSeptember(null), enabled: false }).enabled)
      .toBe(false);
    // Nor while the page does not know the account shown yet, as accountQuery()
    expect(listQuery(null, servicesOfSeptember(undefined)).enabled).toBe(false);
  });

  // Such as the Overview's projects by account, which the shell's projects of the account shown
  // stand for while the lists name no account
  it('does not run a list by account only while the lists name no account', () => {
    const { byAccount } = servicesOfSeptember(null);

    expect(listQuery(accountColumn, { byAccount })).toEqual({
      queryKey: byAccount.key, queryFn: byAccount.fetch, enabled: true,
    });
    expect(listQuery(null, { byAccount })).toEqual({
      queryKey: byAccount.key, queryFn: byAccount.fetch, enabled: false,
    });
  });
});
