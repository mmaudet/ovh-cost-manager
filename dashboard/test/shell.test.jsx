import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from './fixtures/accounts.js';
import { api, holdBack, serve } from './support/api.js';
import { captureFileDownloads } from './support/downloads.js';
import {
  cardOf,
  cardRowOf,
  disclosure,
  dropdown,
  emptyState,
  fakeTimers,
  footer,
  headerBadge,
  importStatusesOf,
  importToneOf,
  lastSyncLines,
  loadingScreen,
  openTab,
  optionsOf,
  passTime,
  renderDashboard,
  resync,
  rowsOf,
  selectAccount,
  selectLanguage,
  selectMonth,
  settle,
  texts,
  toneOf,
} from './support/render.jsx';

// The month selector of the header offers every billed month
const monthSelector = () => dropdown('Juillet 2026');
// The Cloud total card, among the KPI cards of the month's cost: the Overview's breakdown by
// project ends with a row of the same label
const cloudTotalCard = (label = 'Total Cloud', monthCost = 'Coût total du mois') =>
  cardOf(within(cardRowOf(monthCost)).getByText(label));

// The shell: the header, the KPI cards, the tab bar, the sync warning banner
// and the footer, around whatever tab is open.
describe('dashboard shell', () => {
  describe('month selection', () => {
    it('shows a loading screen until the month summary arrives', async () => {
      const loading = renderDashboard();
      expect(screen.getByText('Chargement des données...')).toBeInTheDocument();

      await loading;
      expect(screen.queryByText('Chargement des données...')).not.toBeInTheDocument();
    });

    it.each([
      ['fr', ['Chargement...', 'Chargement des données...']],
      ['en', ['Loading...', 'Loading data...']],
    ])('says that it is loading in the language of the page (%s)', async (language, shown) => {
      // The language the page remembers from an earlier visit
      localStorage.setItem('ovh-dashboard-language', language);

      const loading = renderDashboard();
      // Read before the answers arrive, checked once they did
      const loadingTexts = texts(loadingScreen());
      await loading;

      expect(loadingTexts).toEqual(shown);
    });

    // A new account, or one whose first import has not run yet: no month to select, so no
    // dashboard to show
    describe('when no month was billed (#51)', () => {
      // Nothing ever imported: no bill, and no import in the history
      const noMonth = { ...account, months: [], importStatus: undefined };
      const hint = "Aucune facture n'a encore été importée. Lancez un import, ou vérifiez"
        + " les identifiants de l'API OVHcloud.";

      it('keeps the loading screen until the months list arrives', async () => {
        const loading = renderDashboard(noMonth);
        expect(screen.getByText('Chargement des données...')).toBeInTheDocument();
        expect(screen.queryByText('Pas encore de données')).not.toBeInTheDocument();

        await loading;
        expect(screen.queryByText('Chargement des données...')).not.toBeInTheDocument();
        expect(emptyState()).toBeInTheDocument();
      });

      it('says that there is no data yet, and offers the resync of the header', async () => {
        await renderDashboard(noMonth);

        expect(texts(emptyState())).toEqual(['Pas encore de données', hint, '⟳', 'Synchroniser']);
      });

      it('offers no resync when the server runs no imports', async () => {
        await renderDashboard({ ...noMonth, config: { ...account.config, importEnabled: false } });

        expect(texts(emptyState())).toEqual(['Pas encore de données', hint]);
        expect(screen.queryByRole('button', { name: /Synchroniser/ })).not.toBeInTheDocument();
      });

      it('resyncs as the header does, and says so', async () => {
        const { user } = await renderDashboard(noMonth);
        let started;
        api.triggerImport.mockImplementation(() => new Promise((resolve) => {
          started = resolve;
        }));

        await user.click(screen.getByRole('button', { name: /Synchroniser/ }));

        expect(await screen.findByRole('button', { name: /Synchronisation\.\.\./ }))
          .toBeDisabled();

        started({ started: true });
        await settle();

        expect(texts(emptyState())).toEqual([
          'Pas encore de données', hint, '⟳', 'Synchroniser',
          'Synchronisation lancée. Les données se mettront à jour dans quelques instants.',
        ]);
      });

      it('says so in the language the user picked', async () => {
        // English, which the page remembers from an earlier visit
        localStorage.setItem('ovh-dashboard-language', 'en');

        await renderDashboard(noMonth);

        expect(texts(emptyState())).toEqual([
          'No data yet',
          'No bill has been imported yet. Run an import, or check the OVHcloud API credentials.',
          '⟳', 'Resync',
        ]);
      });
    });

    it('lists the billed months and selects the most recent one', async () => {
      await renderDashboard();

      expect(optionsOf(monthSelector())).toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
    });

    it('shows the figures of the month the user selects', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Août 2026');

      expect(monthSelector()).toHaveDisplayValue('Août 2026');
      // Compared with July, the month before (#50)
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 042,00€', '+6,3 % vs mois précédent']);
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '702,00€', 'Public Cloud']);
      expect(texts(cardOf('Coût moyen / jour')))
        .toEqual(['Coût moyen / jour', '33,61€', 'Sur 30 jours']);
      expect(texts(cardOf('Projets actifs'))).toEqual(['Projets actifs', '2', 'avec consommation']);
      expect(texts(cardOf('Total ressources')))
        .toEqual(['Total ressources', '7', '1 Serveurs dédiés · 0 VPS · 2 Projets Cloud']);
    });

    it('shows the loading screen again while the summary of the new month loads', async () => {
      const { user } = await renderDashboard();
      // Hold back the summary of July, and only that one. Not August's: the page loads it at
      // start, for the variation of September (#50)
      const releaseJuly = holdBack(api.fetchSummary,
        (from, to) => from === '2026-07-01' && to === '2026-07-31');

      await user.selectOptions(monthSelector(), 'Juillet 2026');
      expect(screen.getByText('Chargement des données...')).toBeInTheDocument();

      releaseJuly();
      await settle();
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '980,00€', 'Pas de données précédentes']);
    });
  });

  describe('KPI cards', () => {
    it("show the month's cost, Cloud total, daily average and active projects", async () => {
      await renderDashboard();

      // Compared with August, the month before (#50, see below)
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 250,40€', '+20,0 % vs mois précédent']);
      // In French, the Cloud total reads as in the breakdown by project and the report (#87)
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '830,40€', 'Public Cloud']);
      expect(texts(cardOf('Coût moyen / jour')))
        .toEqual(['Coût moyen / jour', '41,68€', 'Sur 30 jours']);
      expect(texts(cardOf('Projets actifs'))).toEqual(['Projets actifs', '2', 'avec consommation']);
    });

    it('show the consumption so far, the month-end forecast and the resource count', async () => {
      await renderDashboard();

      expect(texts(cardOf('Consommation en cours'))).toEqual([
        'Consommation en cours', '15 septembre 2026',
        '402,35€', 'Public Cloud · 2 projets cloud',
      ]);
      // The month capitalised, as the other month labels (#33)
      expect(texts(cardOf('Prévision fin de mois')))
        .toEqual(['Prévision fin de mois', 'Septembre 2026', '862,18€', '14/30 jours']);
      expect(texts(cardOf('Total ressources')))
        .toEqual(['Total ressources', '9', '1 Serveurs dédiés · 0 VPS · 2 Projets Cloud']);
    });

    it('flag a forecast above the budget', async () => {
      await renderDashboard({ ...account, config: { budget: 800, currency: 'EUR' } });

      expect(texts(cardOf('Prévision fin de mois')))
        .toEqual(['Prévision fin de mois', 'Septembre 2026', '862,18€', '> Budget!']);
    });
  });

  // From the month just before the selected one in the calendar, whatever the Compare tab
  // compares (#50)
  describe('"vs previous month" variation (#50)', () => {
    const totalCostCard = () => cardOf('Coût total du mois');
    // What shows in place of a variation that cannot be computed, and its tooltip
    const notComputable = '— vs mois précédent';
    const whyNotComputable = 'non calculable : mois précédent à 0 € ou moins';

    it('compares the latest month with the month before', async () => {
      await renderDashboard();

      // (1 250.40 - 1 042) / 1 042
      expect(texts(totalCostCard())).toContain('+20,0 % vs mois précédent');
    });

    it('compares an older month with the month before it, not with the latest', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Août 2026');

      // (1 042 - 980) / 980
      expect(texts(totalCostCard())).toContain('+6,3 % vs mois précédent');
    });

    it('ignores the months picked in the Compare tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      // Month B, September until then, becomes July
      await user.selectOptions(dropdown('Juillet 2026', 'Septembre 2026'), 'Juillet 2026');
      await settle();

      // Still from August, not from July
      expect(texts(totalCostCard())).toContain('+20,0 % vs mois précédent');
    });

    it('waits for the summary of the month before, rather than showing none', async () => {
      const { user } = await renderDashboard();
      // Hold back the summary of July, the month before August. August's is there already:
      // the page loaded it for the variation of September.
      const releaseJuly = holdBack(api.fetchSummary,
        (from, to) => from === '2026-07-01' && to === '2026-07-31');

      await user.selectOptions(monthSelector(), 'Août 2026');
      expect(screen.getByText('Chargement des données...')).toBeInTheDocument();

      releaseJuly();
      await settle();
      expect(texts(totalCostCard()))
        .toEqual(['Coût total du mois', '1 042,00€', '+6,3 % vs mois précédent']);
    });

    // As in the Compare and Trends tabs (#65): it would be infinite from 0 €, and of the
    // wrong sign from credits larger than the costs
    it.each([
      ['at 0 €', 0],
      ['whose credits exceed its costs', -120.5],
    ])('shows none from a month before %s, and says why', async (_, total) => {
      const { user } = await renderDashboard({
        ...account,
        summary: { ...account.summary, '2026-08': { ...account.summary['2026-08'], total } },
      });

      expect(texts(totalCostCard())).toEqual(['Coût total du mois', '1 250,40€', notComputable]);
      expect(within(totalCostCard()).getByTitle(whyNotComputable))
        .toHaveTextContent(notComputable);

      await selectLanguage(user, 'en');

      expect(within(cardOf('Total monthly cost'))
        .getByTitle('cannot be computed: previous month at €0 or below'))
        .toHaveTextContent('— vs previous month');
    });

    it('shows none from a month before without a bill, and says why', async () => {
      // Nothing billed in August: the months list skips it
      await renderDashboard({
        ...account,
        months: account.months.filter(({ value }) => value !== '2026-08'),
        summary: { '2026-09': account.summary['2026-09'], '2026-07': account.summary['2026-07'] },
      });

      expect(texts(totalCostCard())).toEqual(['Coût total du mois', '1 250,40€', notComputable]);
      expect(within(totalCostCard()).getByTitle(whyNotComputable))
        .toHaveTextContent(notComputable);
    });

    it('shows no previous data for the first billed month', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Juillet 2026');

      expect(texts(totalCostCard()))
        .toEqual(['Coût total du mois', '980,00€', 'Pas de données précédentes']);
    });

    it('shows an increase in red (#87)', async () => {
      await renderDashboard();

      expect(toneOf(within(totalCostCard()).getByText('+20,0 % vs mois précédent')))
        .toBe('increase');
    });

    it('shows a decrease with its minus, in green (#87)', async () => {
      await renderDashboard({
        ...account,
        summary: { ...account.summary, '2026-08': { ...account.summary['2026-08'], total: 1300 } },
      });

      // (1 250.40 - 1 300) / 1 300
      expect(texts(totalCostCard()))
        .toEqual(['Coût total du mois', '1 250,40€', '-3,8 % vs mois précédent']);
      expect(toneOf(within(totalCostCard()).getByText('-3,8 % vs mois précédent')))
        .toBe('decrease');
    });

    // "+0,0 %" in red read as an increase that does not show (#87)
    it.each([
      ['an increase', 1250],
      ['a decrease', 1250.8],
    ])('shows %s that rounds to 0 unsigned and neutral (#87)', async (_, augustTotal) => {
      const { user } = await renderDashboard({
        ...account,
        summary: {
          ...account.summary,
          '2026-08': { ...account.summary['2026-08'], total: augustTotal },
        },
      });

      // (1 250.40 - 1 250) / 1 250 is 0.03 %, (1 250.40 - 1 250.80) / 1 250.80 -0.03 %
      expect(texts(totalCostCard()))
        .toEqual(['Coût total du mois', '1 250,40€', '0,0 % vs mois précédent']);
      expect(toneOf(within(totalCostCard()).getByText('0,0 % vs mois précédent')))
        .toBe('neutral');

      await selectLanguage(user, 'en');

      const card = cardOf('Total monthly cost');
      expect(texts(card)).toEqual(['Total monthly cost', '1,250.40€', '0.0% vs previous month']);
      expect(toneOf(within(card).getByText('0.0% vs previous month'))).toBe('neutral');
    });
  });

  describe('tab bar', () => {
    it.each([
      ['Comparaison', 'Comparaison par service'],
      ['Tendances', 'Évolution par catégorie'],
      ['Public Cloud', 'Kubernetes'],
      ['Web Cloud', '12 mois glissants'],
      ['Infrastructure', 'Load Balancers'],
      ['Backup', 'Coût total backup'],
    ])('opens the %s tab in place of the Overview', async (tab, content) => {
      const { user } = await renderDashboard();
      expect(screen.getByText('Répartition par service')).toBeInTheDocument();

      await openTab(user, tab);

      expect(screen.getByText(content)).toBeInTheDocument();
      expect(screen.queryByText('Répartition par service')).not.toBeInTheDocument();
    });

    it('goes back to the Overview from the logo', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');

      await user.click(screen.getByRole('button', { name: 'OVH Cost Manager' }));
      await settle();

      expect(screen.getByText('Répartition par service')).toBeInTheDocument();
      expect(screen.queryByText('12 mois glissants')).not.toBeInTheDocument();
    });

    it('leaves the month selector and the export out of the Compare tab', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      expect(screen.queryByText('Export:')).not.toBeInTheDocument();
      // What is left: the language, then the months A and B of the comparison
      const dropdowns = screen.getAllByRole('combobox');
      expect(dropdowns).toHaveLength(3);
      expect(dropdowns[0]).toHaveDisplayValue('FR');
      expect(dropdowns[1]).toHaveDisplayValue('Août 2026');
      expect(dropdowns[2]).toHaveDisplayValue('Septembre 2026');
    });
  });

  describe('sync warning banner', () => {
    // The account, last imported at a SQLite timestamp
    const lastImportedAt = (timestamp) => {
      const latest = {
        ...account.importStatus.latest,
        started_at: timestamp,
        completed_at: timestamp,
      };
      return { ...account, importStatus: { latest, running: false, history: [latest] } };
    };

    it('warns when the last import is more than 30 days old, until dismissed', async () => {
      const { user } = await renderDashboard(lastImportedAt('2026-08-15 08:00:00'));

      expect(screen.getByText(/^Dernière synchronisation il y a/)).toHaveTextContent(
        'Dernière synchronisation il y a 31 jours. Exécutez npm run import:diff pour mettre à jour.',
      );

      await user.click(screen.getByRole('button', { name: 'Fermer' }));

      expect(screen.queryByText(/^Dernière synchronisation il y a/)).not.toBeInTheDocument();
    });

    it('does not warn when the last import is 30 days old', async () => {
      await renderDashboard(lastImportedAt('2026-08-16 08:00:00'));

      expect(screen.queryByText(/^Dernière synchronisation il y a/)).not.toBeInTheDocument();
    });

    // A single-account installation, whose accounts route lists its account: the banner reads
    // the latest run, as ever, rather than when the account's last import succeeded (#124)
    it.each([
      ['warns of a run 31 days old', '2026-08-15 08:00:00', '2026-09-14 04:02:30',
        'Dernière synchronisation il y a 31 jours.'
          + ' Exécutez npm run import:diff pour mettre à jour.'],
      ['does not warn of a recent run', '2026-09-14 04:02:30', '2026-07-01 04:00:00', null],
    ])('reads the latest run with a single account: %s', async (_, run, lastSuccessAt, shown) => {
      await renderDashboard({
        ...lastImportedAt(run), accounts: [{ ...lyonAccount, lastSuccessAt }],
      });

      const warning = screen.queryByText(/^Dernière synchronisation il y a/);
      if (shown === null) expect(warning).not.toBeInTheDocument();
      else expect(warning).toHaveTextContent(shown);
    });

    // An instance of several accounts (#124): the banner names each configured account whose
    // last import that succeeded ended more than 30 days ago, or which none has, whatever the
    // latest run, which a run that some accounts failed keeps recent. An account removed from
    // config.json is no longer imported, and no import reads the Unknown account.
    describe('with several accounts', () => {
      // The banner, whatever it says: of accounts, or of the latest run
      const warning = () => screen.queryByText(new RegExp('^(Sans synchronisation réussie'
        + '|No successful synchronization|Dernière synchronisation il y a|Last synchronization)'));
      // Yesterday's run, which yy2222-ovh failed, as every run since 1 August, and Nantes, as
      // every run since it was configured
      const failedAt = (at) => ({ at, status: 'failed', error: 'Invalid key' });
      const partialRun = {
        ...account.importStatus.latest, status: 'partial', error_message: '2 of 3 accounts failed',
      };
      const staleAccounts = {
        ...severalAccounts,
        importStatus: { latest: partialRun, running: false, history: [partialRun] },
        accounts: [
          lyonAccount,
          {
            ...unnamedAccount,
            lastImport: failedAt('2026-09-14 04:02:10'), lastSuccessAt: '2026-08-01 04:00:00',
          },
          {
            ...lyonAccount, id: 'vv5555-ovh', nic: 'vv5555-ovh', name: 'Nantes',
            lastImport: failedAt('2026-09-14 04:02:20'), lastSuccessAt: null,
          },
          { ...removedAccount, lastSuccessAt: '2026-06-30 04:00:00' },
          unknownAccount,
        ],
      };

      it('names each configured account not synchronised for 30 days, until dismissed',
        async () => {
          const { user } = await renderDashboard(staleAccounts);

          expect(warning()).toHaveTextContent(
            'Sans synchronisation réussie depuis plus de 30 jours : yy2222-ovh (45 jours),'
              + ' Nantes (jamais). Exécutez npm run import:diff pour mettre à jour.',
          );

          await user.click(screen.getByRole('button', { name: 'Fermer' }));

          expect(warning()).not.toBeInTheDocument();
        });

      // More than 30 days, as with a single account, whatever the latest run
      it.each([
        ['30 days ago', '2026-08-16 08:00:00', null],
        ['31 days ago', '2026-08-15 08:00:00', 'Lyon subsidiary (31 jours)'],
      ])('warns of an account synchronised %s only if it is older', async (_, at, named) => {
        const run = { ...account.importStatus.latest, completed_at: '2026-08-01 04:00:00' };
        await renderDashboard({
          ...severalAccounts,
          importStatus: { latest: run, running: false, history: [run] },
          accounts: [{ ...lyonAccount, lastSuccessAt: at }, unnamedAccount, removedAccount],
        });

        if (named === null) expect(warning()).not.toBeInTheDocument();
        else expect(warning()).toHaveTextContent(`30 jours : ${named}.`);
      });

      it('says so in the language of the page', async () => {
        // The language the page remembers from an earlier visit
        localStorage.setItem('ovh-dashboard-language', 'en');

        await renderDashboard(staleAccounts);

        expect(warning()).toHaveTextContent(
          'No successful synchronization for more than 30 days: yy2222-ovh (45 days),'
            + ' Nantes (never). Run npm run import:diff to update.',
        );
      });
    });
  });

  describe('footer', () => {
    const importHistory = () => within(disclosure('Historique des imports')).getByRole('table');

    it('shows the last import, and the import history on demand', async () => {
      const { user } = await renderDashboard();

      expect(screen.getByText("Données synchronisées via l'API OVHcloud")).toBeInTheDocument();
      // SQLite timestamps are UTC: they read in local time, Paris here
      expect(screen.getByText('Dernière sync: 14/09/2026 06:02:30 (3 factures)'))
        .toBeInTheDocument();
      expect(importHistory()).not.toBeVisible();

      await user.click(screen.getByText('Historique des imports'));

      expect(importHistory()).toBeVisible();
      expect(rowsOf(importHistory())).toEqual([
        ['Date', 'Type', 'Statut', 'Factures'],
        ['14/09/2026 06:02:30', 'différentiel', 'réussi', '3'],
        ['13/09/2026 06:00:12', 'différentiel', 'échoué', '0'],
        ['01/07/2026 10:05:00', 'complet', 'réussi', '7'],
      ]);
    });

    it('shows an import in progress', async () => {
      const running = {
        ...account.importStatus.latest,
        id: 5,
        started_at: '2026-09-15 09:55:00',
        completed_at: null,
        type: 'period',
        bills_imported: 0,
        status: 'running',
      };
      const partial = {
        ...account.importStatus.latest,
        id: 4,
        started_at: '2026-09-15 08:00:00',
        completed_at: '2026-09-15 08:20:00',
        type: 'full',
        bills_imported: 5,
        status: 'partial',
      };
      const { user } = await renderDashboard({
        ...account,
        importStatus: { latest: running, running: true, history: [running, partial] },
      });

      expect(screen.getByText('Dernière sync: en cours')).toBeInTheDocument();

      await user.click(screen.getByText('Historique des imports'));

      expect(rowsOf(importHistory())).toEqual([
        ['Date', 'Type', 'Statut', 'Factures'],
        // Not over yet: the date is the start
        ['15/09/2026 11:55:00', 'période', 'en cours', '0'],
        ['15/09/2026 10:20:00', 'complet', 'partiel', '5'],
      ]);
    });

    // A run over several accounts that some of them failed (#113): a warning, not an error
    it.each([
      ['fr', 'Historique des imports',
        [['partiel', 'warning'], ['échoué', 'error'], ['réussi', 'success']]],
      ['en', 'Import history',
        [['partial', 'warning'], ['failed', 'error'], ['success', 'success']]],
    ])('shows a partial import as a warning (%s)', async (language, summary, statuses) => {
      // The language the page remembers from an earlier visit
      localStorage.setItem('ovh-dashboard-language', language);
      const partial = {
        ...account.importStatus.latest,
        id: 4,
        started_at: '2026-09-15 04:00:00',
        completed_at: '2026-09-15 04:03:00',
        status: 'partial',
        error_message: '1 of 2 accounts failed: accounts[1]: This credential is not valid',
      };
      const { user } = await renderDashboard({
        ...account,
        importStatus: {
          latest: partial,
          running: false,
          history: [partial, ...account.importStatus.history.slice(1)],
        },
      });

      await user.click(screen.getByText(summary));

      expect(importStatusesOf(within(disclosure(summary)).getByRole('table')))
        .toEqual(statuses);
    });

    // The error of a run names the accounts that failed, and says when a full import cleared
    // nothing (#113)
    it('tells why an import failed or ended partial, over its status', async () => {
      const reason = '1 of 2 accounts failed: accounts[1]: This credential is not valid';
      const partial = {
        ...account.importStatus.latest, id: 4, status: 'partial', error_message: reason,
      };
      const { user } = await renderDashboard({
        ...account,
        importStatus: {
          latest: partial,
          running: false,
          history: [partial, ...account.importStatus.history.slice(1)],
        },
      });

      await user.click(screen.getByText('Historique des imports'));

      expect(within(importHistory()).getByTitle(reason)).toHaveTextContent('partiel');
      expect(within(importHistory()).getByTitle('OVH API unreachable'))
        .toHaveTextContent('échoué');
    });

    it('says when nothing was ever imported', async () => {
      const { user } = await renderDashboard({ ...account, importStatus: undefined });

      expect(screen.queryByText(/^Dernière sync/)).not.toBeInTheDocument();

      await user.click(screen.getByText('Historique des imports'));

      expect(screen.getByText('Aucun import enregistré')).toBeVisible();
    });

    // A single-account installation, whose accounts route lists its account, or none until
    // the first import since the upgrade: the page offers no account to select, and the
    // footer says when the latest import ended, as ever (#124)
    it.each([
      ['a single account', [lyonAccount]],
      ['no account, as before the first import since the upgrade', []],
    ])('shows the latest import alone with %s', async (_, accounts) => {
      await renderDashboard({ ...severalAccounts, accounts });

      expect(lastSyncLines()).toEqual(['Dernière sync: 14/09/2026 06:02:30 (3 factures)']);
    });

    // An instance of several accounts (#124): the footer says when each account was last
    // synchronised, as the accounts route gives it, so that the user can tell whose data is
    // stale: when its last import that succeeded ended. See fixtures/accounts.js.
    describe('with several accounts', () => {
      // An account as the route lists it, with how its last import ended, and when its last
      // import that succeeded did
      const accountOf = (nic, name, lastImport, lastSuccessAt) => ({
        ...lyonAccount, id: nic, nic, name, lastImport, lastSuccessAt,
      });
      // An account whose last import failed, since one that succeeded on the 10th, and one
      // whose imports all failed. The route lists the accounts by NIC handle.
      const reason = 'This credential is not valid';
      const failedAccount = accountOf('ww4444-ovh', 'Marseille',
        { at: '2026-09-14 04:02:40', status: 'failed', error: reason }, '2026-09-10 04:01:00');
      const neverSynced = accountOf('vv5555-ovh', 'Nantes',
        { at: '2026-09-14 04:02:50', status: 'failed', error: 'Invalid key' }, null);
      const withFailedAccounts = {
        ...severalAccounts,
        accounts: [neverSynced, failedAccount, ...severalAccounts.accounts],
      };
      // A run of the import in progress, which started this morning
      const running = {
        ...account.importStatus.latest,
        id: 4,
        started_at: '2026-09-15 04:00:00',
        completed_at: null,
        bills_imported: 0,
        status: 'running',
      };
      const whileRunning = (data) => ({
        ...data,
        importStatus: { latest: running, running: true, history: [running] },
      });

      // Each account as the account selector names it, in the order of the route, and when
      // its last import that succeeded ended, in local time. The Unknown account has none: no
      // import reads it. The account selected makes no difference.
      it('says when each account was last synchronised, whatever the account shown',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          const lines = [
            'Lyon subsidiary — Dernière sync: 14/09/2026 06:02:30',
            'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10',
            'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
          ];
          expect(lastSyncLines()).toEqual(lines);

          await selectAccount(user, 'Lyon subsidiary');

          expect(lastSyncLines()).toEqual(lines);
        });

      // Its data is as its last import that succeeded left it, never for one whose imports
      // all failed. When its last import failed, in red, with why over it, as the import
      // history says it of a run (#113).
      it("says when an account's last import failed, since the last that succeeded, and why",
        async () => {
          await renderDashboard(withFailedAccounts);

          expect(lastSyncLines()).toEqual([
            'Nantes — Dernière sync: jamais (dernier import échoué le 14/09/2026 06:02:50)',
            'Marseille — Dernière sync: 10/09/2026 06:01:00'
              + ' (dernier import échoué le 14/09/2026 06:02:40)',
            'Lyon subsidiary — Dernière sync: 14/09/2026 06:02:30',
            'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10',
            'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
          ]);
          const failed = within(footer()).getByTitle(reason);
          expect(failed).toHaveTextContent('dernier import échoué le 14/09/2026 06:02:40');
          expect(importToneOf(failed)).toBe('error');
        });

      // An account added to config.json, which the run records before it imports any account
      it('says never for an account whose first import has not ended yet', async () => {
        const [lyon, unnamed, removed, unknown] = severalAccounts.accounts;
        const added = accountOf('uu6666-ovh', 'Bordeaux', null, null);

        await renderDashboard(whileRunning({
          ...severalAccounts, accounts: [lyon, unnamed, added, removed, unknown],
        }));

        expect(lastSyncLines()).toEqual([
          'Dernière sync: en cours',
          'Lyon subsidiary — Dernière sync: 14/09/2026 06:02:30',
          'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10',
          'Bordeaux — Dernière sync: jamais',
          'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
        ]);
      });

      // As with a single account: the cue that the page asks every 30 s whether it is over
      // (#51)
      it('says that an import runs, besides when each account was last synchronised',
        async () => {
          await renderDashboard(whileRunning(severalAccounts));

          expect(lastSyncLines()).toEqual([
            'Dernière sync: en cours',
            'Lyon subsidiary — Dernière sync: 14/09/2026 06:02:30',
            'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10',
            'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
          ]);
        });

      // As during the first run of several accounts, which records them all before it imports
      // any: the footer shows the latest import's line alone, as with a single account
      it("shows the latest import alone until an account's import has ended", async () => {
        const recorded = severalAccounts.accounts.map((recordedAccount) => ({
          ...recordedAccount, lastImport: null, lastSuccessAt: null,
        }));

        await renderDashboard(whileRunning({ ...severalAccounts, accounts: recorded }));

        expect(lastSyncLines()).toEqual(['Dernière sync: en cours']);
      });

      it('says so in the language of the page', async () => {
        // The language the page remembers from an earlier visit
        localStorage.setItem('ovh-dashboard-language', 'en');

        await renderDashboard(withFailedAccounts);

        expect(lastSyncLines()).toEqual([
          'Nantes — Last sync: never (last import failed on 9/14/2026, 6:02:50 AM)',
          'Marseille — Last sync: 9/10/2026, 6:01:00 AM'
            + ' (last import failed on 9/14/2026, 6:02:40 AM)',
          'Lyon subsidiary — Last sync: 9/14/2026, 6:02:30 AM',
          'yy2222-ovh — Last sync: 9/14/2026, 6:02:10 AM',
          'zz3333-ovh (not configured) — Last sync: 8/31/2026, 6:01:00 AM',
        ]);
      });
    });
  });

  describe('resync', () => {
    it('starts an import and says so under its button', async () => {
      const { user } = await renderDashboard();
      let started;
      api.triggerImport.mockImplementation(() => new Promise((resolve) => {
        started = resolve;
      }));

      await user.click(screen.getByRole('button', { name: /Synchroniser/ }));

      expect(await screen.findByRole('button', { name: /Synchronisation\.\.\./ })).toBeDisabled();

      started({ started: true });
      await settle();

      expect(screen.getByRole('button', { name: /Synchroniser/ })).toBeEnabled();
      // Under the button, as on the page shown when no month was billed, rather than in the
      // footer: one component for both (#51)
      expect(texts(resync())).toEqual([
        '⟳', 'Synchroniser',
        'Synchronisation lancée. Les données se mettront à jour dans quelques instants.',
      ]);
    });

    // As axios rejects: the answer of the server under "response"
    const refusal = (status, data) => Object.assign(
      new Error(`Request failed with status code ${status}`),
      { response: { status, data } },
    );

    it.each([
      ['more than once an hour', refusal(429, { error: 'Too many requests' }),
        'Synchronisation limitée à une fois par heure. Réessayez plus tard.'],
      // Its config said it ran them when the page loaded: the button shows (#51)
      ['by a server that no longer runs imports', refusal(409, { error: 'syncDisabled' }),
        'La synchronisation est désactivée sur ce serveur (IMPORT_ENABLED=false).'],
      ['while an import runs', refusal(409, { error: 'syncRunning' }),
        'Une synchronisation est déjà en cours.'],
      ['on a server error', refusal(500, { error: 'SQLITE_BUSY' }),
        'Échec du déclenchement de la synchronisation.'],
    ])('explains a resync refused %s', async (_, error, message) => {
      const { user } = await renderDashboard();
      api.triggerImport.mockRejectedValue(error);

      await user.click(screen.getByRole('button', { name: /Synchroniser/ }));
      await settle();

      // Under the button too (#51)
      expect(texts(resync())).toEqual(['⟳', 'Synchroniser', message]);
    });

    // Rather than a button that could only answer that imports are disabled (#51)
    it('does not show when the server runs no imports', async () => {
      await renderDashboard({ ...account, config: { ...account.config, importEnabled: false } });

      expect(screen.queryByRole('button', { name: /Synchroniser/ })).not.toBeInTheDocument();
      // The rest of the header shows as ever
      expect(screen.getByText('Tableau de bord de suivi des coûts OVHcloud')).toBeInTheDocument();
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
    });
  });

  // The page learns that an import is over from the import status, which it
  // asks again 8 s after a resync, then every 30 s while an import runs. It
  // then reloads what is built from imported data. Timers are faked here only.
  describe('end of an import', () => {
    const running = {
      ...account.importStatus.latest,
      id: 4,
      started_at: '2026-09-15 10:00:00',
      completed_at: null,
      bills_imported: 0,
      details_imported: 0,
      projects_imported: 0,
      status: 'running',
    };
    const finished = {
      ...running,
      completed_at: '2026-09-15 10:00:31',
      bills_imported: 4,
      details_imported: 47,
      projects_imported: 2,
      status: 'success',
    };
    const importStatus = (latest) => ({
      latest,
      running: latest.status === 'running',
      history: [latest, ...account.importStatus.history],
    });
    const signedIn = {
      ...account,
      user: { id: 'jdoe', name: 'Jane Doe', email: 'jane.doe@example.com', authEnabled: false },
    };
    // What the server says once the import is over: a late bill line raised
    // the cost of September. The user and the budget changed meanwhile, but
    // they are not imported data: the page keeps them.
    const afterImport = {
      ...signedIn,
      importStatus: importStatus(finished),
      summary: {
        ...account.summary,
        '2026-09': { ...account.summary['2026-09'], total: 1300.4 },
      },
      user: { ...signedIn.user, name: 'Jane Smith' },
      config: { budget: 800, currency: 'EUR' },
    };
    const lastSync = (text) => screen.getByText(`Dernière sync: ${text}`);
    const monthCost = () => texts(cardOf('Coût total du mois'))[1];

    it('shows the import a resync starts 8 s later, and its figures once over', async () => {
      fakeTimers();
      const { user } = await renderDashboard(signedIn);
      serve({ ...signedIn, importStatus: importStatus(running) });

      await user.click(screen.getByRole('button', { name: /Synchroniser/ }));
      await settle();
      await passTime(7000);

      expect(lastSync('14/09/2026 06:02:30 (3 factures)')).toBeInTheDocument();

      await passTime(1000);

      expect(lastSync('en cours')).toBeInTheDocument();

      serve(afterImport);
      await passTime(29000);

      expect(lastSync('en cours')).toBeInTheDocument();
      expect(monthCost()).toBe('1 250,40€');

      await passTime(1000);

      // SQLite timestamps are UTC: 10:00:31 reads 12:00:31 in Paris
      expect(lastSync('15/09/2026 12:00:31 (4 factures)')).toBeInTheDocument();
      expect(monthCost()).toBe('1 300,40€');
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      // Still the budget of 50 000: the forecast is not flagged as above it
      expect(texts(cardOf('Prévision fin de mois'))).toContain('14/30 jours');
    });

    it('shows the figures of an import running as the page opened, once over', async () => {
      fakeTimers();
      await renderDashboard({ ...signedIn, importStatus: importStatus(running) });

      expect(lastSync('en cours')).toBeInTheDocument();
      expect(monthCost()).toBe('1 250,40€');

      serve(afterImport);
      await passTime(30000);

      expect(lastSync('15/09/2026 12:00:31 (4 factures)')).toBeInTheDocument();
      expect(monthCost()).toBe('1 300,40€');
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(texts(cardOf('Prévision fin de mois'))).toContain('14/30 jours');
    });

    it('shows the figures of an import already over at the refresh after a resync', async () => {
      fakeTimers();
      const { user } = await renderDashboard(signedIn);
      // An import quick enough to be over before the status is asked again
      serve(afterImport);

      await user.click(screen.getByRole('button', { name: /Synchroniser/ }));
      await settle();

      expect(monthCost()).toBe('1 250,40€');

      await passTime(8000);

      expect(lastSync('15/09/2026 12:00:31 (4 factures)')).toBeInTheDocument();
      expect(monthCost()).toBe('1 300,40€');
    });

    it('shows the dashboard once the import a resync starts with no month billed is over (#51)',
      async () => {
        fakeTimers();
        const { user } = await renderDashboard({ ...signedIn, months: [] });
        serve({ ...signedIn, months: [], importStatus: importStatus(running) });

        await user.click(within(emptyState()).getByRole('button', { name: /Synchroniser/ }));
        await settle();
        await passTime(8000);

        // Still nothing billed while it runs
        expect(emptyState()).toBeInTheDocument();

        serve(afterImport);
        await passTime(30000);

        expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
        expect(monthCost()).toBe('1 300,40€');
        expect(lastSync('15/09/2026 12:00:31 (4 factures)')).toBeInTheDocument();
      });

    // With several accounts (#124), the accounts route says when each account's import ended
    // once the run is over. While it runs, the footer says so, and when each account's last
    // import ended.
    it("shows each account's last synchronisation once an import is over", async () => {
      fakeTimers();
      await renderDashboard({ ...severalAccounts, importStatus: importStatus(running) });

      expect(lastSyncLines()).toEqual([
        'Dernière sync: en cours',
        'Lyon subsidiary — Dernière sync: 14/09/2026 06:02:30',
        'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10',
        'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
      ]);

      // Lyon imported, and the other account configured failed: the run ended partial. The
      // account removed from config.json was not imported.
      serve({
        ...severalAccounts,
        importStatus: importStatus({
          ...finished, status: 'partial', error_message: '1 of 2 accounts failed',
        }),
        accounts: [
          {
            ...lyonAccount,
            lastImport: { at: '2026-09-15 10:00:20', status: 'success', error: null },
            lastSuccessAt: '2026-09-15 10:00:20',
          },
          {
            ...unnamedAccount,
            lastImport: { at: '2026-09-15 10:00:31', status: 'failed', error: 'Invalid key' },
          },
          removedAccount,
          unknownAccount,
        ],
      });
      await passTime(30000);

      expect(lastSyncLines()).toEqual([
        'Lyon subsidiary — Dernière sync: 15/09/2026 12:00:20',
        'yy2222-ovh — Dernière sync: 14/09/2026 06:02:10'
          + ' (dernier import échoué le 15/09/2026 12:00:31)',
        'zz3333-ovh (non configuré) — Dernière sync: 31/08/2026 06:01:00',
      ]);
    });

    it('shows the dashboard once the first import ever is over, even before the refresh (#51)',
      async () => {
        fakeTimers();
        // Nothing ever imported: no bill, and no import in the history
        const neverImported = { ...signedIn, months: [], importStatus: undefined };
        const { user } = await renderDashboard(neverImported);
        // An import quick enough to be over before the status is asked again: the first one
        serve({
          ...afterImport,
          importStatus: { latest: finished, running: false, history: [finished] },
        });

        await user.click(within(emptyState()).getByRole('button', { name: /Synchroniser/ }));
        await settle();
        await passTime(8000);

        expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
        expect(monthCost()).toBe('1 300,40€');
        expect(lastSync('15/09/2026 12:00:31 (4 factures)')).toBeInTheDocument();
      });
  });

  describe('report export', () => {
    // The report of September, as the page downloads it. All in French: the title, the
    // period, the totals and the percentages (#60), with a space before the colon.
    const septemberReport = [
      '# Rapport de coûts OVH - Septembre 2026',
      '',
      '**Période :** du 2026-09-01 au 2026-09-30',
      '',
      '## Résumé',
      '',
      '| Métrique | Valeur |',
      '|--------|-------|',
      // French amounts separate thousands with a narrow no-break space
      '| Coût Total | 1\u202f250,40€ |',
      '| Total Cloud | 830,40€ |',
      '| Total hors Cloud | 420,00€ |',
      '| Moyenne Journalière | 41,68€ |',
      '| Projets Actifs | 2 |',
      '',
      '## Par Type de Service',
      '',
      '| Service | Coût | % |',
      '|---------|------|---|',
      // and French percentages their sign with a no-break space
      '| Compute | 800,40€ | 64,0\u00a0% |',
      '| Storage | 250,00€ | 20,0\u00a0% |',
      '| Other | 200,00€ | 16,0\u00a0% |',
      '',
      '## Top Projets',
      '',
      '| Projet | Coût |',
      '|---------|------|',
      '| Production | 610,40€ |',
      '| Staging | 220,00€ |',
      '',
      '---',
      '*Généré le 15/09/2026 12:00:00*',
      '',
    ];

    it('downloads the report of the month as Markdown', async () => {
      const { user } = await renderDashboard();
      const downloadedFiles = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'Markdown');

      const files = await downloadedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('ovh-report-2026-09.md');
      expect(files[0].type).toBe('text/markdown');
      expect(files[0].content).toBe(septemberReport.join('\n'));
      // Ready for another export
      expect(screen.getByDisplayValue('Choisir...')).toBeInTheDocument();
    });

    // A single-account installation, whose accounts route lists its account, or none until
    // the first import since the upgrade: the page offers no account to select, and the
    // report names none, in its title nor in its file's name (#124)
    it.each([
      ['a single account', [lyonAccount]],
      ['no account, as before the first import since the upgrade', []],
    ])('names no account with %s', async (_, accounts) => {
      const { user } = await renderDashboard({ ...severalAccounts, accounts });
      const downloadedFiles = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'Markdown');

      expect(await downloadedFiles()).toEqual([{
        name: 'ovh-report-2026-09.md', type: 'text/markdown', content: septemberReport.join('\n'),
      }]);
    });

    it('writes the report in the language of the page', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'en');
      const downloadedFiles = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choose...'), 'Markdown');

      const [{ content: report }] = await downloadedFiles();
      // The month in English too (#33)
      expect(report).toContain('# OVH Cost Report - September 2026');
      expect(report).toContain('**Period:** 2026-09-01 to 2026-09-30');
      expect(report).toContain('| Total Cost | 1,250.40€ |');
      expect(report).toContain('## By Service Type');
      expect(report).toContain('## Top Projects');
    });

    // An instance of several accounts (#124): the report covers what the page shows, all
    // accounts by default or the account selected in the header, and its title says which,
    // after the month, as the account selector names it. See fixtures/accounts.js.
    describe('with several accounts', () => {
      // Exports the report as Markdown, in the language of the page: the file downloaded
      const exportReport = async (user) => {
        const downloadedFiles = captureFileDownloads();
        await user.selectOptions(screen.getByDisplayValue(/^(Choisir|Choose)\.\.\.$/), 'Markdown');
        const [file] = await downloadedFiles();
        return file;
      };
      // The report of September for all accounts: the figures of the single-account report,
      // which the accounts add up to
      const allAccountsReport = {
        name: 'ovh-report-2026-09.md',
        type: 'text/markdown',
        content: [
          '# Rapport de coûts OVH - Septembre 2026 - Tous les comptes',
          ...septemberReport.slice(1),
        ].join('\n'),
      };

      it('covers all accounts by default, as its title says', async () => {
        const { user } = await renderDashboard(severalAccounts);

        expect(await exportReport(user)).toEqual(allAccountsReport);
      });

      // Its summary, its service types and its projects alike, as the Overview shows them
      // (#118): no figure of another account
      it('covers the account selected, which its title and the name of its file give',
        async () => {
          const { user } = await renderDashboard(severalAccounts);

          await selectAccount(user, 'Lyon subsidiary');

          expect(await exportReport(user)).toEqual({
            // By its NIC handle, which any file system takes
            name: 'ovh-report-2026-09-xx1111-ovh.md',
            type: 'text/markdown',
            content: [
              '# Rapport de coûts OVH - Septembre 2026 - Lyon subsidiary',
              '',
              '**Période :** du 2026-09-01 au 2026-09-30',
              '',
              '## Résumé',
              '',
              '| Métrique | Valeur |',
              '|--------|-------|',
              '| Coût Total | 890,40€ |',
              '| Total Cloud | 610,40€ |',
              '| Total hors Cloud | 280,00€ |',
              '| Moyenne Journalière | 29,68€ |',
              '| Projets Actifs | 1 |',
              '',
              '## Par Type de Service',
              '',
              '| Service | Coût | % |',
              '|---------|------|---|',
              '| Compute | 580,40€ | 65,2 % |',
              '| Other | 160,00€ | 18,0 % |',
              '| Storage | 150,00€ | 16,8 % |',
              '',
              '## Top Projets',
              '',
              '| Projet | Coût |',
              '|---------|------|',
              '| Production | 610,40€ |',
              '',
              '---',
              '*Généré le 15/09/2026 12:00:00*',
              '',
            ].join('\n'),
          });

          await selectAccount(user, 'Tous les comptes');

          expect(await exportReport(user)).toEqual(allAccountsReport);
        });

      // On the latest month of an account not billed in September, which the page moves to
      it.each([
        ['fr', 'Compte inconnu', '# Rapport de coûts OVH - Juillet 2026 - Compte inconnu',
          'ovh-report-2026-07-unknown.md'],
        ['fr', 'zz3333-ovh (non configuré)',
          '# Rapport de coûts OVH - Août 2026 - zz3333-ovh (non configuré)',
          'ovh-report-2026-08-zz3333-ovh.md'],
        ['en', 'All accounts', '# OVH Cost Report - September 2026 - All accounts',
          'ovh-report-2026-09.md'],
        ['en', 'Unknown account', '# OVH Cost Report - July 2026 - Unknown account',
          'ovh-report-2026-07-unknown.md'],
        ['en', 'zz3333-ovh (not configured)',
          '# OVH Cost Report - August 2026 - zz3333-ovh (not configured)',
          'ovh-report-2026-08-zz3333-ovh.md'],
      ])('names the accounts as the account selector does (%s): %s',
        async (language, label, title, name) => {
          // The language the page remembers from an earlier visit
          localStorage.setItem('ovh-dashboard-language', language);
          const { user } = await renderDashboard(severalAccounts);

          await selectAccount(user, label);

          const report = await exportReport(user);
          expect(report.content.split('\n')[0]).toBe(title);
          expect(report.name).toBe(name);
        });
    });

    describe('as PDF', () => {
      // The title of the page, which the browser gives the PDF: index.html's, which jsdom's
      // document lacks
      const PAGE_TITLE = 'OVH Cost Manager';
      beforeEach(() => {
        document.title = PAGE_TITLE;
      });
      afterEach(() => {
        document.title = '';
      });
      // The browser prints as it does from window.print() or from its own print command: it
      // tells the page before and after, and prints the page, whose title it gives the PDF
      const printPage = (titles) => {
        window.dispatchEvent(new Event('beforeprint'));
        titles.push(document.title);
        window.dispatchEvent(new Event('afterprint'));
      };
      // The title of the page each time the export printed it
      const printedTitles = () => {
        const titles = [];
        vi.spyOn(window, 'print').mockImplementation(() => printPage(titles));
        return titles;
      };

      it('prints the page for the PDF export', async () => {
        const { user } = await renderDashboard();
        const print = vi.spyOn(window, 'print');

        await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'PDF');

        expect(print).toHaveBeenCalledOnce();
      });

      // Nor does the PDF of a single-account installation name any account (#124)
      it.each([
        ['a single account', [lyonAccount]],
        ['no account, as before the first import since the upgrade', []],
      ])('prints the page under its own title with %s', async (_, accounts) => {
        const { user } = await renderDashboard({ ...severalAccounts, accounts });
        const titles = printedTitles();

        await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'PDF');

        expect(titles).toEqual([PAGE_TITLE]);
        expect(document.title).toBe(PAGE_TITLE);
      });

      // With several accounts, the page's title names what it shows while it prints, after
      // its own, as the Markdown report's title does (#124), and is its own again once printed
      it('prints the page under a title that names the accounts it shows', async () => {
        const { user } = await renderDashboard(severalAccounts);
        const titles = printedTitles();
        const exportPdf = () =>
          user.selectOptions(screen.getByDisplayValue(/^(Choisir|Choose)\.\.\.$/), 'PDF');

        await exportPdf();
        await selectAccount(user, 'Lyon subsidiary');
        await exportPdf();
        await selectLanguage(user, 'en');
        await selectAccount(user, 'Unknown account');
        await exportPdf();

        expect(titles).toEqual([
          'OVH Cost Manager - Tous les comptes',
          'OVH Cost Manager - Lyon subsidiary',
          'OVH Cost Manager - Unknown account',
        ]);
        expect(document.title).toBe(PAGE_TITLE);
      });

      // As the user may print the page with the browser's own command, rather than with the
      // export: the title names the accounts shown while the browser prints, once, and is the
      // page's own again once it has printed
      it("names the accounts shown while the browser's own print command prints the page",
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await selectAccount(user, 'Lyon subsidiary');
          const titles = [];

          printPage(titles);
          window.dispatchEvent(new Event('beforeprint'));
          window.dispatchEvent(new Event('beforeprint'));
          titles.push(document.title);
          window.dispatchEvent(new Event('afterprint'));

          expect(titles).toEqual([
            'OVH Cost Manager - Lyon subsidiary', 'OVH Cost Manager - Lyon subsidiary',
          ]);
          expect(document.title).toBe(PAGE_TITLE);
        });

      // Nor does the page of a single-account installation name any account then
      it('prints under its own title with a single account, from any print command',
        async () => {
          await renderDashboard({ ...severalAccounts, accounts: [lyonAccount] });
          const titles = [];

          printPage(titles);

          expect(titles).toEqual([PAGE_TITLE]);
        });
    });
  });

  describe('header', () => {
    it('shows the signed-in user and how many services expire soon', async () => {
      const { user } = await renderDashboard({
        ...account,
        user: { id: 'jdoe', name: 'Jane Doe', email: 'jane.doe@example.com', authEnabled: true },
        expiringServices: [
          {
            id: 'ns3000001.ip-203-0-113.eu',
            display_name: 'backup-server',
            type: 'dedicated_server',
            expiration_date: '2026-09-20',
          },
          {
            id: 'vps-0a1b2c3d.vps.ovh.net',
            display_name: null,
            type: 'vps',
            expiration_date: '2026-10-10',
          },
        ],
      });

      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      const logout = screen.getByRole('link', { name: '✕' });
      expect(logout).toHaveAttribute('href', '/auth/logout');
      // The tooltip of the logout link, in the language of the page (#34)
      expect(logout).toHaveAttribute('title', 'Se déconnecter');
      expect(texts(headerBadge('Expirations proches'))).toEqual(['2', 'Expirations proches']);

      await selectLanguage(user, 'en');

      expect(screen.getByRole('link', { name: '✕' })).toHaveAttribute('title', 'Log out');
    });
  });

  describe('language', () => {
    it('switches the labels and the amounts to English, and back to French', async () => {
      const { user } = await renderDashboard();

      await selectLanguage(user, 'en');

      expect(screen.getByText('OVHcloud cost tracking dashboard')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resync/ })).toBeInTheDocument();
      // The latest month, compared with August, the month before (#50)
      expect(texts(cardOf('Total monthly cost')))
        .toEqual(['Total monthly cost', '1,250.40€', '+20.0% vs previous month']);
      expect(texts(cloudTotalCard('Cloud Total', 'Total monthly cost')))
        .toEqual(['Cloud Total', '830.40€', 'Public Cloud']);
      expect(texts(cardOf('Daily average cost')))
        .toEqual(['Daily average cost', '41.68€', 'Over 30 days']);
      expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Trends' })).toBeInTheDocument();
      expect(screen.getByText('Data synchronized via OVHcloud API')).toBeInTheDocument();
      expect(screen.getByText('Last sync: 9/14/2026, 6:02:30 AM (3 bills)')).toBeInTheDocument();
      // The months in the language of the page, not in the French of the API (#33)
      expect(optionsOf(dropdown('July 2026')))
        .toEqual(['September 2026', 'August 2026', 'July 2026']);
      expect(dropdown('July 2026')).toHaveDisplayValue('September 2026');
      expect(texts(cardOf('End of month forecast')))
        .toEqual(['End of month forecast', 'September 2026', '862.18€', '14/30 days']);

      await selectLanguage(user, 'fr');

      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 250,40€', '+20,0 % vs mois précédent']);
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '830,40€', 'Public Cloud']);
      expect(screen.getByRole('button', { name: "Vue d'ensemble" })).toBeInTheDocument();
      // The months back in French (#33)
      expect(optionsOf(monthSelector())).toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
    });
  });
});
