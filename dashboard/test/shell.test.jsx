import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api } from './support/api.js';
import { captureFileDownloads } from './support/downloads.js';
import {
  cardOf,
  monthSelector,
  openTab,
  renderDashboard,
  rowsOf,
  selectLanguage,
  selectMonth,
  settle,
  texts,
} from './support/render.jsx';

vi.mock('../src/services/api.js', async () => (await import('./support/api.js')).api);

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

    it('stays on the loading screen when no month was billed', async () => {
      await renderDashboard({ ...account, months: [] });

      expect(screen.getByText('Chargement des données...')).toBeInTheDocument();
    });

    it('lists the billed months and selects the most recent one', async () => {
      await renderDashboard();

      expect([...monthSelector().options].map((option) => option.textContent))
        .toEqual(['Septembre 2026', 'Août 2026', 'Juillet 2026']);
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');
    });

    it('shows the figures of the month the user selects', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Août 2026');

      expect(monthSelector()).toHaveDisplayValue('Août 2026');
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 042,00€', '-16.7% vs mois précédent']);
      expect(texts(cardOf('Cloud Total'))).toEqual(['Cloud Total', '702,00€', 'Public Cloud']);
      expect(texts(cardOf('Coût moyen / jour')))
        .toEqual(['Coût moyen / jour', '33,61€', 'Sur 30 jours']);
      expect(texts(cardOf('Projets actifs'))).toEqual(['Projets actifs', '2', 'avec consommation']);
      expect(texts(cardOf('Total ressources')))
        .toEqual(['Total ressources', '7', '1 Serveurs dédiés · 0 VPS · 2 Projets Cloud']);
    });

    it('shows the loading screen again while the summary of the new month loads', async () => {
      const { user } = await renderDashboard();
      let answer;
      api.fetchSummary.mockImplementationOnce(() => new Promise((resolve) => {
        answer = resolve;
      }));

      await user.selectOptions(monthSelector(), 'Août 2026');
      expect(screen.getByText('Chargement des données...')).toBeInTheDocument();

      answer(account.summary['2026-08']);
      await settle();
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 042,00€', '-16.7% vs mois précédent']);
    });
  });

  describe('KPI cards', () => {
    it("show the month's cost, Cloud total, daily average and active projects", async () => {
      await renderDashboard();

      // The latest month is compared with itself, see below
      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 250,40€', '0.0% vs mois précédent']);
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
      expect(texts(cardOf('Prévision fin de mois')))
        .toEqual(['Prévision fin de mois', 'septembre 2026', '862,18€', '14/30 jours']);
      expect(texts(cardOf('Total ressources')))
        .toEqual(['Total ressources', '9', '1 Serveurs dédiés · 0 VPS · 2 Projets Cloud']);
    });

    it('flag a forecast above the budget', async () => {
      await renderDashboard({ ...account, config: { budget: 800, currency: 'EUR' } });

      expect(texts(cardOf('Prévision fin de mois')))
        .toEqual(['Prévision fin de mois', 'septembre 2026', '862,18€', '> Budget!']);
    });
  });

  // The variation reads the summary of the Compare tab's month B, which is
  // the latest month until the user picks another one there.
  describe('"vs previous month" variation', () => {
    it('compares the selected month with the latest one, not with the month before', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Août 2026');

      // (1 042 - 1 250.40) / 1 250.40
      expect(texts(cardOf('Coût total du mois'))).toContain('-16.7% vs mois précédent');
    });

    it('shows no previous data for the oldest month', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Juillet 2026');

      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '980,00€', 'Pas de données précédentes']);
    });

    it('follows the month B picked in the Compare tab', async () => {
      const { user } = await renderDashboard();
      await selectMonth(user, 'Août 2026');
      await openTab(user, 'Comparaison');

      const monthB = within(screen.getByText('Mois B :').parentElement).getByRole('combobox');
      await user.selectOptions(monthB, 'Juillet 2026');
      await settle();

      // (1 042 - 980) / 980
      expect(texts(cardOf('Coût total du mois'))).toContain('+6.3% vs mois précédent');
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
      expect(screen.getAllByRole('combobox').map((select) => select.value))
        .toEqual(['fr', '2026-08', '2026-09']);
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
    const importHistory = () =>
      within(screen.getByText('Historique des imports').closest('details')).getByRole('table');

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
    it('starts an import and says so in the footer', async () => {
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
      expect(screen.getByText(
        'Synchronisation lancée. Les données se mettront à jour dans quelques instants.',
      )).toBeInTheDocument();
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

      expect(screen.getByText(message)).toBeInTheDocument();
    });
  });

  describe('report export', () => {
    it('downloads the report of the month as Markdown', async () => {
      const { user } = await renderDashboard();
      const downloads = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'Markdown');

      expect(downloads).toHaveLength(1);
      expect(downloads[0].name).toBe('ovh-report-2026-09.md');
      expect(downloads[0].type).toBe('text/markdown');
      expect(await downloads[0].content).toBe([
        '# OVH Cost Report - Septembre 2026',
        '',
        '**Période:** 2026-09-01 to 2026-09-30',
        '',
        '## Résumé',
        '',
        '| Métrique | Valeur |',
        '|--------|-------|',
        // French amounts separate thousands with a narrow no-break space
        '| Coût Total | 1 250,40€ |',
        '| Cloud Total | 830,40€ |',
        '| Non-Cloud Total | 420,00€ |',
        '| Moyenne Journalière | 41,68€ |',
        '| Projets Actifs | 2 |',
        '',
        '## Par Type de Service',
        '',
        '| Service | Coût | % |',
        '|---------|------|---|',
        '| Compute | 800,40€ | 64.0% |',
        '| Storage | 250,00€ | 20.0% |',
        '| Other | 200,00€ | 16.0% |',
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
      const downloads = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choose...'), 'Markdown');

      const report = await downloads[0].content;
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
      await renderDashboard({
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
      // The "logout" translation key is missing (#34)
      expect(logout).toHaveAttribute('title', 'logout');
      expect(texts(screen.getByText('Expirations proches', { selector: 'span' }).parentElement))
        .toEqual(['2', 'Expirations proches']);
    });
  });

  describe('language', () => {
    it('switches the labels and the amounts to English, and back to French', async () => {
      const { user } = await renderDashboard();

      await selectLanguage(user, 'en');

      expect(screen.getByText('OVHcloud cost tracking dashboard')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resync/ })).toBeInTheDocument();
      expect(texts(cardOf('Total monthly cost')))
        .toEqual(['Total monthly cost', '1,250.40€', '0.0% vs previous month']);
      expect(texts(cardOf('Daily average cost')))
        .toEqual(['Daily average cost', '41.68€', 'Over 30 days']);
      expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Trends' })).toBeInTheDocument();
      expect(screen.getByText('Data synchronized via OVHcloud API')).toBeInTheDocument();
      expect(screen.getByText('Last sync: 9/14/2026, 6:02:30 AM (3 bills)')).toBeInTheDocument();
      // Month labels come from the API, in French only (#33)
      expect(monthSelector()).toHaveDisplayValue('Septembre 2026');

      await selectLanguage(user, 'fr');

      expect(texts(cardOf('Coût total du mois')))
        .toEqual(['Coût total du mois', '1 250,40€', '0.0% vs mois précédent']);
      expect(screen.getByRole('button', { name: "Vue d'ensemble" })).toBeInTheDocument();
    });
  });
});
