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
  it('does not run a list by account only while the lists name no account', async () => {
    const { byAccount } = servicesOfSeptember(null);

    const shown = listQuery(accountColumn, { byAccount });
    const hidden = listQuery(null, { byAccount });

    expect([shown.queryKey, shown.enabled]).toEqual([byAccount.key, true]);
    expect([hidden.queryKey, hidden.enabled]).toEqual([byAccount.key, false]);
    // Its request asks for the list as it is, whatever the query's client passes it
    await expect(shown.queryFn({ signal: null })).resolves.toBe('by account');
    expect(byAccount.fetch).toHaveBeenCalledWith();
  });

  // The Compare tab's lists of the month in progress, while the page projects it (#218)
  describe('with the projected cost of the month in progress', () => {
    it('names the flag in the key and the request of the rows by account', async () => {
      const list = servicesOfSeptember(null);

      const query = listQuery(accountColumn, { ...list, projected: true });

      expect(query.queryKey)
        .toEqual(['servicesByAccount', '2026-09-01', '2026-09-30', 'projected']);
      expect(query.enabled).toBe(true);
      await query.queryFn();
      expect(list.byAccount.fetch).toHaveBeenCalledWith({ projected: true });
    });

    // As projectedQuery() does: the flag before the account
    it('names it before the account in those of the account shown', async () => {
      const list = servicesOfSeptember(lyonAccount.id);

      const query = listQuery(null, { ...list, projected: true });

      expect(query.queryKey)
        .toEqual(['services', '2026-09-01', '2026-09-30', 'projected', lyonAccount.id]);
      await query.queryFn();
      expect(list.ofAccountShown.fetch).toHaveBeenCalledWith(lyonAccount.id, { projected: true });
    });

    it('names it nowhere while the list does not project', async () => {
      const list = servicesOfSeptember(null);

      const query = listQuery(accountColumn, { ...list, projected: false });

      expect(query.queryKey).toEqual(['servicesByAccount', '2026-09-01', '2026-09-30']);
      await query.queryFn();
      expect(list.byAccount.fetch).toHaveBeenCalledWith();
    });
  });
});
