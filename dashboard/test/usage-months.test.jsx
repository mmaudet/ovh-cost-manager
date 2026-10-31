import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { lyonAccount, severalAccounts } from './fixtures/accounts.js';
import { dropdown, optionsOf, renderDashboard, selectAccount, texts } from './support/render.jsx';

// An account whose cost source is its Public Cloud usage (CONTEXT.md): its bills, which a third
// party issues, are none that the API gives. Its usage bill of a month is dated on the first day
// of the next one: the page names its months by the month of their usage, and says where its
// costs come from.

// The only account of the instance, whose cost source is its Public Cloud usage
const usageAccount = {
  ...account,
  accounts: [{ ...account.accounts[0], costSource: 'cloudUsage' }],
};

// What the page says of the costs of such accounts, and of its months
const COSTS_NOTICE = 'Les coûts des comptes sans factures sont ceux de leur consommation Public '
  + 'Cloud : prix publics hors taxes, avant remises et crédits Public Cloud. Leurs autres '
  + 'services ne sont pas couverts.';
const MONTHS_NOTICE = 'Les mois affichés sont ceux de la consommation.';

const notice = () => screen.queryByRole('note');

describe('an account whose cost source is its Public Cloud usage', () => {
  // The usage of August, billed on 1 September, is August's
  it('names the months of the header by the month of their usage', async () => {
    await renderDashboard(usageAccount);

    expect(optionsOf(dropdown('Août 2026')))
      .toEqual(['Août 2026', 'Juillet 2026', 'Juin 2026']);
  });

  it('says that its costs are its Public Cloud usage\'s, and its months those of the usage',
    async () => {
      await renderDashboard(usageAccount);

      expect(texts(notice())).toEqual([`${COSTS_NOTICE} ${MONTHS_NOTICE}`]);
    });
});

describe('an account billed', () => {
  it('names its months as before, and says nothing of usage', async () => {
    await renderDashboard();

    expect(optionsOf(dropdown('Juillet 2026')))
      .toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
    expect(notice()).not.toBeInTheDocument();
  });
});

describe('several accounts, one of whose cost source is its Public Cloud usage', () => {
  const withLyonFromUsage = {
    ...severalAccounts,
    accounts: severalAccounts.accounts.map((entry) => (entry.id === lyonAccount.id
      ? { ...entry, costSource: 'cloudUsage' }
      : entry)),
  };

  // The months of the others are those of their bills
  it('names the months of all accounts as their bills do, and says where its costs come from',
    async () => {
      await renderDashboard(withLyonFromUsage);

      expect(optionsOf(dropdown('Juillet 2026')))
        .toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      expect(texts(notice())).toEqual([COSTS_NOTICE]);
    });

  it('names its own months by the month of their usage once it is selected', async () => {
    const { user } = await renderDashboard(withLyonFromUsage);

    await selectAccount(user, 'Lyon subsidiary');

    expect(optionsOf(dropdown('Juin 2026')))
      .toEqual(['Août 2026', 'Juillet 2026', 'Juin 2026']);
    expect(texts(notice())).toEqual([`${COSTS_NOTICE} ${MONTHS_NOTICE}`]);
  });
});
