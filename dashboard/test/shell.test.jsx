import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api, holdBack, serve } from './support/api.js';
import { captureFileDownloads } from './support/downloads.js';
import {
  cardOf,
  disclosure,
  dropdown,
  emptyState,
  fakeTimers,
  headerBadge,
  openTab,
  optionsOf,
  passTime,
  renderDashboard,
  resync,
  rowsOf,
  selectLanguage,
  selectMonth,
  settle,
  texts,
} from './support/render.jsx';

// The month selector of the header offers every billed month
const monthSelector = () => dropdown('Juillet 2026');

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
        .toEqual(['Coût total du mois', '1 042,00€', '+6.3% vs mois précédent']);
      expect(texts(cardOf('Cloud Total'))).toEqual(['Cloud Total', '702,00€', 'Public Cloud']);
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
        .toEqual(['Coût total du mois', '1 250,40€', '+20.0% vs mois précédent']);
      expect(texts(cardOf('Cloud Total'))).toEqual(['Cloud Total', '830,40€', 'Public Cloud']);
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
      expect(texts(totalCostCard())).toContain('+20.0% vs mois précédent');
    });

    it('compares an older month with the month before it, not with the latest', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Août 2026');

      // (1 042 - 980) / 980
      expect(texts(totalCostCard())).toContain('+6.3% vs mois précédent');
    });

    it('ignores the months picked in the Compare tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      // Month B, September until then, becomes July
      await user.selectOptions(dropdown('Juillet 2026', 'Septembre 2026'), 'Juillet 2026');
      await settle();

      // Still from August, not from July
      expect(texts(totalCostCard())).toContain('+20.0% vs mois précédent');
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
        .toEqual(['Coût total du mois', '1 042,00€', '+6.3% vs mois précédent']);
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

    it('says when nothing was ever imported', async () => {
      const { user } = await renderDashboard({ ...account, importStatus: undefined });

      expect(screen.queryByText(/^Dernière sync/)).not.toBeInTheDocument();

      await user.click(screen.getByText('Historique des imports'));

      expect(screen.getByText('Aucun import enregistré')).toBeVisible();
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
      ['with imports disabled on the server', refusal(409, { error: 'syncDisabled' }),
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
    it('downloads the report of the month as Markdown', async () => {
      const { user } = await renderDashboard();
      const downloadedFiles = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'Markdown');

      const files = await downloadedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('ovh-report-2026-09.md');
      expect(files[0].type).toBe('text/markdown');
      // All in French: the title, the period, the totals and the percentages (#60), with a
      // space before the colon
      expect(files[0].content).toBe([
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
      ].join('\n'));
      // Ready for another export
      expect(screen.getByDisplayValue('Choisir...')).toBeInTheDocument();
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

    it('prints the page for the PDF export', async () => {
      const { user } = await renderDashboard();
      const print = vi.spyOn(window, 'print');

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'PDF');

      expect(print).toHaveBeenCalledOnce();
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
        .toEqual(['Coût total du mois', '1 250,40€', '+20.0% vs mois précédent']);
      expect(screen.getByRole('button', { name: "Vue d'ensemble" })).toBeInTheDocument();
      // The months back in French (#33)
      expect(optionsOf(monthSelector())).toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
    });
  });
});
