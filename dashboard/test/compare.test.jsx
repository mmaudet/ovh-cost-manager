import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, everyResourceType, threeBilledProjects } from './fixtures/account.js';
import { billedProducts } from './fixtures/public-cloud.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from './fixtures/accounts.js';
import { months } from './fixtures/calendar.js';
import { api, holdBack } from './support/api.js';
import {
  accordionOf,
  cardOf,
  dropdown,
  firstColumnOf,
  headerOf,
  openTab,
  optionsOf,
  renderDashboard,
  rowTextsOf,
  rowsOf,
  selectAccount,
  selectLanguage,
  settle,
  sortTable,
  texts,
  toneOf,
} from './support/render.jsx';

// Months A and B both offer every month: the one they show tells them apart
const pickMonth = async (user, showing, month) => {
  await user.selectOptions(dropdown('Juillet 2026', showing), month);
  await settle();
};
// The months A and B, with their totals and the variation between them
const comparedTotals = () => cardOf(screen.getByText(/^(Mois|Month) A :$/));

// The comparisons, each shown or hidden by a click on its title
const PROJECTS = /^Comparaison par projet/;
const INFRASTRUCTURE = /^Comparaison Infrastructure/;
const BACKUP = /^Comparaison Backup/;
const PRIVATE_CLOUD = /^Comparaison Private Cloud/;
// The comparison of the Production project's products
const PRODUCTION_PRODUCTS = /^Production \(Projet\)/;
const toggle = (title) => screen.getByRole('button', { name: title });
const comparison = (title) => accordionOf(toggle(title));
const comparisonTable = (title) => within(comparison(title)).queryByRole('table');
const openComparison = async (user, title) => {
  await user.click(toggle(title));
  await settle();
};
// The comparisons of each project's products, by their titles
const projectComparisons = () => screen
  .getAllByRole('button', { name: /\(Projet\)/ })
  .map((button) => texts(button)[0]);

describe('Compare tab', () => {
  it('loads the figures of month A when the tab opens, but its summary (#50)', async () => {
    const figures = [
      api.fetchByService, api.fetchByProject,
      // The costs by resource type and the Veeam backups too (#32)
      api.fetchByResourceType, api.fetchBackupStats,
    ];
    // The months whose summary the page asked for, by their first day, once per request
    const summariesAskedFor = () => api.fetchSummary.mock.calls.map(([from]) => from).sort();
    const { user } = await renderDashboard();
    for (const fetchFigures of figures) {
      expect(fetchFigures).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
    }
    // The summary of August is there already, with September's: the page loads it at start,
    // for the variation of September from the month before, under the key of month A's (#50)
    expect(summariesAskedFor()).toEqual(['2026-08-01', '2026-09-01']);
    expect(api.fetchBackupStats).not.toHaveBeenCalled();
    expect(api.fetchInventoryServers).not.toHaveBeenCalled();

    await openTab(user, 'Comparaison');

    // Month B, the latest month, is the one the page opens on: its figures
    // are there already, all but its Veeam backups (#32)
    for (const fetchFigures of figures) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
    }
    // Month A does not ask for its summary again (#50)
    expect(summariesAskedFor()).toEqual(['2026-08-01', '2026-09-01']);
    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
    // The dedicated servers of the inventory load with the tab (#35), the
    // rest of the inventory with the Infrastructure tab only, and the
    // products of a project once its comparison opens (#181)
    expect(api.fetchInventoryServers).toHaveBeenCalled();
    expect(api.fetchInventoryVps).not.toHaveBeenCalled();
    expect(api.fetchInventoryStorage).not.toHaveBeenCalled();
    expect(api.fetchProjectProducts).not.toHaveBeenCalled();
  });

  describe('months A and B', () => {
    it('are the month before the latest one, and the latest one', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      // (1 250.40 - 1 042) / 1 042
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '1 042,00€', 'Août 2026', '+20,0 %', '1 250,40€', 'Septembre 2026',
      ]);
    });

    it('are the months the user picks, compared either way', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      await pickMonth(user, 'Septembre 2026', 'Août 2026');

      expect(api.fetchSummary).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
      // (1 042 - 980) / 980
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Juillet 2026', 'VS', 'Mois B :', 'Août 2026',
        '980,00€', 'Juillet 2026', '+6,3 %', '1 042,00€', 'Août 2026',
      ]);

      await pickMonth(user, 'Juillet 2026', 'Septembre 2026');

      // (1 042 - 1 250.40) / 1 250.40
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Août 2026',
        '1 250,40€', 'Septembre 2026', '-16,7 %', '1 042,00€', 'Août 2026',
      ]);
    });

    it('stay picked when the user comes back to the tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Comparaison');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Juillet 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '980,00€', 'Juillet 2026', '+27,6 %', '1 250,40€', 'Septembre 2026',
      ]);
    });

    // Only the months of another account selected in the header move them (#119)
    it('stay as picked when the user picks the same month for both', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '1 250,40€', 'Septembre 2026', '0,0 %', '1 250,40€', 'Septembre 2026',
      ]);
    });

    it('are the same month when a single month was billed', async () => {
      const { user } = await renderDashboard({ ...account, months: [months[0]] });

      await openTab(user, 'Comparaison');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '1 250,40€', 'Septembre 2026', '0,0 %', '1 250,40€', 'Septembre 2026',
      ]);
    });
  });

  it('draws the service types of months A and B in a chart', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchByService).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);

    await openTab(user, 'Comparaison');

    // Nothing else shows under the heading, no list or total: the legend and
    // the axes are the chart's, and it draws nothing without a layout
    expect(screen.getByRole('heading', { name: 'Comparaison par service' }))
      .toBeInTheDocument();
    // What it is drawn from: the service types of month A, once the tab opens
    expect(api.fetchByService).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);

    await pickMonth(user, 'Septembre 2026', 'Juillet 2026');

    // ... and those of month B, once the user picks it
    expect(api.fetchByService).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
  });

  describe('project comparison', () => {
    const projectTable = () => comparisonTable(PROJECTS);
    const projectRows = () => rowsOf(projectTable());
    // The columns with their sort marks, and the projects in the order shown
    const header = () => headerOf(projectTable());
    const projects = () => firstColumnOf(projectTable());

    it('compares the cost of each project, most expensive in month A first', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      // Open from the start
      expect(projectRows()).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '512,00€', '610,40€', '+19,2 %'],
        ['Staging', '190,00€', '220,00€', '+15,8 %'],
      ]);
    });

    it('sorts the projects by name, month A, month B or variation, each way in turn', async () => {
      const { user } = await renderDashboard({ ...account, ...threeBilledProjects });
      await openTab(user, 'Comparaison');
      expect(projectRows()).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '412,00€', '460,40€', '+11,7 %'],
        ['Sandbox', '180,00€', '120,00€', '-33,3 %'],
        ['Staging', '110,00€', '250,00€', '+127,3 %'],
      ]);

      await sortTable(user, projectTable(), /^Août 2026/);

      expect(header()).toEqual(['Projet○', 'Août 2026▲', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Staging', 'Sandbox', 'Production']);

      await sortTable(user, projectTable(), /^Septembre 2026/);

      expect(header()).toEqual(['Projet○', 'Août 2026○', 'Septembre 2026▼', 'Variation○']);
      expect(projects()).toEqual(['Production', 'Staging', 'Sandbox']);

      await sortTable(user, projectTable(), /^Septembre 2026/);

      expect(header()).toEqual(['Projet○', 'Août 2026○', 'Septembre 2026▲', 'Variation○']);
      expect(projects()).toEqual(['Sandbox', 'Staging', 'Production']);

      await sortTable(user, projectTable(), /^Variation/);

      expect(header()).toEqual(['Projet○', 'Août 2026○', 'Septembre 2026○', 'Variation▼']);
      expect(projects()).toEqual(['Staging', 'Production', 'Sandbox']);

      await sortTable(user, projectTable(), /^Variation/);

      expect(header()).toEqual(['Projet○', 'Août 2026○', 'Septembre 2026○', 'Variation▲']);
      expect(projects()).toEqual(['Sandbox', 'Production', 'Staging']);

      await sortTable(user, projectTable(), /^Projet/);

      // From A to Z first, as every text column (#146)
      expect(header()).toEqual(['Projet▲', 'Août 2026○', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Production', 'Sandbox', 'Staging']);

      await sortTable(user, projectTable(), /^Projet/);

      expect(header()).toEqual(['Projet▼', 'Août 2026○', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Staging', 'Sandbox', 'Production']);
      // The comparisons of each project follow the same order
      expect(projectComparisons())
        .toEqual(['Staging (Projet)', 'Sandbox (Projet)', 'Production (Projet)']);
    });

    it('keeps its sort order when the user comes back to the tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      // From Z to A, the second way (#146)
      await sortTable(user, projectTable(), /^Projet/);
      await sortTable(user, projectTable(), /^Projet/);

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Comparaison');

      expect(projectRows()).toEqual([
        ['Projet▼', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
        ['Staging', '190,00€', '220,00€', '+15,8 %'],
        ['Production', '512,00€', '610,40€', '+19,2 %'],
      ]);
    });

    // #55: the projects of both months, paired by id
    it('lists a project billed in month B only, from 0 € in month A (#55)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      // Staging was first billed in August, after month A: its variation
      // from 0 € cannot be computed, and a tooltip says why (#65)
      expect(projectRows()).toEqual([
        ['Projet○', 'Juillet 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '680,00€', '610,40€', '-10,2 %'],
        ['Staging', '0,00€', '220,00€', '—'],
      ]);
      expect(within(projectTable()).getByTitle('non calculable : mois A à 0 € ou moins'))
        .toHaveTextContent('—');
      // Its products are compared too, from nothing in July (#181)
      expect(projectComparisons()).toEqual(['Production (Projet)', 'Staging (Projet)']);
      await openComparison(user, /^Staging \(Projet\)/);
      expect(api.fetchProjectProducts)
        .toHaveBeenCalledWith('project-staging', '2026-07-01', '2026-07-31', null);
      expect(rowsOf(comparisonTable(/^Staging \(Projet\)/))).toEqual([
        ['Produit○', 'Juillet 2026○', 'Septembre 2026○', 'Variation○'],
        ['Instances', '0,00€', '180,00€', '—'],
        ['Registre', '0,00€', '40,00€', '—'],
      ]);

      await selectLanguage(user, 'en');

      expect(within(comparisonTable(/^Comparison by project/))
        .getByTitle('cannot be computed: month A at €0 or below')).toHaveTextContent('—');
    });

    it('lists the projects of month B when month A has none (#55)', async () => {
      // No project billed in July
      const { user } = await renderDashboard({
        ...account, byProject: { ...account.byProject, '2026-07': [] },
      });
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      expect(projectRows()).toEqual([
        ['Projet○', 'Juillet 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '0,00€', '610,40€', '—'],
        ['Staging', '0,00€', '220,00€', '—'],
      ]);
      expect(projectComparisons()).toEqual(['Production (Projet)', 'Staging (Projet)']);
    });

    it('pairs the projects of months A and B by their id (#55)', async () => {
      // Staging, renamed in September, and two projects deleted since, which
      // the server cannot name: they read "Unknown"
      const deleted = (projectId, total) => ({
        projectId, projectName: 'Unknown', total, detailsCount: 1,
      });
      const [production, staging] = account.byProject['2026-09'];
      const { user } = await renderDashboard({
        ...account,
        byProject: {
          ...account.byProject,
          '2026-08': [...account.byProject['2026-08'], deleted('project-deleted-1', 40)],
          '2026-09': [
            production,
            { ...staging, projectName: 'Recette' },
            deleted('project-deleted-2', 15),
          ],
        },
      });

      await openTab(user, 'Comparaison');

      // Staging keeps its name of month A; each deleted project is compared
      // with itself, not with the other one
      expect(projectRows()).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '512,00€', '610,40€', '+19,2 %'],
        ['Staging', '190,00€', '220,00€', '+15,8 %'],
        ['Unknown', '40,00€', '0,00€', '-100,0 %'],
        ['Unknown', '0,00€', '15,00€', '—'],
      ]);
    });

    it('sorts the projects of months A and B together (#55)', async () => {
      const { user } = await renderDashboard({ ...account, ...threeBilledProjects });
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      // Staging and Sandbox were first billed in August, after month A
      expect(projectRows()).toEqual([
        ['Projet○', 'Juillet 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '680,00€', '460,40€', '-32,3 %'],
        ['Staging', '0,00€', '250,00€', '—'],
        ['Sandbox', '0,00€', '120,00€', '—'],
      ]);

      await sortTable(user, projectTable(), /^Septembre 2026/);
      await sortTable(user, projectTable(), /^Septembre 2026/);

      expect(header()).toEqual(['Projet○', 'Juillet 2026○', 'Septembre 2026▲', 'Variation○']);
      expect(projects()).toEqual(['Sandbox', 'Staging', 'Production']);

      await sortTable(user, projectTable(), /^Variation/);

      // A variation that cannot be computed comes below any other
      expect(header()).toEqual(['Projet○', 'Juillet 2026○', 'Septembre 2026○', 'Variation▼']);
      expect(projects()).toEqual(['Production', 'Staging', 'Sandbox']);

      await sortTable(user, projectTable(), /^Variation/);

      // Whichever way, as any value that the page cannot show (#146)
      expect(header()).toEqual(['Projet○', 'Juillet 2026○', 'Septembre 2026○', 'Variation▲']);
      expect(projects()).toEqual(['Production', 'Staging', 'Sandbox']);

      // From A to Z first, as every text column (#146)
      await sortTable(user, projectTable(), /^Projet/);

      expect(header()).toEqual(['Projet▲', 'Juillet 2026○', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Production', 'Sandbox', 'Staging']);
      expect(projectComparisons())
        .toEqual(['Production (Projet)', 'Sandbox (Projet)', 'Staging (Projet)']);
    });

    it('compares a project billed in month A only with nothing', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      expect(projectRows()).toEqual([
        ['Projet○', 'Septembre 2026▼', 'Juillet 2026○', 'Variation○'],
        ['Production', '610,40€', '680,00€', '+11,4 %'],
        ['Staging', '220,00€', '0,00€', '-100,0 %'],
      ]);
    });
  });

  // The costs of each resource type are those of the costs by resource type
  // of months A and B, and the backups those of their Veeam backups (#32)
  describe('infrastructure, backup and Private Cloud comparisons', () => {
    it('compare the costs of each resource type in months A and B (#32)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      // Closed from the start
      expect(comparisonTable(INFRASTRUCTURE)).not.toBeInTheDocument();
      expect(comparisonTable(BACKUP)).not.toBeInTheDocument();
      expect(comparisonTable(PRIVATE_CLOUD)).not.toBeInTheDocument();

      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, BACKUP);
      await openComparison(user, PRIVATE_CLOUD);

      // August and September were each billed 270 € of dedicated servers,
      // and 30 € then 35 € of domains: nothing else these rows list (#32).
      // A variation from 0 € cannot be computed (#65).
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))).toEqual([
        ['Type', '○', 'Août 2026', '○', 'Septembre 2026', '○', 'Variation', '○'],
        // With the servers of the inventory, though the Infrastructure tab
        // never opened (#35)
        [
          'Liste des Serveurs dédiés présents au 15/09/2026',
          'backup-server', 'ns3000002.ip-198-51-100.eu', '270,00€', '270,00€', '0,0 %',
        ],
        ['VPS', '0,00€', '0,00€', '—'],
        ['Stockage', '0,00€', '0,00€', '—'],
        ['Load Balancer', '0,00€', '0,00€', '—'],
        ['Adresses IP', '0,00€', '0,00€', '—'],
        // (35 - 30) / 30
        ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
        ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
      ]);
      // 2 Veeam VMs backed up for 40 € in August, 3 for 90 € in September,
      // and an Enterprise licence of 25 € in September only (#32)
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['VMs Veeam Backup', '2 / 40,00€', '3 / 90,00€', '+125,0 %'],
        ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', '—'],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
        ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
      ]);
    });

    it('follow the months the user picks, for every resource type (#32)', async () => {
      const { user } = await renderDashboard({ ...account, ...everyResourceType });
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, BACKUP);
      await openComparison(user, PRIVATE_CLOUD);

      // Month A, September, was billed for every resource type these rows
      // list; month B, July, for dedicated servers and domains only, and
      // backed nothing up (#32)
      expect(api.fetchByResourceType).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
      expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))).toEqual([
        ['Type', '○', 'Septembre 2026', '○', 'Juillet 2026', '○', 'Variation', '○'],
        // With the servers of the inventory (#35)
        [
          'Liste des Serveurs dédiés présents au 15/09/2026',
          'backup-server', 'ns3000002.ip-198-51-100.eu', '270,00€', '270,00€', '0,0 %',
        ],
        ['VPS', '11,99€', '0,00€', '-100,0 %'],
        ['Stockage', '64,80€', '0,00€', '-100,0 %'],
        ['Load Balancer', '18,00€', '0,00€', '-100,0 %'],
        ['Adresses IP', '6,00€', '0,00€', '-100,0 %'],
        // (30 - 35) / 35
        ['Noms de domaine', '35,00€', '30,00€', '-14,3 %'],
        ['Hôtes Private Cloud', '1 450,00€', '0,00€', '-100,0 %'],
        ['Datastores Private Cloud', '380,00€', '0,00€', '-100,0 %'],
      ]);
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        ['VMs Veeam Backup', '3 / 90,00€', '0 / 0,00€', '-100,0 %'],
        ['Licence Veeam Enterprise', '1 / 25,00€', '0 / 0,00€', '-100,0 %'],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        ['Hôtes Private Cloud', '1 450,00€', '0,00€', '-100,0 %'],
        ['Datastores Private Cloud', '380,00€', '0,00€', '-100,0 %'],
      ]);
    });

    // The resource types without a variation last, whichever way (#146)
    it('sort the resource types of the infrastructure comparison by any column', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      const types = () => rowTextsOf(comparisonTable(INFRASTRUCTURE)).slice(1)
        .map(([type]) => type);

      await sortTable(user, comparisonTable(INFRASTRUCTURE), /^Variation/);

      expect(headerOf(comparisonTable(INFRASTRUCTURE)))
        .toEqual(['Type○', 'Août 2026○', 'Septembre 2026○', 'Variation▼']);
      // +16,7 %, 0,0 %, then the resource types at 0 € in month A
      expect(types()).toEqual([
        'Noms de domaine', 'Liste des Serveurs dédiés présents au 15/09/2026', 'VPS', 'Stockage',
        'Load Balancer', 'Adresses IP', 'Hôtes Private Cloud', 'Datastores Private Cloud',
      ]);

      await sortTable(user, comparisonTable(INFRASTRUCTURE), /^Type/);

      expect(types()).toEqual([
        'Adresses IP', 'Datastores Private Cloud', 'Hôtes Private Cloud',
        'Liste des Serveurs dédiés présents au 15/09/2026', 'Load Balancer', 'Noms de domaine',
        'Stockage', 'VPS',
      ]);
      // The Backup and Private Cloud comparisons have two rows each: nothing to sort
      await openComparison(user, BACKUP);
      expect(within(comparisonTable(BACKUP)).queryAllByRole('button')).toEqual([]);
    });

    it('list the dedicated servers as soon as the tab opens (#35)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await openComparison(user, INFRASTRUCTURE);

      // The servers of the inventory, though the Infrastructure tab never
      // opened (#35), and the costs of months A and B (#32)
      const dedicatedServers = [
        'Liste des Serveurs dédiés présents au 15/09/2026',
        'backup-server', 'ns3000002.ip-198-51-100.eu',
        '270,00€', '270,00€', '0,0 %',
      ];
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))[1]).toEqual(dedicatedServers);

      await openTab(user, 'Infrastructure');
      expect(screen.getByRole('heading', { name: /^Serveurs dédiés \(2\)/ }))
        .toBeInTheDocument();
      await openTab(user, 'Comparaison');

      // Closed again, as every comparison but the projects' when the tab opens
      expect(comparisonTable(INFRASTRUCTURE)).not.toBeInTheDocument();

      await openComparison(user, INFRASTRUCTURE);

      // The same servers: the Infrastructure tab showed them without requesting
      // them again, one query whichever tab loads it (#35)
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))[1]).toEqual(dedicatedServers);
      expect(api.fetchInventoryServers).toHaveBeenCalledTimes(1);
    });

    // With several accounts in the instance (#123): the servers of the inventory follow the
    // account selected in the header, as on the Infrastructure tab. See fixtures/accounts.js.
    describe('with several accounts', () => {
      // The servers that the row of the dedicated servers lists: its texts between its label
      // and the costs of months A and B, with the variation between them
      const listedServers = () => rowTextsOf(comparisonTable(INFRASTRUCTURE))[1].slice(1, -3);

      it('list the dedicated servers of the account selected', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');

        await selectAccount(user, 'Lyon subsidiary');
        await openComparison(user, INFRASTRUCTURE);

        expect(api.fetchInventoryServers).toHaveBeenCalledWith(lyonAccount.id);
        expect(listedServers()).toEqual(['backup-server']);

        await selectAccount(user, 'yy2222-ovh');
        await openComparison(user, INFRASTRUCTURE);

        expect(listedServers()).toEqual(['ns3000002.ip-198-51-100.eu']);
      });

      // By its name, or else its NIC handle, as on the Infrastructure tab's lists
      it('name the account of each dedicated server when the page shows all accounts',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');

          await openComparison(user, INFRASTRUCTURE);

          expect(listedServers()).toEqual([
            'backup-server', '(Lyon subsidiary)',
            'db-server', '(zz3333-ovh)',
            'legacy-server', '(Compte inconnu)',
            'ns3000002.ip-198-51-100.eu', '(yy2222-ovh)',
          ]);

          await selectAccount(user, 'Compte inconnu');
          await openComparison(user, INFRASTRUCTURE);

          expect(listedServers()).toEqual(['legacy-server']);
        });
    });
  });

  // The comparison of each project's products in months A and B, from the bills of each month
  // (#181)
  describe('project product comparisons', () => {
    it('are closed, one per project of the project comparison', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      expect(projectComparisons()).toEqual(['Production (Projet)', 'Staging (Projet)']);
      expect(comparisonTable(PRODUCTION_PRODUCTS)).not.toBeInTheDocument();
    });

    // Every month that billed the project, whether OCM imported in it or not, rather than the
    // consumption that an import records for its month only (#181)
    it('compare the products of a project from the bills of months A and B, once opened',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');

        await openComparison(user, PRODUCTION_PRODUCTS);

        expect(api.fetchProjectProducts)
          .toHaveBeenCalledWith('project-production', '2026-08-01', '2026-08-31', null);
        expect(api.fetchProjectProducts)
          .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30', null);
        // The products of month A, the most expensive first, then those of month B only. Each
        // month's add up to Production's cost in the comparison by project: 512 € in August,
        // 610.40 € in September.
        expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
          ['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
          // (538.90 - 440.60) / 440.60
          ['Instances', '440,60€', '538,90€', '+22,3 %'],
          ['Savings plans', '28,00€', '28,00€', '0,0 %'],
          ['Stockage objet', '24,90€', '25,00€', '+0,4 %'],
          ['Volumes', '12,50€', '12,50€', '0,0 %'],
          ['Snapshots', '6,00€', '6,00€', '0,0 %'],
        ]);
      });

    // Rather than that the bills charged the project nothing, or nothing in a month whose
    // answer has yet to arrive
    it('say that they load until the products of both months arrive', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      // August's products arrive, then July becomes month B while the comparison is closed
      await openComparison(user, PRODUCTION_PRODUCTS);
      await openComparison(user, PRODUCTION_PRODUCTS);
      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      const release = holdBack(api.fetchProjectProducts,
        (projectId, from) => from === '2026-07-01');

      await user.click(toggle(PRODUCTION_PRODUCTS));

      expect(within(comparison(PRODUCTION_PRODUCTS)).getByText('Chargement des données...'))
        .toBeInTheDocument();
      expect(within(comparison(PRODUCTION_PRODUCTS))
        .queryByText('Aucune donnée pour ce projet')).not.toBeInTheDocument();
      expect(comparisonTable(PRODUCTION_PRODUCTS)).not.toBeInTheDocument();

      release();
      await settle();

      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS)).slice(0, 2)).toEqual([
        ['Produit○', 'Août 2026○', 'Juillet 2026○', 'Variation○'],
        // (650 - 440.60) / 440.60
        ['Instances', '440,60€', '650,00€', '+47,5 %'],
      ]);
    });

    // A credit pays for no product (CONTEXT.md), as on the Public Cloud tab
    it('show the credit that the bills used apart, after the products', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      await openComparison(user, PRODUCTION_PRODUCTS);

      // July's products add up to 715 €, and with its credit to Production's 680 € in the
      // comparison by project. There is no variation from a credit to compute (#65).
      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
        ['Produit○', 'Juillet 2026○', 'Septembre 2026○', 'Variation○'],
        // (538.90 - 650) / 650
        ['Instances', '650,00€', '538,90€', '-17,1 %'],
        ['Bases de données', '45,00€', '0,00€', '-100,0 %'],
        ['Stockage objet', '20,00€', '25,00€', '+25,0 %'],
        ['Savings plans', '0,00€', '28,00€', '—'],
        ['Volumes', '0,00€', '12,50€', '—'],
        ['Snapshots', '0,00€', '6,00€', '—'],
        ['Crédit Cloud utilisé', '-35,00€', '0,00€', '—'],
      ]);

      // The least expensive in July first: the credit stays last
      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Juillet 2026/);
      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Juillet 2026/);

      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS)).slice(-3)).toEqual([
        ['Bases de données', '45,00€', '0,00€', '-100,0 %'],
        ['Instances', '650,00€', '538,90€', '-17,1 %'],
        ['Crédit Cloud utilisé', '-35,00€', '0,00€', '—'],
      ]);

      await selectLanguage(user, 'en');

      expect(rowsOf(comparisonTable(/^Production \(Project\)/)).at(-1))
        .toEqual(['Cloud credit used', '-35.00€', '0.00€', '—']);
    });

    // Each on its own, and still sorted once opened again (#146)
    it('sort the products of a project by any column, each project on its own', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, PRODUCTION_PRODUCTS);
      await openComparison(user, /^Staging \(Projet\)/);

      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Variation/);

      // The largest increase first; products of the same variation keep their order
      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
        ['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation▼'],
        ['Instances', '440,60€', '538,90€', '+22,3 %'],
        ['Stockage objet', '24,90€', '25,00€', '+0,4 %'],
        ['Savings plans', '28,00€', '28,00€', '0,0 %'],
        ['Volumes', '12,50€', '12,50€', '0,0 %'],
        ['Snapshots', '6,00€', '6,00€', '0,0 %'],
      ]);
      expect(headerOf(comparisonTable(/^Staging \(Projet\)/)))
        .toEqual(['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation○']);

      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Produit/);
      await openComparison(user, PRODUCTION_PRODUCTS);
      await openComparison(user, PRODUCTION_PRODUCTS);

      // By the name of each product, as the table gives it
      expect(firstColumnOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
        'Instances', 'Savings plans', 'Snapshots', 'Stockage objet', 'Volumes',
      ]);
    });

    // Staging was first billed in August (#55)
    it('show a variation of -100 % to a month that billed the project nothing', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      await openComparison(user, /^Staging \(Projet\)/);

      expect(api.fetchProjectProducts)
        .toHaveBeenCalledWith('project-staging', '2026-07-01', '2026-07-31', null);
      // Every product drops to nothing in July, month B
      expect(rowsOf(comparisonTable(/^Staging \(Projet\)/))).toEqual([
        ['Produit○', 'Septembre 2026○', 'Juillet 2026○', 'Variation○'],
        ['Instances', '180,00€', '0,00€', '-100,0 %'],
        ['Registre', '40,00€', '0,00€', '-100,0 %'],
      ]);
    });

    it('say when the bills of months A and B charged a project nothing', async () => {
      // Production's bill lines of August and September cost nothing, as free usage would:
      // the server gives no product that cost nothing
      const free = (projects) => projects.map((project) => (
        project.projectId === 'project-production' ? { ...project, total: 0 } : project
      ));
      const { user } = await renderDashboard({
        ...account,
        byProject: {
          ...account.byProject,
          '2026-08': free(account.byProject['2026-08']),
          '2026-09': free(account.byProject['2026-09']),
        },
        projectProducts: { ...account.projectProducts, 'project-production': {} },
      });
      await openTab(user, 'Comparaison');

      await openComparison(user, PRODUCTION_PRODUCTS);

      expect(within(comparison(PRODUCTION_PRODUCTS))
        .getByText('Aucune donnée pour ce projet')).toBeInTheDocument();
      expect(comparisonTable(PRODUCTION_PRODUCTS)).not.toBeInTheDocument();

      await selectLanguage(user, 'en');

      expect(within(comparison(/^Production \(Project\)/))
        .getByText('No data for this project')).toBeInTheDocument();
    });
  });

  // #65's rule for every variation of the tab: none from 0 € or less in month A, where it
  // would be infinite, or of the wrong sign when credits exceed the costs
  describe('variations from month A at 0 € or less (#65)', () => {
    it.each([
      ['at 0 €', 0, '0,00€'],
      ['whose credits exceed its costs', -120.5, '-120,50€'],
    ])('are not computed for the totals of a month A %s', async (_, total, shown) => {
      const { user } = await renderDashboard({
        ...account,
        summary: { ...account.summary, '2026-07': { ...account.summary['2026-07'], total } },
      });
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Juillet 2026', 'VS', 'Mois B :', 'Septembre 2026',
        shown, 'Juillet 2026', '—', '1 250,40€', 'Septembre 2026',
      ]);
      expect(within(comparedTotals()).getByTitle('non calculable : mois A à 0 € ou moins'))
        .toHaveTextContent('—');
    });

    it('are not computed from credits in month A, in any comparison', async () => {
      // July with credit notes larger than the costs of Production, -15 €, and of the
      // domains, -30 €
      const production = account.byProject['2026-07'][0];
      const { user } = await renderDashboard({
        ...account,
        byProject: { ...account.byProject, '2026-07': [{ ...production, total: -15 }] },
        byResourceType: {
          ...account.byResourceType,
          '2026-07': account.byResourceType['2026-07'].map((type) => (
            type.resource_type === 'domain' ? { ...type, value: -30 } : type
          )),
        },
      });
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, BACKUP);
      await openComparison(user, PRIVATE_CLOUD);

      // Neither -4169.3 % for Production nor -216.7 % for the domains
      expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
        ['Projet○', 'Juillet 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Staging', '0,00€', '220,00€', '—'],
        ['Production', '-15,00€', '610,40€', '—'],
      ]);
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE)).slice(1).map((row) => row.slice(-3)))
        .toEqual([
          // The dedicated servers, 270 € both months
          ['270,00€', '270,00€', '0,0 %'],
          ['0,00€', '0,00€', '—'],
          ['0,00€', '0,00€', '—'],
          ['0,00€', '0,00€', '—'],
          ['0,00€', '0,00€', '—'],
          // The domains
          ['-30,00€', '35,00€', '—'],
          ['0,00€', '0,00€', '—'],
          ['0,00€', '0,00€', '—'],
        ]);
      // Nothing backed up in July
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Juillet 2026', 'Septembre 2026', 'Variation'],
        ['VMs Veeam Backup', '0 / 0,00€', '3 / 90,00€', '—'],
        ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', '—'],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Juillet 2026', 'Septembre 2026', 'Variation'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
        ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
      ]);
    });
  });

  describe('tones of the variations (#87)', () => {
    it('show an increase in red, and a decrease in green', async () => {
      const { user } = await renderDashboard({
        ...account,
        summary: { ...account.summary, '2026-08': { ...account.summary['2026-08'], total: 1300 } },
      });
      await openTab(user, 'Comparaison');

      // (1 250.40 - 1 300) / 1 300
      expect(toneOf(within(comparedTotals()).getByText('-3,8 %'))).toBe('decrease');
      // (610.40 - 512) / 512
      expect(toneOf(within(comparisonTable(PROJECTS)).getByText('+19,2 %'))).toBe('increase');
    });

    // "+0,0 %" in red read as an increase that does not show
    it('show a variation that rounds to 0, either way, unsigned and neutral', async () => {
      const [production, staging] = account.byProject['2026-08'];
      const { user } = await renderDashboard({
        ...account,
        summary: { ...account.summary, '2026-08': { ...account.summary['2026-08'], total: 1250 } },
        byProject: {
          ...account.byProject,
          '2026-08': [{ ...production, total: 610.3 }, { ...staging, total: 220.05 }],
        },
      });
      await openTab(user, 'Comparaison');

      // (1 250.40 - 1 250) / 1 250 is 0.03 %
      expect(texts(comparedTotals()).slice(5)).toEqual([
        '1 250,00€', 'Août 2026', '0,0 %', '1 250,40€', 'Septembre 2026',
      ]);
      expect(toneOf(within(comparedTotals()).getByText('0,0 %'))).toBe('neutral');
      // (610.40 - 610.30) / 610.30 is 0.02 %, (220 - 220.05) / 220.05 -0.02 %
      expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '610,30€', '610,40€', '0,0 %'],
        ['Staging', '220,05€', '220,00€', '0,0 %'],
      ]);
      for (const variation of within(comparisonTable(PROJECTS)).getAllByText('0,0 %')) {
        expect(toneOf(variation)).toBe('neutral');
      }

      await selectLanguage(user, 'en');

      expect(toneOf(within(comparedTotals()).getByText('0.0%'))).toBe('neutral');
      const projects = comparisonTable(/^Comparison by project/);
      expect(rowsOf(projects).slice(1).map((row) => row[3])).toEqual(['0.0%', '0.0%']);
      for (const variation of within(projects).getAllByText('0.0%')) {
        expect(toneOf(variation)).toBe('neutral');
      }
    });
  });

  it('speaks English when the page does', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');

    await openTab(user, 'Compare');

    // The months in the language of the page, not in the French of the API (#33)
    expect(texts(comparedTotals())).toEqual([
      'Month A :', 'August 2026', 'VS', 'Month B :', 'September 2026',
      '1,042.00€', 'August 2026', '+20.0%', '1,250.40€', 'September 2026',
    ]);
    expect(screen.getByRole('heading', { name: 'Comparison by service' })).toBeInTheDocument();
    expect(rowsOf(comparisonTable(/^Comparison by project/))).toEqual([
      ['Project○', 'August 2026▼', 'September 2026○', 'Variation○'],
      ['Production', '512.00€', '610.40€', '+19.2%'],
      ['Staging', '190.00€', '220.00€', '+15.8%'],
    ]);

    await openComparison(user, /^Infrastructure Comparison/);
    await openComparison(user, /^Backup Comparison/);
    await openComparison(user, /^Private Cloud Comparison/);
    await openComparison(user, /^Production \(Project\)/);

    // Months A and B head the other comparisons too, in English (#33)
    expect(headerOf(comparisonTable(/^Infrastructure Comparison/)))
      .toEqual(['Type○', 'August 2026○', 'September 2026○', 'Variation○']);
    expect(headerOf(comparisonTable(/^Private Cloud Comparison/)))
      .toEqual(['Type', 'August 2026', 'September 2026', 'Variation']);
    // The label of each row, its first text: the row of the dedicated servers
    // lists them after it (#35)
    const infrastructureTypes = rowTextsOf(comparisonTable(/^Infrastructure Comparison/))
      .map(([type]) => type);
    expect(infrastructureTypes).toEqual([
      'Type',
      'List of Dedicated Servers present on 15/09/2026',
      'VPS', 'Storage', 'Load Balancer', 'IP Addresses', 'Domains',
      'Private Cloud Hosts', 'Private Cloud Datastores',
    ]);
    // The Veeam backups of months A and B (#32), none to compute a variation
    // from (#65)
    expect(rowsOf(comparisonTable(/^Backup Comparison/))).toEqual([
      ['Category', 'August 2026', 'September 2026', 'Variation'],
      ['Veeam Backup VMs', '2 / 40.00€', '3 / 90.00€', '+125.0%'],
      ['Veeam Enterprise License', '0 / 0.00€', '1 / 25.00€', '—'],
    ]);
    expect(within(comparisonTable(/^Backup Comparison/))
      .getByTitle('cannot be computed: month A at €0 or below')).toHaveTextContent('—');
    expect(rowsOf(comparisonTable(/^Private Cloud Comparison/)).map(([type]) => type))
      .toEqual(['Type', 'Private Cloud Hosts', 'Private Cloud Datastores']);
    // Each product in English (#181)
    expect(rowsOf(comparisonTable(/^Production \(Project\)/))).toEqual([
      ['Product○', 'August 2026○', 'September 2026○', 'Variation○'],
      ['Instances', '440.60€', '538.90€', '+22.3%'],
      ['Savings plans', '28.00€', '28.00€', '0.0%'],
      ['Object storage', '24.90€', '25.00€', '+0.4%'],
      ['Volumes', '12.50€', '12.50€', '0.0%'],
      ['Snapshots', '6.00€', '6.00€', '0.0%'],
    ]);
  });

  // Several accounts in the instance (#119): the tab compares two months of the account
  // selected in the header, or of every account, by default. See fixtures/accounts.js.
  describe('with several accounts', () => {
    // The dropdowns of months A and B, the only ones whose options are all months
    const monthDropdowns = () => screen.getAllByRole('combobox')
      .filter((select) => optionsOf(select).every((option) => /^\p{L}+ \d{4}$/u.test(option)));
    // Months A and B, as their dropdowns show them
    const comparedMonths = () => monthDropdowns().map((select) => texts(select)[0]);

    // The dropdowns list the months of the account selected (#115): they show the months
    // compared, rather than a month they do not list
    describe('months A and B', () => {
      it('stay as picked while the account selected was billed in both', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');
        await pickMonth(user, 'Août 2026', 'Juillet 2026');

        await selectAccount(user, 'Lyon subsidiary');

        expect(comparedMonths()).toEqual(['Juillet 2026', 'Septembre 2026']);
      });

      it('are those the tab opens on for an account that lacks either', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');

        // Not billed in September, month B
        await selectAccount(user, 'zz3333-ovh (non configuré)');

        for (const select of monthDropdowns()) {
          expect(optionsOf(select)).toEqual(['Août 2026', 'Juillet 2026']);
        }
        expect(comparedMonths()).toEqual(['Juillet 2026', 'Août 2026']);

        // Billed in July only: that month, compared with itself
        await selectAccount(user, 'Compte inconnu');

        expect(comparedMonths()).toEqual(['Juillet 2026', 'Juillet 2026']);
      });

      // Rather than keep comparing July with itself, which all accounts were billed in too
      it('are those the tab opens on after an account billed in a single month', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');
        await selectAccount(user, 'Compte inconnu');

        await selectAccount(user, 'Tous les comptes');

        expect(texts(comparedTotals())).toEqual([
          'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
          '1 042,00€', 'Août 2026', '+20,0 %', '1 250,40€', 'Septembre 2026',
        ]);
      });

      it('are those the tab opens on for an account not billed in the month A picked',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');
          await pickMonth(user, 'Août 2026', 'Juillet 2026');

          await selectAccount(user, 'yy2222-ovh');

          expect(comparedMonths()).toEqual(['Août 2026', 'Septembre 2026']);
        });
    });

    // Every comparison of both months reads the figures of the account selected
    describe('figures', () => {
      // The costs of the infrastructure comparison, each row as its label, its costs in months
      // A and B and the variation between them. The dedicated servers of the inventory that
      // its first row lists follow the account with the Infrastructure tab (#123).
      const infrastructureCosts = () => rowTextsOf(comparisonTable(INFRASTRUCTURE)).slice(1)
        .map((row) => [row[0], ...row.slice(-3)]);
      const nothingIn = (label) => [label, '0,00€', '0,00€', '—'];
      // Opens the comparisons that are closed: the page shows its loading screen while the
      // months of the account just selected load, which closes them
      const openComparisons = async (user) => {
        for (const title of [INFRASTRUCTURE, BACKUP, PRIVATE_CLOUD]) {
          if (!comparisonTable(title)) await openComparison(user, title);
        }
      };

      it('are those of the account selected, and of all accounts again', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');

        await selectAccount(user, 'Lyon subsidiary');
        await openComparisons(user);

        // (890.40 - 612) / 612
        expect(texts(comparedTotals())).toEqual([
          'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
          '612,00€', 'Août 2026', '+45,5 %', '890,40€', 'Septembre 2026',
        ]);
        // What the chart of the service types is drawn from
        for (const { from, to } of [months[1], months[0]]) {
          expect(api.fetchByService).toHaveBeenCalledWith(from, to, lyonAccount.id);
        }
        expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
          ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
          ['Production', '512,00€', '610,40€', '+19,2 %'],
        ]);
        expect(projectComparisons()).toEqual(['Production (Projet)']);
        expect(infrastructureCosts()).toEqual([
          // (270 - 70) / 70
          [
            'Liste des Serveurs dédiés présents au 15/09/2026',
            '70,00€', '270,00€', '+285,7 %',
          ],
          nothingIn('VPS'),
          nothingIn('Stockage'),
          nothingIn('Load Balancer'),
          nothingIn('Adresses IP'),
          // (10 - 30) / 30
          ['Noms de domaine', '30,00€', '10,00€', '-66,7 %'],
          nothingIn('Hôtes Private Cloud'),
          nothingIn('Datastores Private Cloud'),
        ]);
        // Nothing backed up
        expect(rowsOf(comparisonTable(BACKUP))).toEqual([
          ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
          ['VMs Veeam Backup', '0 / 0,00€', '0 / 0,00€', '—'],
          ['Licence Veeam Enterprise', '0 / 0,00€', '0 / 0,00€', '—'],
        ]);

        await selectAccount(user, 'yy2222-ovh');
        await openComparisons(user);

        // (360 - 230) / 230
        expect(texts(comparedTotals())).toEqual([
          'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
          '230,00€', 'Août 2026', '+56,5 %', '360,00€', 'Septembre 2026',
        ]);
        expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
          ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
          ['Staging', '190,00€', '220,00€', '+15,8 %'],
        ]);
        expect(projectComparisons()).toEqual(['Staging (Projet)']);
        expect(infrastructureCosts()).toEqual([
          nothingIn('Liste des Serveurs dédiés présents au 15/09/2026'),
          nothingIn('VPS'),
          nothingIn('Stockage'),
          nothingIn('Load Balancer'),
          nothingIn('Adresses IP'),
          ['Noms de domaine', '0,00€', '25,00€', '—'],
          nothingIn('Hôtes Private Cloud'),
          nothingIn('Datastores Private Cloud'),
        ]);
        // Every Veeam backup of the instance: (90 - 40) / 40
        expect(rowsOf(comparisonTable(BACKUP))).toEqual([
          ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
          ['VMs Veeam Backup', '2 / 40,00€', '3 / 90,00€', '+125,0 %'],
          ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', '—'],
        ]);

        await selectAccount(user, 'Tous les comptes');

        expect(texts(comparedTotals())).toEqual([
          'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
          '1 042,00€', 'Août 2026', '+20,0 %', '1 250,40€', 'Septembre 2026',
        ]);
      });

      // Staging, billed to yy2222-ovh and to Lyon in September: Lyon's bills charged it 50 € of
      // instances, its cost in Lyon's comparison by project (#181)
      it('compare the products that the bills of the account selected charged a project',
        async () => {
          const lyon = severalAccounts.ofAccount[lyonAccount.id];
          const { user } = await renderDashboard({
            ...severalAccounts,
            ofAccount: {
              ...severalAccounts.ofAccount,
              [lyonAccount.id]: {
                ...lyon,
                byProject: {
                  ...lyon.byProject,
                  '2026-09': [...lyon.byProject['2026-09'], {
                    projectId: 'project-staging', projectName: 'Staging', total: 50,
                    detailsCount: 1,
                  }],
                },
                projectProducts: {
                  ...lyon.projectProducts,
                  'project-staging': { '2026-09': billedProducts(50, [['instances', 50]]) },
                },
              },
            },
          });
          await openTab(user, 'Comparaison');

          await selectAccount(user, 'Lyon subsidiary');
          await openComparison(user, /^Staging \(Projet\)/);

          expect(rowsOf(comparisonTable(PROJECTS)).slice(1)).toEqual([
            ['Production', '512,00€', '610,40€', '+19,2 %'],
            ['Staging', '0,00€', '50,00€', '—'],
          ]);
          for (const { from, to } of [months[1], months[0]]) {
            expect(api.fetchProjectProducts)
              .toHaveBeenCalledWith('project-staging', from, to, lyonAccount.id);
          }
          // Not the instances and the registry that yy2222-ovh's bills charged it
          expect(rowsOf(comparisonTable(/^Staging \(Projet\)/))).toEqual([
            ['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
            ['Instances', '0,00€', '50,00€', '—'],
          ]);
        });

      it('compare the Private Cloud of the account selected', async () => {
        // Every resource type billed in September for all accounts, the Private Cloud
        // included, whose hosts and datastores Lyon was not billed for
        const { user } = await renderDashboard({ ...severalAccounts, ...everyResourceType });
        await openTab(user, 'Comparaison');
        await openComparison(user, PRIVATE_CLOUD);
        expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
          ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
          ['Hôtes Private Cloud', '0,00€', '1 450,00€', '—'],
          ['Datastores Private Cloud', '0,00€', '380,00€', '—'],
        ]);

        await selectAccount(user, 'Lyon subsidiary');
        await openComparisons(user);

        expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
          ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
          nothingIn('Hôtes Private Cloud'),
          nothingIn('Datastores Private Cloud'),
        ]);
      });

      it('are asked for no month that the account selected lacks', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');

        // Not billed in September, month B: the tab compares July and August
        await selectAccount(user, 'zz3333-ovh (non configuré)');

        for (const fetchFigures of [
          api.fetchSummary, api.fetchByService, api.fetchByProject, api.fetchByResourceType,
          api.fetchBackupStats,
        ]) {
          expect(fetchFigures)
            .not.toHaveBeenCalledWith('2026-09-01', '2026-09-30', removedAccount.id);
          expect(fetchFigures)
            .toHaveBeenCalledWith('2026-07-01', '2026-07-31', removedAccount.id);
        }
        // (200 - 180) / 180
        expect(texts(comparedTotals())).toEqual([
          'Mois A :', 'Juillet 2026', 'VS', 'Mois B :', 'Août 2026',
          '180,00€', 'Juillet 2026', '+11,1 %', '200,00€', 'Août 2026',
        ]);
        // Without a project
        expect(rowsOf(comparisonTable(PROJECTS)))
          .toEqual([['Projet○', 'Juillet 2026▼', 'Août 2026○', 'Variation○']]);
        expect(screen.queryAllByRole('button', { name: /\(Projet\)/ })).toEqual([]);
      });
    });

    // With all accounts shown, the comparison by project names the account of each project:
    // its name, or else its NIC handle, as the accounts route lists it (#119)
    describe('Account column', () => {
      const projectRows = () => rowsOf(comparisonTable(PROJECTS));
      // Without the column, as with a single account
      const WITHOUT_ACCOUNT = [
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '512,00€', '610,40€', '+19,2 %'],
        ['Staging', '190,00€', '220,00€', '+15,8 %'],
      ];
      // Staging, moved from Lyon to yy2222-ovh during September: once for each account that
      // billed it, as the server lists the projects by account (#118)
      const [production] = severalAccounts.projectsByAccount['2026-09'];
      const staging = (total, { nic }) => ({
        projectId: 'project-staging', projectName: 'Staging', total, detailsCount: 4, account: nic,
      });
      const stagingMoved = {
        ...severalAccounts,
        projectsByAccount: {
          ...severalAccounts.projectsByAccount,
          '2026-09': [production, staging(170, unnamedAccount), staging(50, lyonAccount)],
        },
      };

      it('names the account of each project with all accounts shown', async () => {
        const { user } = await renderDashboard(severalAccounts);

        await openTab(user, 'Comparaison');

        expect(projectRows()).toEqual([
          ['Projet○', 'Compte○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
          ['Production', 'Lyon subsidiary', '512,00€', '610,40€', '+19,2 %'],
          ['Staging', 'yy2222-ovh', '190,00€', '220,00€', '+15,8 %'],
        ]);
        // The projects of months A and B by account, rather than once each
        for (const { from, to } of [months[1], months[0]]) {
          expect(api.fetchProjectsByAccount).toHaveBeenCalledWith(from, to);
        }
        expect(api.fetchByProject).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
      });

      // Each row compares what one account paid for the project in months A and B
      it('compares a project billed to two accounts once for each, its products once',
        async () => {
          const { user } = await renderDashboard(stagingMoved);

          await openTab(user, 'Comparaison');

          // (170 - 190) / 190
          expect(projectRows()).toEqual([
            ['Projet○', 'Compte○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
            ['Production', 'Lyon subsidiary', '512,00€', '610,40€', '+19,2 %'],
            ['Staging', 'yy2222-ovh', '190,00€', '170,00€', '-10,5 %'],
            ['Staging', 'Lyon subsidiary', '0,00€', '50,00€', '—'],
          ]);
          // Its products are those of the bills of every account, as all accounts are shown
          // (#181): in September, those of the 170 € and of the 50 €
          expect(projectComparisons()).toEqual(['Production (Projet)', 'Staging (Projet)']);
          await openComparison(user, /^Staging \(Projet\)/);
          expect(api.fetchProjectProducts)
            .toHaveBeenCalledWith('project-staging', '2026-09-01', '2026-09-30', null);
          expect(rowsOf(comparisonTable(/^Staging \(Projet\)/))).toEqual([
            ['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
            ['Instances', '150,00€', '180,00€', '+20,0 %'],
            ['Registre', '40,00€', '40,00€', '0,0 %'],
          ]);

          // Least expensive in month B first: in the order of their first rows
          await sortTable(user, comparisonTable(PROJECTS), /^Septembre 2026/);
          await sortTable(user, comparisonTable(PROJECTS), /^Septembre 2026/);

          expect(firstColumnOf(comparisonTable(PROJECTS)))
            .toEqual(['Staging', 'Staging', 'Production']);
          expect(projectComparisons()).toEqual(['Staging (Projet)', 'Production (Projet)']);
        });

      it('names no account once one is selected, and names them again with all accounts',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');

          await selectAccount(user, 'Lyon subsidiary');

          expect(headerOf(comparisonTable(PROJECTS)))
            .toEqual(['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○']);

          await selectAccount(user, 'Tous les comptes');

          expect(headerOf(comparisonTable(PROJECTS)))
            .toEqual(['Projet○', 'Compte○', 'Août 2026▼', 'Septembre 2026○', 'Variation○']);
        });

      // As the page shows it before an instance could import several accounts, whatever the
      // rows say of their account
      it.each([
        ['a single account', [lyonAccount]],
        ['no account, as before the first import since the upgrade', []],
      ])('names no account with %s', async (_, accounts) => {
        const { user } = await renderDashboard({ ...stagingMoved, accounts });

        await openTab(user, 'Comparaison');

        expect(projectRows()).toEqual(WITHOUT_ACCOUNT);
        expect(api.fetchProjectsByAccount).not.toHaveBeenCalled();
      });

      it('names the Unknown account, in the language of the page', async () => {
        // A project that no account claimed since its bills were imported
        const legacy = {
          projectId: 'project-legacy', projectName: 'Legacy', total: 20, detailsCount: 1,
          account: null,
        };
        const { user } = await renderDashboard({
          ...severalAccounts,
          accounts: [lyonAccount, unknownAccount],
          projectsByAccount: {
            ...severalAccounts.projectsByAccount,
            '2026-09': [production, legacy],
          },
        });
        await openTab(user, 'Comparaison');

        expect(projectRows()[3])
          .toEqual(['Legacy', 'Compte inconnu', '0,00€', '20,00€', '—']);

        await selectLanguage(user, 'en');

        expect(rowsOf(comparisonTable(/^Comparison by project/))).toEqual([
          ['Project○', 'Account○', 'August 2026▼', 'September 2026○', 'Variation○'],
          ['Production', 'Lyon subsidiary', '512.00€', '610.40€', '+19.2%'],
          ['Staging', 'yy2222-ovh', '190.00€', '0.00€', '-100.0%'],
          ['Legacy', 'Unknown account', '0.00€', '20.00€', '—'],
        ]);
      });
    });
  });
});
