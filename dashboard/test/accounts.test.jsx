import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from './fixtures/accounts.js';
import { api } from './support/api.js';
import {
  accountSelector,
  cardOf,
  cardRowOf,
  emptyState,
  monthSelector,
  openTab,
  optionsOf,
  renderDashboard,
  reopenDashboard,
  selectAccount,
  selectLanguage,
  selectMonth,
  texts,
} from './support/render.jsx';

// The KPI cards of the month's figures, as the user reads them. The Cloud total is found
// among them: the Overview's breakdown by project ends with a row of the same label.
const monthCost = () => texts(cardOf('Coût total du mois'));
const cloudTotal = () =>
  texts(cardOf(within(cardRowOf('Coût total du mois')).getByText('Total Cloud')));
const dailyAverage = () => texts(cardOf('Coût moyen / jour'));
const activeProjects = () => texts(cardOf('Projets actifs'));

// What the card of the month's cost shows: its label, the cost, and how it compares with the
// month before
const costCard = (cost, variation) => ['Coût total du mois', cost, variation];
// September for all accounts, compared with August (see fixtures/account.js), and for Lyon
const allAccountsCost = costCard('1 250,40€', '+20,0 % vs mois précédent');
const lyonCost = costCard('890,40€', '+45,5 % vs mois précédent');

// The cards of the current month's consumption and of its month-end forecast (#116), on the
// 15th of September, as the user reads them: the consumption and where it comes from, the
// forecast and the days that it extrapolates
const consumption = () => texts(cardOf('Consommation en cours'));
const forecast = () => texts(cardOf('Prévision fin de mois'));
const consumptionCard = (amount, projects) => [
  'Consommation en cours', '15 septembre 2026', amount, `Public Cloud · ${projects} projets cloud`,
];
const forecastCard = (amount) => [
  'Prévision fin de mois', 'Septembre 2026', amount, '14/30 jours',
];
// The same when the forecast goes over the budget that the page compares it with (#117)
const forecastAboveBudget = (amount) => [
  'Prévision fin de mois', 'Septembre 2026', amount, '> Budget!',
];
// The accounts, with the dashboard budget, and the budgets of the accounts' own, by id, that
// the configuration route gives (#117)
const withBudgets = (budget, accountBudgets) => ({
  ...severalAccounts, config: { ...severalAccounts.config, budget, accountBudgets },
});

// The dropdowns of the page, in their order, each as the option it shows
const dropdownsShown = () => screen.getAllByRole('combobox').map((select) => texts(select)[0]);

// The account selector of the header (#115): the accounts the instance knows, all of them by
// default. The month selector, the KPI cards of the month's figures and those of the current
// month's consumption (#116) follow the account selected; the other cards and the tabs follow
// it in the next tickets (#117 to #123).
describe('account selector', () => {
  describe('in the header', () => {
    it.each([
      ['no account, as before the first import since the upgrade', []],
      ['a single account', [lyonAccount]],
    ])('does not show with %s, nor change the page', async (_, accounts) => {
      await renderDashboard({ ...severalAccounts, accounts });

      expect(accountSelector()).not.toBeInTheDocument();
      // The language, the month and the export
      expect(dropdownsShown()).toEqual(['FR', 'Septembre 2026', 'Choisir...']);
      expect(monthCost()).toEqual(allAccountsCost);
    });

    // The Unknown account and the accounts no longer configured count
    it.each([
      ['two accounts', [lyonAccount, unnamedAccount]],
      ['an account and the Unknown account', [lyonAccount, unknownAccount]],
      ['an account and one no longer configured', [lyonAccount, removedAccount]],
    ])('shows next to the month selector with %s', async (_, accounts) => {
      await renderDashboard({ ...severalAccounts, accounts });

      expect(accountSelector()).toBeInTheDocument();
      expect(dropdownsShown()).toEqual(['FR', 'Tous les comptes', 'Septembre 2026', 'Choisir...']);
    });

    // The Compare tab will compare two months of the account selected (#119)
    it('stays on the Compare tab, which has no month selector', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Comparaison');

      expect(dropdownsShown()).toEqual(['FR', 'Tous les comptes', 'Août 2026', 'Septembre 2026']);
    });
  });

  describe('options', () => {
    it.each([
      ['fr', ['Tous les comptes', 'Lyon subsidiary', 'yy2222-ovh',
        'zz3333-ovh (non configuré)', 'Compte inconnu']],
      ['en', ['All accounts', 'Lyon subsidiary', 'yy2222-ovh',
        'zz3333-ovh (not configured)', 'Unknown account']],
    ])('are all accounts, then each account as the accounts route lists it (%s)',
      async (language, options) => {
        // The language the page remembers from an earlier visit
        localStorage.setItem('ovh-dashboard-language', language);

        await renderDashboard(severalAccounts);

        expect(optionsOf(accountSelector())).toEqual(options);
      });

    // Until the route gives the id of each account, and whether it is configured (#114): an
    // account is then known by its NIC handle, and configured
    it('name the accounts that the route lists without their id, as configured', async () => {
      const listed = [lyonAccount, unnamedAccount].map(({ nic, name, currency, lastImport }) =>
        ({ nic, name, currency, lastImport }));
      const { user } = await renderDashboard({ ...severalAccounts, accounts: listed });

      expect(optionsOf(accountSelector()))
        .toEqual(['Tous les comptes', 'Lyon subsidiary', 'yy2222-ovh']);

      await selectAccount(user, 'Lyon subsidiary');

      expect(monthCost()).toEqual(lyonCost);
    });
  });

  describe('KPI cards', () => {
    it('show the figures of all accounts by default', async () => {
      await renderDashboard(severalAccounts);

      expect(accountSelector()).toHaveDisplayValue('Tous les comptes');
      expect(monthCost()).toEqual(allAccountsCost);
      expect(cloudTotal()).toEqual(['Total Cloud', '830,40€', 'Public Cloud']);
      expect(dailyAverage()).toEqual(['Coût moyen / jour', '41,68€', 'Sur 30 jours']);
      expect(activeProjects()).toEqual(['Projets actifs', '2', 'avec consommation']);
    });

    it('show the figures of the account selected, and of all accounts again', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await selectAccount(user, 'Lyon subsidiary');

      // Compared with the account's own August
      expect(monthCost()).toEqual(lyonCost);
      expect(cloudTotal()).toEqual(['Total Cloud', '610,40€', 'Public Cloud']);
      expect(dailyAverage()).toEqual(['Coût moyen / jour', '29,68€', 'Sur 30 jours']);
      expect(activeProjects()).toEqual(['Projets actifs', '1', 'avec consommation']);

      await selectAccount(user, 'Tous les comptes');

      expect(monthCost()).toEqual(allAccountsCost);
      expect(cloudTotal()).toEqual(['Total Cloud', '830,40€', 'Public Cloud']);
    });

    it('show the figures of the Unknown account', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await selectAccount(user, 'Compte inconnu');

      // July, its only month: its first, whatever the other accounts billed before
      expect(monthCost()).toEqual(costCard('120,00€', 'Pas de données précédentes'));
      expect(cloudTotal()).toEqual(['Total Cloud', '0,00€', 'Public Cloud']);
      expect(activeProjects()).toEqual(['Projets actifs', '0', 'avec consommation']);
    });

    // The sum of the accounts', which their projects tell over the same days
    it("show the current month's consumption and forecast of all accounts by default",
      async () => {
        await renderDashboard(severalAccounts);

        expect(consumption()).toEqual(consumptionCard('402,35€', 2));
        expect(forecast()).toEqual(forecastCard('862,18€'));
      });

    it("show the current month's consumption and forecast of the account selected",
      async () => {
        const { user } = await renderDashboard(severalAccounts);

        await selectAccount(user, 'Lyon subsidiary');

        expect(consumption()).toEqual(consumptionCard('350,00€', 1));
        expect(forecast()).toEqual(forecastCard('750,00€'));

        await selectAccount(user, 'yy2222-ovh');

        expect(consumption()).toEqual(consumptionCard('52,35€', 1));
        expect(forecast()).toEqual(forecastCard('112,18€'));

        await selectAccount(user, 'Tous les comptes');

        expect(consumption()).toEqual(consumptionCard('402,35€', 2));
        expect(forecast()).toEqual(forecastCard('862,18€'));
      });

    // The dashboard budget, which the forecast of all accounts goes over, and not that of the
    // Lyon subsidiary, which it does not (#117)
    it('flag the forecast of all accounts above the dashboard budget', async () => {
      await renderDashboard(withBudgets(800, { [lyonAccount.id]: 1000 }));

      expect(forecast()).toEqual(forecastAboveBudget('862,18€'));
    });

    // Its import stopped in August, before any consumption this month: the cards show none,
    // rather than the consumption of all accounts, with the card of its resources of August
    it('show no consumption for an account that has none this month', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await selectAccount(user, 'zz3333-ovh (non configuré)');

      expect(texts(cardRowOf('Consommation en cours'))).toEqual([
        'Consommation en cours', '15 septembre 2026', '0,00€', 'Prévision fin de mois',
        'Prévision fin de mois', 'Septembre 2026', '0,00€', 'Prévision fin de mois',
        'Total ressources', '1', '1 Serveurs dédiés · 0 VPS · 0 Projets Cloud',
      ]);
    });
  });

  describe('months', () => {
    it('are those of the account selected, which keeps the month selected when it has it',
      async () => {
        const { user } = await renderDashboard(severalAccounts);
        await selectMonth(user, 'Août 2026');

        await selectAccount(user, 'yy2222-ovh');

        expect(optionsOf(monthSelector())).toEqual(['Septembre 2026', 'Août 2026']);
        expect(monthSelector()).toHaveDisplayValue('Août 2026');
        // The first month of that account
        expect(monthCost()).toEqual(costCard('230,00€', 'Pas de données précédentes'));
      });

    it('move to the latest month of the account selected when it lacks the month selected',
      async () => {
        const { user } = await renderDashboard(severalAccounts);

        await selectAccount(user, 'zz3333-ovh (non configuré)');

        expect(optionsOf(monthSelector())).toEqual(['Août 2026', 'Juillet 2026']);
        expect(monthSelector()).toHaveDisplayValue('Août 2026');
        expect(monthCost()).toEqual(costCard('200,00€', '+11,1 % vs mois précédent'));
      });

    // The month selected stays until the account's months list loads, and says it lacks it
    it('ask for no figures of the month selected that the account selected lacks', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await selectAccount(user, 'zz3333-ovh (non configuré)');

      expect(api.fetchSummary)
        .not.toHaveBeenCalledWith('2026-09-01', '2026-09-30', removedAccount.id);
      expect(api.fetchSummary).toHaveBeenCalledWith('2026-08-01', '2026-08-31', removedAccount.id);
    });

    it('are those of all accounts again once they are selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Compte inconnu');
      expect(optionsOf(monthSelector())).toEqual(['Juillet 2026']);

      await selectAccount(user, 'Tous les comptes');

      expect(optionsOf(monthSelector())).toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      // July, which all accounts have too
      expect(monthSelector()).toHaveDisplayValue('Juillet 2026');
    });

    // Its first import failed, say: rather than a dashboard of nothing, the page says there is
    // no data, as it does before any import, and keeps the selector to leave that account
    it('show there is no data for an account without any bill, from which the user can leave',
      async () => {
        const failedAccount = {
          ...lyonAccount,
          id: 'ww4444-ovh',
          nic: 'ww4444-ovh',
          name: 'Marseille',
          lastImport: {
            at: '2026-09-14 04:02:40', status: 'failed', error: 'This credential is not valid',
          },
        };
        const { user } = await renderDashboard({
          ...severalAccounts, accounts: [...severalAccounts.accounts, failedAccount],
        });

        await selectAccount(user, 'Marseille');

        expect(texts(emptyState())).toEqual([
          'Pas encore de données',
          "Aucune facture n'a encore été importée. Lancez un import, ou vérifiez les"
            + " identifiants de l'API OVHcloud.",
          'Marseille', '⟳', 'Synchroniser',
        ]);

        await selectAccount(user, 'Tous les comptes');

        expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
        expect(monthCost()).toEqual(allAccountsCost);
      });
  });

  // As the language
  describe('memory', () => {
    it('opens on the account selected on an earlier visit', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');

      await reopenDashboard(severalAccounts);

      expect(accountSelector()).toHaveDisplayValue('Lyon subsidiary');
      expect(monthCost()).toEqual(lyonCost);
    });

    it('opens on all accounts once they are selected again', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');
      await selectAccount(user, 'Tous les comptes');

      await reopenDashboard(severalAccounts);

      expect(accountSelector()).toHaveDisplayValue('Tous les comptes');
      expect(monthCost()).toEqual(allAccountsCost);
    });

    // Selects the Unknown account, then opens the page again once an import gave each of its
    // bills to an account: the accounts route then lists these accounts
    const reopenOnceClaimed = async (accounts) => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Compte inconnu');
      api.fetchMonths.mockClear();
      api.fetchSummary.mockClear();
      await reopenDashboard({ ...severalAccounts, accounts });
    };
    // The page shows September for all accounts, without asking the server for the account
    // it no longer lists, which it would refuse
    const expectAllAccountsAsked = () => {
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
      expect(monthCost()).toEqual(allAccountsCost);
      expect(api.fetchMonths).not.toHaveBeenCalledWith(unknownAccount.id);
      expect(api.fetchSummary)
        .not.toHaveBeenCalledWith(expect.anything(), expect.anything(), unknownAccount.id);
    };

    it('opens on all accounts when the account selected then is no longer listed', async () => {
      await reopenOnceClaimed([lyonAccount, unnamedAccount, removedAccount]);

      expect(accountSelector()).toHaveDisplayValue('Tous les comptes');
      expectAllAccountsAsked();
    });

    it('opens on all accounts, with no selector, when a single account is left', async () => {
      await reopenOnceClaimed([lyonAccount]);

      expect(accountSelector()).not.toBeInTheDocument();
      expectAllAccountsAsked();
    });

    // As some private windows do, or a browser that blocks the data of sites: the page opens
    // on its defaults, and what the user selects lasts until it closes
    it('lets the page open, and select an account and a language, when the browser refuses storage',
      async () => {
        const refuse = () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        };
        for (const method of ['getItem', 'setItem', 'removeItem']) {
          vi.spyOn(Storage.prototype, method).mockImplementation(refuse);
        }

        const { user } = await renderDashboard(severalAccounts);

        expect(accountSelector()).toHaveDisplayValue('Tous les comptes');
        expect(monthCost()).toEqual(allAccountsCost);

        await selectAccount(user, 'Lyon subsidiary');
        await selectLanguage(user, 'en');

        expect(texts(cardOf('Total monthly cost')))
          .toEqual(['Total monthly cost', '890.40€', '+45.5% vs previous month']);
      });
  });
});
