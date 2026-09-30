import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import {
  account, everyResourceType, septemberInProgress, threeBilledProjects,
} from './fixtures/account.js';
import {
  COLD_ARCHIVE, DB_1_PLAN, billedProducts, bucketStorage, hourlyUse,
} from './fixtures/public-cloud.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from './fixtures/accounts.js';
import { enterpriseLicence } from './fixtures/backup.js';
import { months } from './fixtures/calendar.js';
import { serverAndBackupsBilledLate } from './fixtures/compare.js';
import { api, failFor, holdBack } from './support/api.js';
import {
  accordionOf,
  cardOf,
  dropdown,
  firstColumnOf,
  headerOf,
  inItalics,
  layOutForPrint,
  openTab,
  optionsOf,
  projectionCheckbox,
  renderDashboard,
  resourceType,
  rowTextsOf,
  rowsOf,
  selectAccount,
  selectLanguage,
  settle,
  sortTable,
  texts,
  toggleProjection,
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
// The chevron of a row of a comparison, found by the row that it names (#192)
const chevron = (title, row) => within(comparisonTable(title))
  .getByRole('button', { name: `Services : ${row}` });
// Unfolds or folds a row of a comparison with a click on its chevron, as the user does
const toggleRow = async (user, title, row) => {
  await user.click(chevron(title, row));
  await settle();
};
// The rows of the infrastructure comparison, each as the texts it shows, header left out
const infrastructureRows = () => rowTextsOf(comparisonTable(INFRASTRUCTURE)).slice(1);

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
    // Nothing of the inventory, which the tab no longer lists (#194), and the products of a
    // project once its comparison opens (#181)
    expect(api.fetchInventoryServers).not.toHaveBeenCalled();
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
        'Projeter le mois en cours',
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
        'Projeter le mois en cours',
        '980,00€', 'Juillet 2026', '+6,3 %', '1 042,00€', 'Août 2026',
      ]);

      await pickMonth(user, 'Juillet 2026', 'Septembre 2026');

      // (1 042 - 1 250.40) / 1 250.40
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Août 2026',
        'Projeter le mois en cours',
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
        'Projeter le mois en cours',
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
        'Projeter le mois en cours',
        '1 250,40€', 'Septembre 2026', '0,0 %', '1 250,40€', 'Septembre 2026',
      ]);
    });

    // As the month selector of the header does, so that no one compares a partial month
    // unawares
    it('name the month in progress so, in the language of the page (#216)', async () => {
      const { user } = await renderDashboard({ ...account, ...septemberInProgress });
      await openTab(user, 'Comparaison');

      // Month B is still the latest month, the one the page opens on
      const monthA = dropdown('Juillet 2026', 'Août 2026');
      const monthB = dropdown('Juillet 2026', 'Septembre 2026 (en cours)');
      for (const select of [monthA, monthB]) {
        expect(optionsOf(select))
          .toEqual(['Septembre 2026 (en cours)', 'Août 2026', 'Juillet 2026']);
      }

      await selectLanguage(user, 'en');

      expect(optionsOf(dropdown('July 2026', 'September 2026 (in progress)')))
        .toEqual(['September 2026 (in progress)', 'August 2026', 'July 2026']);
    });

    it('are the same month when a single month was billed', async () => {
      const { user } = await renderDashboard({ ...account, months: [months[0]] });

      await openTab(user, 'Comparaison');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Septembre 2026',
        'Projeter le mois en cours',
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
        ['Serveurs dédiés', '270,00€', '270,00€', '0,0 %'],
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
        ['Serveurs dédiés', '270,00€', '270,00€', '0,0 %'],
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
        'Noms de domaine', 'Serveurs dédiés', 'VPS', 'Stockage',
        'Load Balancer', 'Adresses IP', 'Hôtes Private Cloud', 'Datastores Private Cloud',
      ]);

      await sortTable(user, comparisonTable(INFRASTRUCTURE), /^Type/);

      expect(types()).toEqual([
        'Adresses IP', 'Datastores Private Cloud', 'Hôtes Private Cloud', 'Load Balancer',
        'Noms de domaine', 'Serveurs dédiés', 'Stockage', 'VPS',
      ]);
      // The Backup and Private Cloud comparisons have two rows each: nothing to sort, no header
      // that sorts, whatever buttons their rows have to unfold (#197)
      await openComparison(user, BACKUP);
      expect(within(comparisonTable(BACKUP)).getAllByRole('columnheader')
        .flatMap((header) => within(header).queryAllByRole('button'))).toEqual([]);
    });

    // The servers that the inventory holds today have nothing to do with months A and B: the
    // Infrastructure tab lists them (#35), and the row unfolds into those billed (#194)
    it('list no server of the inventory, but those that months A and B billed', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await openComparison(user, INFRASTRUCTURE);

      expect(infrastructureRows()[0])
        .toEqual(['Serveurs dédiés', '270,00€', '270,00€', '0,0 %']);
      expect(api.fetchInventoryServers).not.toHaveBeenCalled();

      await toggleRow(user, INFRASTRUCTURE, 'Serveurs dédiés');

      // Not ns3000002, which the inventory holds but no bill charged yet
      expect(infrastructureRows().slice(0, 3)).toEqual([
        ['Serveurs dédiés', '270,00€', '270,00€', '0,0 %'],
        [
          'ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
          '270,00€', '270,00€', '0,0 %',
        ],
        ['VPS', '0,00€', '0,00€', '—'],
      ]);

      await openTab(user, 'Infrastructure');

      expect(screen.getByRole('heading', { name: /^Serveurs dédiés \(2\)/ }))
        .toBeInTheDocument();
      expect(api.fetchInventoryServers).toHaveBeenCalledTimes(1);
    });

    // With several accounts in the instance (#123): the servers that the row unfolds into are
    // those billed to the account selected in the header, as its costs are, and with all
    // accounts shown, each names its account (#194). See fixtures/accounts.js.
    describe('with several accounts', () => {
      // Those of the account selected only: the inventory holds a server of yy2222-ovh
      it('offer no dedicated server to unfold for an account billed none', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Comparaison');

        await selectAccount(user, 'yy2222-ovh');
        await openComparison(user, INFRASTRUCTURE);

        expect(infrastructureRows()[0]).toEqual(['Serveurs dédiés', '0,00€', '0,00€', '—']);
        expect(within(comparisonTable(INFRASTRUCTURE))
          .queryByRole('button', { name: 'Services : Serveurs dédiés' })).not.toBeInTheDocument();
        expect(api.fetchInventoryServers).not.toHaveBeenCalled();
      });

      // By its name, or else its NIC handle, and the Unknown account for the bills without an
      // account, as on the Infrastructure tab's lists
      it('name the account of each dedicated server billed when the page shows all accounts',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');
          await openComparison(user, INFRASTRUCTURE);

          await toggleRow(user, INFRASTRUCTURE, 'Serveurs dédiés');

          // The server of the account no longer configured, billed in August, and Lyon's,
          // rented from the end of August: 270 € each month, as the row
          expect(infrastructureRows().slice(1, 3)).toEqual([
            [
              'ns3000003.ip-203-0-113.eu', '(zz3333-ovh)',
              'Location du serveur RISE-1 ns3000003.ip-203-0-113.eu - 1 mois',
              '200,00€', '0,00€', '-100,0 %',
            ],
            [
              'ns3000001.ip-203-0-113.eu', '(Lyon subsidiary)',
              'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
              '70,00€', '270,00€', '+285,7 %',
            ],
          ]);

          // In July, with the server of the bills without an account, which no account claimed
          await pickMonth(user, 'Août 2026', 'Juillet 2026');

          expect(infrastructureRows().slice(0, 4)).toEqual([
            ['Serveurs dédiés', '270,00€', '270,00€', '0,0 %'],
            [
              'ns3000003.ip-203-0-113.eu', '(zz3333-ovh)',
              'Location du serveur RISE-1 ns3000003.ip-203-0-113.eu - 1 mois',
              '180,00€', '0,00€', '-100,0 %',
            ],
            [
              'ns3000004.ip-203-0-113.eu', '(Compte inconnu)',
              'Location du serveur KS-1 ns3000004.ip-203-0-113.eu - 1 mois',
              '90,00€', '0,00€', '-100,0 %',
            ],
            [
              'ns3000001.ip-203-0-113.eu', '(Lyon subsidiary)',
              'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
              '0,00€', '270,00€', '—',
            ],
          ]);
        });

      // example.com moved from Lyon to yy2222-ovh during September, and each account billed one
      // of its options: with the other domains, they add up to the row's 30 € and 35 €
      it('compare a service billed by two accounts once for each, adding up to its row',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');
          await openComparison(user, INFRASTRUCTURE);

          await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');

          // Every account's, by account, as the Infrastructure tab asks for them
          for (const { from, to } of [months[1], months[0]]) {
            expect(api.fetchResourceTypeDetailsByAccount).toHaveBeenCalledWith('domain', from, to);
          }
          // (10 - 15) / 15; each described as its own account billed it
          expect(infrastructureRows().slice(5, 11)).toEqual([
            ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
            ['example.com', '(Lyon subsidiary)', 'Option DNS Anycast example.com - 1 an',
              '15,00€', '10,00€', '-33,3 %'],
            ['example.org', '(Lyon subsidiary)', 'Renouvellement du domaine example.org - 1 an',
              '15,00€', '0,00€', '-100,0 %'],
            ['example.net', '(yy2222-ovh)', 'Création du domaine example.net - 1 an',
              '0,00€', '18,00€', '—'],
            ['example.com', '(yy2222-ovh)', 'Option DNSSEC example.com - 1 an',
              '0,00€', '7,00€', '—'],
            ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
          ]);
        });

      // Under the key of the Infrastructure tab's list that names the account of each service,
      // for the same resource type and month (ADR 0001)
      it('share the services by account of a month with the Infrastructure tab', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Infrastructure');
        await user.click(resourceType('Dedicated Servers'));
        await settle();
        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30');
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);

        await toggleRow(user, INFRASTRUCTURE, 'Serveurs dédiés');

        // August's, not September's again
        expect(api.fetchResourceTypeDetailsByAccount).toHaveBeenCalledTimes(2);
        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenLastCalledWith('dedicated_server', '2026-08-01', '2026-08-31');
        expect(infrastructureRows().slice(1, 3).map(([identifier, account]) => (
          [identifier, account]
        ))).toEqual([
          ['ns3000003.ip-203-0-113.eu', '(zz3333-ovh)'],
          ['ns3000001.ip-203-0-113.eu', '(Lyon subsidiary)'],
        ]);
      });
    });
  });

  // Each row of the infrastructure and Private Cloud comparisons unfolds into its services,
  // month A against month B (#192)
  describe('rows unfolded into their services (#192)', () => {
    // The rows of a comparison that a chevron folds and unfolds, by their labels: those
    // unfolded, or those folded
    const rowsThatUnfold = (title, unfolded) => within(comparisonTable(title))
      .queryAllByRole('button', { expanded: unfolded })
      .map((button) => texts(button.closest('tr'))[0]);
    // The row of a service of the infrastructure comparison, found by its identifier
    const serviceRow = (identifier) => within(comparisonTable(INFRASTRUCTURE))
      .getByText(identifier).closest('tr');
    const DEDICATED_SERVERS = 'Serveurs dédiés';
    // The row of the dedicated servers
    const dedicatedServersRow = [DEDICATED_SERVERS, '270,00€', '270,00€', '0,0 %'];

    it('start folded, with a chevron on each row that month A or B billed', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, PRIVATE_CLOUD);

      // The dedicated servers and the domains, which August and September billed
      expect(rowsThatUnfold(INFRASTRUCTURE, false)).toEqual([
        'Serveurs dédiés', 'Noms de domaine',
      ]);
      expect(rowsThatUnfold(INFRASTRUCTURE, true)).toEqual([]);
      expect(chevron(INFRASTRUCTURE, 'Noms de domaine')).toHaveAttribute('aria-expanded', 'false');
      // Neither month billed the Private Cloud
      expect(within(comparisonTable(PRIVATE_CLOUD)).queryAllByRole('button')).toEqual([]);
      // Nothing is asked for before a row unfolds
      expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
    });

    it('list the services of a row under it once unfolded, until a second click', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);

      await toggleRow(user, INFRASTRUCTURE, DEDICATED_SERVERS);

      // Those of each month that the Infrastructure tab lists, for all accounts (null), as the
      // instance knows a single one
      for (const { from, to } of [months[1], months[0]]) {
        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('dedicated_server', from, to, null);
      }
      expect(chevron(INFRASTRUCTURE, DEDICATED_SERVERS)).toHaveAttribute('aria-expanded', 'true');
      // The server billed in August and September: its identifier, the description of its most
      // expensive bill line, its cost in months A and B, and the variation
      expect(infrastructureRows().slice(0, 3)).toEqual([
        dedicatedServersRow,
        [
          'ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
          '270,00€', '270,00€', '0,0 %',
        ],
        ['VPS', '0,00€', '0,00€', '—'],
      ]);
      // The whole of its description on hover, which the page may cut to its column
      const description = 'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois';
      expect(within(serviceRow('ns3000001.ip-203-0-113.eu')).getByTitle(description))
        .toHaveTextContent(description);

      await toggleRow(user, INFRASTRUCTURE, DEDICATED_SERVERS);

      expect(chevron(INFRASTRUCTURE, DEDICATED_SERVERS)).toHaveAttribute('aria-expanded', 'false');
      expect(infrastructureRows().slice(0, 2)).toEqual([
        dedicatedServersRow, ['VPS', '0,00€', '0,00€', '—'],
      ]);
    });

    // The domains of August and September, paired by their identifiers. Each month's add up to
    // the row's cost: 30 € in August, 35 € in September.
    it('compare each service that either month billed, from 0 € in a month that did not',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);

        await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');

        // Billed in both months, once, as September billed it: (17 - 15) / 15
        expect(texts(serviceRow('example.com'))).toEqual([
          'example.com', 'Option DNS Anycast example.com - 1 an', '15,00€', '17,00€', '+13,3 %',
        ]);
        // As August billed it, down to nothing in September
        expect(texts(serviceRow('example.org'))).toEqual([
          'example.org', 'Renouvellement du domaine example.org - 1 an',
          '15,00€', '0,00€', '-100,0 %',
        ]);
        // From nothing in August: no variation to compute (#65), and a tooltip that says why
        expect(texts(serviceRow('example.net'))).toEqual([
          'example.net', 'Création du domaine example.net - 1 an', '0,00€', '18,00€', '—',
        ]);
        expect(within(serviceRow('example.net'))
          .getByTitle('non calculable : mois A à 0 € ou moins')).toHaveTextContent('—');
      });

    // As the comparison by project, until the user sorts the table
    it('list the services of a row by month A, the most expensive first, then by month B',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);

        await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');

        // Right under the row of the domains: example.com and example.org cost 15 € each in
        // August, example.com the more in September, then example.net, from nothing in August
        expect(infrastructureRows().slice(5, 10).map(([label]) => label)).toEqual([
          'Noms de domaine', 'example.com', 'example.org', 'example.net', 'Hôtes Private Cloud',
        ]);
      });

    // By the same columns as the rows, each service under its own row (#146)
    it('sort the services within their rows as the table, by any column, each way in turn',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await toggleRow(user, INFRASTRUCTURE, DEDICATED_SERVERS);
        await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');
        const sortBy = (column) => sortTable(user, comparisonTable(INFRASTRUCTURE), column);
        // The rows of the table by their labels, the services by their identifiers
        const labels = () => infrastructureRows().map(([label]) => label);
        // The services right under the row of the domains
        const domains = () => {
          const row = labels().indexOf('Noms de domaine');
          return labels().slice(row + 1, row + 4);
        };
        const SERVER = 'ns3000001.ip-203-0-113.eu';
        // The rows that neither month billed, in the table's order
        const NOTHING_BILLED = [
          'VPS', 'Stockage', 'Load Balancer', 'Adresses IP', 'Hôtes Private Cloud',
          'Datastores Private Cloud',
        ];

        await sortBy(/^Variation/);

        // +16,7 % for the domains, then 0,0 % for the dedicated servers; within the domains,
        // +13,3 %, -100,0 %, then the variation that cannot be computed, last either way
        expect(labels()).toEqual([
          'Noms de domaine', 'example.com', 'example.org', 'example.net',
          DEDICATED_SERVERS, SERVER, ...NOTHING_BILLED,
        ]);

        await sortBy(/^Variation/);

        expect(labels()).toEqual([
          DEDICATED_SERVERS, SERVER,
          'Noms de domaine', 'example.org', 'example.com', 'example.net', ...NOTHING_BILLED,
        ]);

        // By the identifiers of the services, from A to Z first
        await sortBy(/^Type/);

        expect(domains()).toEqual(['example.com', 'example.net', 'example.org']);

        await sortBy(/^Type/);

        expect(domains()).toEqual(['example.org', 'example.net', 'example.com']);

        // 15 € for example.com and for example.org, which keep their order
        await sortBy(/^Août 2026/);

        expect(domains()).toEqual(['example.com', 'example.org', 'example.net']);

        await sortBy(/^Août 2026/);

        expect(domains()).toEqual(['example.net', 'example.com', 'example.org']);

        await sortBy(/^Septembre 2026/);

        expect(domains()).toEqual(['example.net', 'example.com', 'example.org']);
        expect(labels().slice(0, 2)).toEqual([DEDICATED_SERVERS, SERVER]);

        await sortBy(/^Septembre 2026/);

        expect(domains()).toEqual(['example.org', 'example.com', 'example.net']);
        expect(labels().slice(-2)).toEqual([DEDICATED_SERVERS, SERVER]);
      });

    it('stay unfolded when the user picks other months, with their services, and comes back',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');

        await pickMonth(user, 'Août 2026', 'Juillet 2026');

        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('domain', '2026-07-01', '2026-07-31', null);
        // example.fr, renewed in July, then the domains of September, from nothing in July
        const julyAndSeptember = [
          ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
          ['example.fr', 'Renouvellement du domaine example.fr - 1 an',
            '30,00€', '0,00€', '-100,0 %'],
          ['example.net', 'Création du domaine example.net - 1 an', '0,00€', '18,00€', '—'],
          ['example.com', 'Option DNS Anycast example.com - 1 an', '0,00€', '17,00€', '—'],
          ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
        ];
        expect(infrastructureRows().slice(5, 10)).toEqual(julyAndSeptember);

        await openTab(user, "Vue d'ensemble");
        await openTab(user, 'Comparaison');
        // Closed again, as every comparison but the projects' when the tab opens
        await openComparison(user, INFRASTRUCTURE);

        expect(chevron(INFRASTRUCTURE, 'Noms de domaine')).toHaveAttribute('aria-expanded', 'true');
        expect(infrastructureRows().slice(5, 10)).toEqual(julyAndSeptember);
      });

    // Rather than services at 0 € in a month whose answer has yet to arrive
    it('say that the services of a row load until both months have answered', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      const release = holdBack(api.fetchResourceTypeDetails,
        (type, from) => from === '2026-09-01');

      await user.click(chevron(INFRASTRUCTURE, 'Noms de domaine'));

      expect(infrastructureRows().slice(5, 8)).toEqual([
        ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
        ['Chargement des données...'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
      ]);

      release();
      await settle();

      expect(infrastructureRows().slice(6, 9).map(([label]) => label))
        .toEqual(['example.com', 'example.org', 'example.net']);
    });

    // Rather than a month at 0 €, whose services could not load
    it('say when the services of a month could not load', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      failFor(api.fetchResourceTypeDetails, (type, from) => from === '2026-08-01');

      await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');

      expect(infrastructureRows().slice(5, 8)).toEqual([
        ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
        ['Impossible de charger les services de cette ligne.'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
      ]);
    });

    // The hosts of September, which August did not bill: see fixtures/account.js
    it('unfold the rows of the Private Cloud comparison alike, each comparison on its own',
      async () => {
        const { user } = await renderDashboard({ ...account, ...everyResourceType });
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await openComparison(user, PRIVATE_CLOUD);

        await toggleRow(user, PRIVATE_CLOUD, 'Hôtes Private Cloud');

        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('private_cloud_host', '2026-09-01', '2026-09-30', null);
        const hosts = [
          ['Hôtes Private Cloud', '0,00€', '1 450,00€', '—'],
          ['pcc-203-0-113-10/host/1234', 'Host Private Cloud 256 Go pcc-203-0-113-10 - 1 mois',
            '0,00€', '850,00€', '—'],
          ['pcc-203-0-113-10/host/1235', 'Host Private Cloud 96 Go pcc-203-0-113-10 - 1 mois',
            '0,00€', '600,00€', '—'],
        ];
        expect(rowTextsOf(comparisonTable(PRIVATE_CLOUD)).slice(1)).toEqual([
          ...hosts, ['Datastores Private Cloud', '0,00€', '380,00€', '—'],
        ]);
        // The same row of the infrastructure comparison stays folded, until the user unfolds it
        expect(chevron(INFRASTRUCTURE, 'Hôtes Private Cloud'))
          .toHaveAttribute('aria-expanded', 'false');

        await toggleRow(user, INFRASTRUCTURE, 'Hôtes Private Cloud');

        const row = infrastructureRows().findIndex(([label]) => label === 'Hôtes Private Cloud');
        expect(infrastructureRows().slice(row, row + 3)).toEqual(hosts);
        expect(rowsThatUnfold(PRIVATE_CLOUD, true)).toEqual(['Hôtes Private Cloud']);
      });

    // Those of a resource type, month and account are one query, whichever tab asks first
    // (ADR 0001)
    it('share the services of a month with the Infrastructure tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Dedicated Servers'));
      await settle();
      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30', null);
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);

      await toggleRow(user, INFRASTRUCTURE, DEDICATED_SERVERS);

      // August's, not September's again
      expect(api.fetchResourceTypeDetails).toHaveBeenCalledTimes(2);
      expect(api.fetchResourceTypeDetails)
        .toHaveBeenLastCalledWith('dedicated_server', '2026-08-01', '2026-08-31', null);
      expect(texts(serviceRow('ns3000001.ip-203-0-113.eu'))).toEqual([
        'ns3000001.ip-203-0-113.eu',
        'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
        '270,00€', '270,00€', '0,0 %',
      ]);
    });

    // Several accounts in the instance: see fixtures/accounts.js. The rows stay unfolded, and
    // the page closes the comparisons while the months of the account just selected load.
    it('list the services of the account selected in the header', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Comparaison');
      await selectAccount(user, 'Lyon subsidiary');
      await openComparison(user, INFRASTRUCTURE);

      await toggleRow(user, INFRASTRUCTURE, DEDICATED_SERVERS);

      for (const { from, to } of [months[1], months[0]]) {
        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('dedicated_server', from, to, lyonAccount.id);
      }
      // Its server, rented from the end of August: (270 - 70) / 70
      expect(infrastructureRows().slice(0, 2)).toEqual([
        [DEDICATED_SERVERS, '70,00€', '270,00€', '+285,7 %'],
        ['ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
          '70,00€', '270,00€', '+285,7 %'],
      ]);

      // Billed in July only: that month, compared with itself
      await selectAccount(user, 'Compte inconnu');
      await openComparison(user, INFRASTRUCTURE);

      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith('dedicated_server', '2026-07-01', '2026-07-31', 'unknown');
      expect(infrastructureRows().slice(0, 2)).toEqual([
        [DEDICATED_SERVERS, '90,00€', '90,00€', '0,0 %'],
        ['ns3000004.ip-203-0-113.eu',
          'Location du serveur KS-1 ns3000004.ip-203-0-113.eu - 1 mois',
          '90,00€', '90,00€', '0,0 %'],
      ]);

      await selectAccount(user, 'Tous les comptes');
      await openComparison(user, INFRASTRUCTURE);

      // Those of every account, by account, while the lists name the account of each (#194)
      for (const { from, to } of [months[1], months[0]]) {
        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenCalledWith('dedicated_server', from, to);
        expect(api.fetchResourceTypeDetails)
          .not.toHaveBeenCalledWith('dedicated_server', from, to, null);
      }
    });

    // The PDF export prints the page: the unfolded rows print with their services, and without
    // their chevrons, as the headers print without their sort marks (#146)
    it('print unfolded, without their chevrons', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      await toggleRow(user, INFRASTRUCTURE, 'Noms de domaine');
      // Found while they show: the comparison's title prints without its button either
      const table = comparisonTable(INFRASTRUCTURE);
      const chevrons = [
        chevron(INFRASTRUCTURE, DEDICATED_SERVERS), chevron(INFRASTRUCTURE, 'Noms de domaine'),
      ];

      layOutForPrint();

      for (const folding of chevrons) {
        expect(folding).not.toBeVisible();
      }
      expect(within(table).getByText('Noms de domaine')).toBeVisible();
      for (const domain of ['example.com', 'example.org', 'example.net']) {
        expect(within(table).getByText(domain).closest('tr')).toBeVisible();
      }
      expect(within(table).getByText('Option DNS Anycast example.com - 1 an')).toBeVisible();
    });

    // The descriptions stay those of the bills
    it('speak English when the page does', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'en');
      await openTab(user, 'Compare');
      const title = /^Infrastructure Comparison/;
      await openComparison(user, title);
      const englishChevron = (row) => within(comparisonTable(title))
        .getByRole('button', { name: `Services: ${row}` });
      const rows = () => rowTextsOf(comparisonTable(title)).slice(1);
      // August's dedicated servers cannot load
      failFor(api.fetchResourceTypeDetails,
        (type, from) => type === 'dedicated_server' && from === '2026-08-01');

      await user.click(englishChevron('Dedicated Servers'));
      await settle();

      expect(rows()[1]).toEqual(['The services of this row could not be loaded.']);

      const release = holdBack(api.fetchResourceTypeDetails, (type) => type === 'domain');
      await user.click(englishChevron('Domains'));

      expect(rows().slice(6, 8)).toEqual([
        ['Domains', '30.00€', '35.00€', '+16.7%'], ['Loading data...'],
      ]);

      release();
      await settle();

      expect(rows().slice(6, 10)).toEqual([
        ['Domains', '30.00€', '35.00€', '+16.7%'],
        ['example.com', 'Option DNS Anycast example.com - 1 an', '15.00€', '17.00€', '+13.3%'],
        ['example.org', 'Renouvellement du domaine example.org - 1 an',
          '15.00€', '0.00€', '-100.0%'],
        ['example.net', 'Création du domaine example.net - 1 an', '0.00€', '18.00€', '—'],
      ]);
      expect(within(within(comparisonTable(title)).getByText('example.net').closest('tr'))
        .getByTitle('cannot be computed: month A at €0 or below')).toHaveTextContent('—');
    });
  });

  // The two rows of the backup comparison unfold into their services, month A against month B,
  // as the infrastructure comparison's rows do (#197): the Veeam VMs backed up and the Veeam
  // Enterprise licences
  describe('backup rows unfolded into their services (#197)', () => {
    // The rows of the backup comparison, each as the texts it shows, header left out
    const backupRows = () => rowTextsOf(comparisonTable(BACKUP)).slice(1);
    const VMS = 'VMs Veeam Backup';
    const LICENCES = 'Licence Veeam Enterprise';
    // The licence under it, by its identifier
    const LICENCE = enterpriseLicence.domain;
    // The VMs of August and September, as many as the row counts in each month, adding up to its
    // cost: (40 - 25) / 25, (30 - 15) / 15, and one from nothing in August
    const vms = [
      ['vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com',
        '25,00€', '40,00€', '+60,0 %'],
      ['vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com',
        '15,00€', '30,00€', '+100,0 %'],
      ['vm-files-1.example.com', 'Veeam Managed Backup - vm-files-1.example.com',
        '0,00€', '20,00€', '—'],
    ];

    it('unfold into their VMs and licences, asked for once a month for both rows', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, BACKUP);
      // Folded, as before
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
        [VMS, '2 / 40,00€', '3 / 90,00€', '+125,0 %'],
        [LICENCES, '0 / 0,00€', '1 / 25,00€', '—'],
      ]);
      expect(chevron(BACKUP, VMS)).toHaveAttribute('aria-expanded', 'false');
      expect(api.fetchBackupServices).not.toHaveBeenCalled();

      await toggleRow(user, BACKUP, VMS);

      for (const { from, to } of [months[1], months[0]]) {
        expect(api.fetchBackupServices).toHaveBeenCalledWith(from, to, null);
      }
      expect(backupRows()).toEqual([
        [VMS, '2 / 40,00€', '3 / 90,00€', '+125,0 %'],
        ...vms,
        [LICENCES, '0 / 0,00€', '1 / 25,00€', '—'],
      ]);

      await toggleRow(user, BACKUP, LICENCES);

      // The services of both rows came in the same answers
      expect(api.fetchBackupServices).toHaveBeenCalledTimes(2);
      expect(backupRows().slice(-2)).toEqual([
        [LICENCES, '0 / 0,00€', '1 / 25,00€', '—'],
        [LICENCE, 'Veeam Enterprise Plus licence', '0,00€', '25,00€', '—'],
      ]);

      await toggleRow(user, BACKUP, VMS);

      expect(backupRows().map(([label]) => label)).toEqual([VMS, LICENCES, LICENCE]);
    });

    // As the rows of a comparison by project, until the user sorts it: vm-app-1 and vm-db-1
    // cost 20 € each in August, whose answer gives vm-db-1 first, by service, the last first, as
    // the server gives services of the same cost; vm-app-1 the more in September; then
    // vm-files-1, from nothing in August
    it('list the services of a row by month A, the most expensive first, then by month B',
      async () => {
        const [app, db] = account.backupServices['2026-08'].vms;
        const { user } = await renderDashboard({
          ...account,
          backupServices: {
            ...account.backupServices,
            '2026-08': { vms: [{ ...db, total: 20 }, { ...app, total: 20 }], enterprise: [] },
          },
        });
        await openTab(user, 'Comparaison');
        await openComparison(user, BACKUP);

        await toggleRow(user, BACKUP, VMS);

        expect(backupRows().map(([label]) => label)).toEqual([
          VMS, 'vm-app-1.example.com', 'vm-db-1.example.com', 'vm-files-1.example.com', LICENCES,
        ]);
      });

    // July backed nothing up, and August no licence
    it('offer no chevron on a row that neither month billed', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      await pickMonth(user, 'Septembre 2026', 'Août 2026');

      await openComparison(user, BACKUP);

      expect(backupRows()).toEqual([
        [VMS, '0 / 0,00€', '2 / 40,00€', '—'],
        [LICENCES, '0 / 0,00€', '0 / 0,00€', '—'],
      ]);
      expect(chevron(BACKUP, VMS)).toHaveAttribute('aria-expanded', 'false');
      expect(within(comparisonTable(BACKUP))
        .queryByRole('button', { name: `Services : ${LICENCES}` })).not.toBeInTheDocument();
    });

    // Several accounts in the instance: every Veeam backup is yy2222-ovh's. See
    // fixtures/accounts.js.
    describe('with several accounts', () => {
      it('name the account of each service with all accounts shown, asked for by account',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');
          await openComparison(user, BACKUP);

          await toggleRow(user, BACKUP, VMS);

          for (const { from, to } of [months[1], months[0]]) {
            expect(api.fetchBackupServicesByAccount).toHaveBeenCalledWith(from, to);
          }
          expect(api.fetchBackupServices).not.toHaveBeenCalled();
          expect(backupRows().slice(1, 4)).toEqual(vms.map(
            ([identifier, ...rest]) => [identifier, '(yy2222-ovh)', ...rest],
          ));
        });

      // vm-db-1 moved from Lyon to yy2222-ovh during September: 10 € for Lyon, then 20 € for
      // yy2222-ovh, which the server gives after vm-files-1, of the same cost, by service, the
      // last first. The row counts three VMs in September, as the Veeam backups do, and lists
      // four (getBackupServices() in data/db.js).
      it('list a VM that two accounts backed up once for each, which the row counts once',
        async () => {
          const september = severalAccounts.backupServicesByAccount['2026-09'];
          const [app, db, files] = september.vms;
          const { user } = await renderDashboard({
            ...severalAccounts,
            backupServicesByAccount: {
              ...severalAccounts.backupServicesByAccount,
              '2026-09': {
                ...september,
                vms: [
                  app, files, { ...db, total: 20 }, { ...db, total: 10, account: lyonAccount.nic },
                ],
              },
            },
          });
          await openTab(user, 'Comparaison');
          await openComparison(user, BACKUP);

          await toggleRow(user, BACKUP, VMS);

          const description = (vm) => `Veeam Managed Backup - ${vm}`;
          expect(backupRows().slice(0, 6)).toEqual([
            [VMS, '2 / 40,00€', '3 / 90,00€', '+125,0 %'],
            ['vm-app-1.example.com', '(yy2222-ovh)', description('vm-app-1.example.com'),
              '25,00€', '40,00€', '+60,0 %'],
            ['vm-db-1.example.com', '(yy2222-ovh)', description('vm-db-1.example.com'),
              '15,00€', '20,00€', '+33,3 %'],
            ['vm-files-1.example.com', '(yy2222-ovh)', description('vm-files-1.example.com'),
              '0,00€', '20,00€', '—'],
            ['vm-db-1.example.com', '(Lyon subsidiary)', description('vm-db-1.example.com'),
              '0,00€', '10,00€', '—'],
            [LICENCES, '0 / 0,00€', '1 / 25,00€', '—'],
          ]);
        });

      it('list the services of the account selected, and none of an account without backups',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Comparaison');
          await selectAccount(user, 'yy2222-ovh');
          await openComparison(user, BACKUP);

          await toggleRow(user, BACKUP, LICENCES);

          for (const { from, to } of [months[1], months[0]]) {
            expect(api.fetchBackupServices).toHaveBeenCalledWith(from, to, unnamedAccount.id);
          }
          expect(backupRows().slice(-1)).toEqual([
            [LICENCE, 'Veeam Enterprise Plus licence', '0,00€', '25,00€', '—'],
          ]);

          await selectAccount(user, 'Lyon subsidiary');
          await openComparison(user, BACKUP);

          expect(backupRows()).toEqual([
            [VMS, '0 / 0,00€', '0 / 0,00€', '—'],
            [LICENCES, '0 / 0,00€', '0 / 0,00€', '—'],
          ]);
          expect(within(comparisonTable(BACKUP)).queryAllByRole('button')).toEqual([]);
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

    // Rather than a month at 0 €, the symptom of #181
    it('say that they could not load when the products of a month fail', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      failFor(api.fetchProjectProducts, (projectId, from) => from === '2026-08-01');

      await openComparison(user, PRODUCTION_PRODUCTS);

      expect(within(comparison(PRODUCTION_PRODUCTS))
        .getByText('Impossible de charger le détail de ce projet.')).toBeInTheDocument();
      expect(comparisonTable(PRODUCTION_PRODUCTS)).not.toBeInTheDocument();
    });

    // A credit pays for no product (CONTEXT.md), as on the Public Cloud tab
    it('show the credit that the bills used apart, after the products', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      await openComparison(user, PRODUCTION_PRODUCTS);

      // July's products add up to 715 €, and with its credit to Production's 680 € in the
      // comparison by project. There is no variation of a credit to compute (#65).
      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
        ['Produit○', 'Juillet 2026○', 'Septembre 2026○', 'Variation○'],
        // (538.90 - 650) / 650
        ['Instances', '650,00€', '538,90€', '-17,1 %'],
        ['Bases de données', '45,00€', '0,00€', '-100,0 %'],
        ['Stockage objet', '20,00€', '25,00€', '+25,0 %'],
        ['Savings plans', '0,00€', '28,00€', '—'],
        ['Volumes', '0,00€', '12,50€', '—'],
        ['Snapshots', '0,00€', '6,00€', '—'],
        ['Crédit Cloud utilisé', '-35,00€', '0,00€', ''],
      ]);

      // The least expensive in July first: the credit stays last
      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Juillet 2026/);
      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Juillet 2026/);

      expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS)).slice(-3)).toEqual([
        ['Bases de données', '45,00€', '0,00€', '-100,0 %'],
        ['Instances', '650,00€', '538,90€', '-17,1 %'],
        ['Crédit Cloud utilisé', '-35,00€', '0,00€', ''],
      ]);

      await selectLanguage(user, 'en');

      expect(rowsOf(comparisonTable(/^Production \(Project\)/)).at(-1))
        .toEqual(['Cloud credit used', '-35.00€', '0.00€', '']);
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

  // Each product of a project's comparison unfolds into its charges, month A against month B,
  // which come with the products that the comparison loads (#195). See fixtures/public-cloud.js.
  describe('products unfolded into their charges (#195)', () => {
    // The chevron of a product of Production's comparison, found by the product that it names
    const chevron = (product) => within(comparisonTable(PRODUCTION_PRODUCTS))
      .getByRole('button', { name: `Charges : ${product}` });
    // The products that a chevron folds and unfolds, by their labels: those unfolded, or those
    // folded
    const productsThatUnfold = (unfolded) => within(comparisonTable(PRODUCTION_PRODUCTS))
      .queryAllByRole('button', { expanded: unfolded })
      .map((button) => texts(button.closest('tr'))[0]);
    // Unfolds or folds a product with a click on its chevron, as the user does
    const toggleProduct = async (user, product) => {
      await user.click(chevron(product));
      await settle();
    };
    // The rows of Production's comparison, header left out, each as the texts of its cells
    const productRows = () => rowsOf(comparisonTable(PRODUCTION_PRODUCTS)).slice(1);
    // The row of a charge of Production's comparison, found by the charge
    const chargeRow = (charge) => within(comparisonTable(PRODUCTION_PRODUCTS))
      .getByText(charge).closest('tr');

    it('start folded, with a chevron on each product, and none on the credit', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      // July, whose bills used a credit
      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      await openComparison(user, PRODUCTION_PRODUCTS);

      expect(productsThatUnfold(false)).toEqual([
        'Instances', 'Bases de données', 'Stockage objet', 'Savings plans', 'Volumes', 'Snapshots',
      ]);
      expect(productsThatUnfold(true)).toEqual([]);
      expect(chevron('Instances')).toHaveAttribute('aria-expanded', 'false');
      // The credit pays for no product: it has no charge to unfold into
      const credit = within(comparisonTable(PRODUCTION_PRODUCTS))
        .getByText('Crédit Cloud utilisé').closest('tr');
      expect(within(credit).queryByRole('button')).not.toBeInTheDocument();
    });

    // The charges of August and September, which add up to the product's cost in each month
    it('list the charges of a product under it once unfolded, until a second click', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, PRODUCTION_PRODUCTS);

      await toggleProduct(user, 'Stockage objet');

      expect(chevron('Stockage objet')).toHaveAttribute('aria-expanded', 'true');
      // Each charge, its cost in months A and B, and the variation: (14 - 13.90) / 13.90
      expect(productRows().slice(2, 7)).toEqual([
        ['Stockage objet', '24,90€', '25,00€', '+0,4 %'],
        ['Stockage Standard - Bucket assets-example-com sur la région gra',
          '13,90€', '14,00€', '+0,7 %'],
        ['Stockage Cold Archive', '9,00€', '9,00€', '0,0 %'],
        ['Stockage Standard - Bucket old-exports sur la région sbg',
          '2,00€', '2,00€', '0,0 %'],
        ['Volumes', '12,50€', '12,50€', '0,0 %'],
      ]);

      await toggleProduct(user, 'Stockage objet');

      expect(chevron('Stockage objet')).toHaveAttribute('aria-expanded', 'false');
      expect(productRows().slice(2, 4)).toEqual([
        ['Stockage objet', '24,90€', '25,00€', '+0,4 %'],
        ['Volumes', '12,50€', '12,50€', '0,0 %'],
      ]);
    });

    // Production's instances of August and September, paired by charge
    it('compare each charge that either month billed, from 0 € in a month that did not',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, PRODUCTION_PRODUCTS);

        await toggleProduct(user, 'Instances');

        // Billed in both months: (420.50 - 304.60) / 304.60
        expect(texts(chargeRow(hourlyUse('l4-90'))))
          .toEqual([hourlyUse('l4-90'), '304,60€', '420,50€', '+38,0 %']);
        // Billed in August only, down to nothing in September
        expect(texts(chargeRow(hourlyUse('d2-4'))))
          .toEqual([hourlyUse('d2-4'), '8,00€', '0,00€', '-100,0 %']);
        // From nothing in August: no variation to compute (#65), and a tooltip that says why
        expect(texts(chargeRow(hourlyUse('b3-16'))))
          .toEqual([hourlyUse('b3-16'), '0,00€', '6,40€', '—']);
        expect(within(chargeRow(hourlyUse('b3-16')))
          .getByTitle('non calculable : mois A à 0 € ou moins')).toHaveTextContent('—');
      });

    // As the comparison by project, until the user sorts the table
    it('list the charges of a product by month A, the most expensive first, then by month B',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, PRODUCTION_PRODUCTS);

        await toggleProduct(user, 'Instances');

        // Right under the instances: db-1's monthly plan and the web instances' hourly use cost
        // 64 € each in August, the monthly plan the more in September; the b3-16's, from nothing
        // in August, last
        expect(productRows().slice(0, 7).map(([name]) => name)).toEqual([
          'Instances', hourlyUse('l4-90'), DB_1_PLAN, hourlyUse('b3-8'), hourlyUse('d2-4'),
          hourlyUse('b3-16'), 'Savings plans',
        ]);
      });

    // By the same columns as the products, each charge under its own product (#146)
    it('sort the charges within their products as the table, by any column, each way in turn',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, PRODUCTION_PRODUCTS);
        await toggleProduct(user, 'Instances');
        await toggleProduct(user, 'Stockage objet');
        const sortBy = (column) => sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), column);
        // The rows of the table by their names: the products, and their charges under them
        const names = () => productRows().map(([name]) => name);
        // The charges right under the instances
        const instances = () => {
          const row = names().indexOf('Instances');
          return names().slice(row + 1, row + 6);
        };
        // The charges of the object storage: a bucket that cost more in September, the Cold
        // Archive, and a bucket that cost as much
        const ASSETS = bucketStorage('assets-example-com', 'gra');
        const OLD_EXPORTS = bucketStorage('old-exports', 'sbg');

        await sortBy(/^Variation/);

        // +22,3 % for the instances, +0,4 % for the object storage, then the products of 0,0 %;
        // within the instances, +38,0 %, 0,0 %, -25,0 %, -100,0 %, then the variation that
        // cannot be computed, last either way
        expect(names()).toEqual([
          'Instances', hourlyUse('l4-90'), DB_1_PLAN, hourlyUse('b3-8'), hourlyUse('d2-4'),
          hourlyUse('b3-16'),
          'Stockage objet', ASSETS, COLD_ARCHIVE, OLD_EXPORTS,
          'Savings plans', 'Volumes', 'Snapshots',
        ]);

        await sortBy(/^Variation/);

        expect(names()).toEqual([
          'Savings plans', 'Volumes', 'Snapshots',
          'Stockage objet', COLD_ARCHIVE, OLD_EXPORTS, ASSETS,
          'Instances', hourlyUse('d2-4'), hourlyUse('b3-8'), DB_1_PLAN, hourlyUse('l4-90'),
          hourlyUse('b3-16'),
        ]);

        // By the charges themselves, from A to Z first
        await sortBy(/^Produit/);

        expect(instances()).toEqual([
          hourlyUse('b3-8'), hourlyUse('b3-16'), hourlyUse('d2-4'), hourlyUse('l4-90'), DB_1_PLAN,
        ]);

        await sortBy(/^Produit/);

        expect(instances()).toEqual([
          DB_1_PLAN, hourlyUse('l4-90'), hourlyUse('d2-4'), hourlyUse('b3-16'), hourlyUse('b3-8'),
        ]);

        // 64 € for db-1's monthly plan and for the web instances' hourly use, which keep their
        // order
        await sortBy(/^Août 2026/);

        expect(instances()).toEqual([
          hourlyUse('l4-90'), DB_1_PLAN, hourlyUse('b3-8'), hourlyUse('d2-4'), hourlyUse('b3-16'),
        ]);

        await sortBy(/^Août 2026/);

        expect(instances()).toEqual([
          hourlyUse('b3-16'), hourlyUse('d2-4'), DB_1_PLAN, hourlyUse('b3-8'), hourlyUse('l4-90'),
        ]);

        await sortBy(/^Septembre 2026/);

        expect(instances()).toEqual([
          hourlyUse('l4-90'), DB_1_PLAN, hourlyUse('b3-8'), hourlyUse('b3-16'), hourlyUse('d2-4'),
        ]);

        await sortBy(/^Septembre 2026/);

        expect(instances()).toEqual([
          hourlyUse('d2-4'), hourlyUse('b3-16'), hourlyUse('b3-8'), DB_1_PLAN, hourlyUse('l4-90'),
        ]);
      });

    it('stay unfolded when the user picks other months, with their charges, and comes back',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Comparaison');
        await openComparison(user, PRODUCTION_PRODUCTS);
        await toggleProduct(user, 'Instances');

        await pickMonth(user, 'Août 2026', 'Juillet 2026');

        // The GPU instance of July, gone by September, then db-1's monthly plan and the web
        // instances' hourly use, 64 € each in July, then the charges of September only
        const julyAndSeptember = [
          ['Instances', '650,00€', '538,90€', '-17,1 %'],
          [hourlyUse('t2-45'), '522,00€', '0,00€', '-100,0 %'],
          [DB_1_PLAN, '64,00€', '64,00€', '0,0 %'],
          [hourlyUse('b3-8'), '64,00€', '48,00€', '-25,0 %'],
          [hourlyUse('l4-90'), '0,00€', '420,50€', '—'],
          [hourlyUse('b3-16'), '0,00€', '6,40€', '—'],
          ['Bases de données', '45,00€', '0,00€', '-100,0 %'],
        ];
        expect(productRows().slice(0, 7)).toEqual(julyAndSeptember);

        await openTab(user, "Vue d'ensemble");
        await openTab(user, 'Comparaison');
        // Closed again, as every comparison but the projects' when the tab opens
        await openComparison(user, PRODUCTION_PRODUCTS);

        expect(chevron('Instances')).toHaveAttribute('aria-expanded', 'true');
        expect(productRows().slice(0, 7)).toEqual(julyAndSeptember);
        // Each project's products unfold on their own: Staging's instances stay folded
        await openComparison(user, /^Staging \(Projet\)/);
        expect(within(comparisonTable(/^Staging \(Projet\)/))
          .getByRole('button', { name: 'Charges : Instances' }))
          .toHaveAttribute('aria-expanded', 'false');
      });

    // The charges come with the products that the comparison loads when it opens
    it('ask for nothing when a product unfolds', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, PRODUCTION_PRODUCTS);
      // The requests that the page sent so far
      const requestsSent = () => Object.values(api)
        .reduce((count, request) => count + request.mock.calls.length, 0);
      const sent = requestsSent();

      await toggleProduct(user, 'Instances');

      expect(chargeRow(hourlyUse('l4-90'))).toBeInTheDocument();
      expect(requestsSent()).toBe(sent);
    });

    // The PDF export prints the page: the unfolded products print with their charges, and
    // without their chevrons, as the headers print without their sort marks (#146)
    it('print unfolded, without their chevrons', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await openComparison(user, PRODUCTION_PRODUCTS);
      await toggleProduct(user, 'Instances');
      // Found while they show: the comparison's title prints without its button either
      const table = comparisonTable(PRODUCTION_PRODUCTS);
      const chevrons = [chevron('Instances'), chevron('Stockage objet')];

      layOutForPrint();

      for (const folding of chevrons) {
        expect(folding).not.toBeVisible();
      }
      expect(within(table).getByText('Instances')).toBeVisible();
      for (const flavor of ['l4-90', 'b3-8', 'd2-4', 'b3-16']) {
        expect(within(table).getByText(hourlyUse(flavor)).closest('tr')).toBeVisible();
      }
      expect(within(table).getByText(DB_1_PLAN)).toBeVisible();
    });

    // The charges stay as the bills word them
    it('speak English when the page does', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'en');
      await openTab(user, 'Compare');
      const title = /^Production \(Project\)/;
      await openComparison(user, title);

      await user.click(within(comparisonTable(title))
        .getByRole('button', { name: 'Charges: Object storage' }));
      await settle();

      expect(rowsOf(comparisonTable(title)).slice(3, 8)).toEqual([
        ['Object storage', '24.90€', '25.00€', '+0.4%'],
        ['Stockage Standard - Bucket assets-example-com sur la région gra',
          '13.90€', '14.00€', '+0.7%'],
        ['Stockage Cold Archive', '9.00€', '9.00€', '0.0%'],
        ['Stockage Standard - Bucket old-exports sur la région sbg', '2.00€', '2.00€', '0.0%'],
        ['Volumes', '12.50€', '12.50€', '0.0%'],
      ]);
    });

    // Several accounts in the instance: see fixtures/accounts.js. Staging, billed to yy2222-ovh,
    // and in September to Lyon too, whose bills charged it 50 € of a b3-16's hourly use (#181)
    it('unfold into the charges of the bills of the account selected', async () => {
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
                projectId: 'project-staging', projectName: 'Staging', total: 50, detailsCount: 1,
              }],
            },
            projectProducts: {
              ...lyon.projectProducts,
              'project-staging': {
                '2026-09': billedProducts(50, [['instances', 50, [[hourlyUse('b3-16'), 50]]]]),
              },
            },
          },
        },
      });
      await openTab(user, 'Comparaison');
      await selectAccount(user, 'Lyon subsidiary');
      const staging = /^Staging \(Projet\)/;
      await openComparison(user, staging);

      await user.click(within(comparisonTable(staging))
        .getByRole('button', { name: 'Charges : Instances' }));
      await settle();

      // Not the 150 € and 180 € that yy2222-ovh's bills charged it
      expect(rowsOf(comparisonTable(staging))).toEqual([
        ['Produit○', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
        ['Instances', '0,00€', '50,00€', '—'],
        [hourlyUse('b3-16'), '0,00€', '50,00€', '—'],
      ]);
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
        'Projeter le mois en cours',
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

  // Rather than compare a partial month with a complete one (#216): "—", with a tooltip that
  // says why, as for a variation from month A at 0 € or less (#65)
  describe('variations with the month in progress (#216)', () => {
    const whyNotComputed = 'non calculable : mois en cours';

    it('are not computed for the totals, saying why', async () => {
      const { user } = await renderDashboard({ ...account, ...septemberInProgress });

      await openTab(user, 'Comparaison');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026 (en cours)',
        'Projeter le mois en cours',
        '1 042,00€', 'Août 2026', '—', '1 250,40€', 'Septembre 2026',
      ]);
      expect(within(comparedTotals()).getByTitle(whyNotComputed)).toHaveTextContent('—');

      await selectLanguage(user, 'en');

      expect(within(comparedTotals()).getByTitle('cannot be computed: month in progress'))
        .toHaveTextContent('—');
    });

    it('are computed between two complete months, and not from the month in progress',
      async () => {
        const { user } = await renderDashboard({ ...account, ...septemberInProgress });
        await openTab(user, 'Comparaison');

        await pickMonth(user, 'Août 2026', 'Juillet 2026');
        await pickMonth(user, 'Septembre 2026 (en cours)', 'Août 2026');

        // (1 042 - 980) / 980
        expect(texts(comparedTotals()).slice(6)).toEqual([
          '980,00€', 'Juillet 2026', '+6,3 %', '1 042,00€', 'Août 2026',
        ]);
        expect(rowsOf(comparisonTable(PROJECTS))[1]).toEqual([
          'Production', '680,00€', '512,00€', '-24,7 %',
        ]);

        // Month A in progress
        await pickMonth(user, 'Juillet 2026', 'Septembre 2026 (en cours)');

        expect(texts(comparedTotals()).slice(6)).toEqual([
          '1 250,40€', 'Septembre 2026', '—', '1 042,00€', 'Août 2026',
        ]);
        expect(within(comparedTotals()).getByTitle(whyNotComputed)).toHaveTextContent('—');
      });

    it('are not computed in any comparison, saying why', async () => {
      const { user } = await renderDashboard({ ...account, ...septemberInProgress });
      await openTab(user, 'Comparaison');

      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, BACKUP);
      await openComparison(user, PRIVATE_CLOUD);

      // Neither +19,2 % for Production nor +15,8 % for Staging
      expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '512,00€', '610,40€', '—'],
        ['Staging', '190,00€', '220,00€', '—'],
      ]);
      expect(infrastructureRows().map((row) => row.slice(-3))).toEqual([
        // The dedicated servers: not 0,0 %
        ['270,00€', '270,00€', '—'],
        ['0,00€', '0,00€', '—'],
        ['0,00€', '0,00€', '—'],
        ['0,00€', '0,00€', '—'],
        ['0,00€', '0,00€', '—'],
        // The domains: not +16,7 %
        ['30,00€', '35,00€', '—'],
        ['0,00€', '0,00€', '—'],
        ['0,00€', '0,00€', '—'],
      ]);
      // The VMs backed up: not +125,0 %
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['VMs Veeam Backup', '2 / 40,00€', '3 / 90,00€', '—'],
        ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', '—'],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
        ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
      ]);
      // The month in progress is why, even from month A at 0 €
      for (const title of [PROJECTS, INFRASTRUCTURE, BACKUP, PRIVATE_CLOUD]) {
        for (const variation of within(comparisonTable(title)).getAllByText('—')) {
          expect(variation).toHaveAttribute('title', whyNotComputed);
        }
      }
    });

    it('are not computed for the services, products and charges that rows unfold into',
      async () => {
        const { user } = await renderDashboard({ ...account, ...septemberInProgress });
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await openComparison(user, PRODUCTION_PRODUCTS);

        await toggleRow(user, INFRASTRUCTURE, 'Serveurs dédiés');
        await user.click(within(comparisonTable(PRODUCTION_PRODUCTS))
          .getByRole('button', { name: 'Charges : Stockage objet' }));
        await settle();

        // The server billed in August and September: not 0,0 %
        expect(infrastructureRows()[1]).toEqual([
          'ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
          '270,00€', '270,00€', '—',
        ]);
        // Production's products, and the charges of its object storage: not +22,3 % for its
        // instances, nor +0,7 % for a bucket
        expect(rowsOf(comparisonTable(PRODUCTION_PRODUCTS)).slice(1)).toEqual([
          ['Instances', '440,60€', '538,90€', '—'],
          ['Savings plans', '28,00€', '28,00€', '—'],
          ['Stockage objet', '24,90€', '25,00€', '—'],
          ['Stockage Standard - Bucket assets-example-com sur la région gra',
            '13,90€', '14,00€', '—'],
          ['Stockage Cold Archive', '9,00€', '9,00€', '—'],
          ['Stockage Standard - Bucket old-exports sur la région sbg',
            '2,00€', '2,00€', '—'],
          ['Volumes', '12,50€', '12,50€', '—'],
          ['Snapshots', '6,00€', '6,00€', '—'],
        ]);
        for (const title of [INFRASTRUCTURE, PRODUCTION_PRODUCTS]) {
          for (const variation of within(comparisonTable(title)).getAllByText('—')) {
            expect(variation).toHaveAttribute('title', whyNotComputed);
          }
        }
      });

    // As rows whose variation cannot be computed do (#146): a table keeps its own order, rather
    // than follow values that it does not show
    it('leave the rows in their order when the user sorts them by variation', async () => {
      const { user } = await renderDashboard({
        ...account, ...threeBilledProjects, ...septemberInProgress,
      });
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      await openComparison(user, PRODUCTION_PRODUCTS);

      await sortTable(user, comparisonTable(PROJECTS), /^Variation/);
      await sortTable(user, comparisonTable(INFRASTRUCTURE), /^Variation/);
      await sortTable(user, comparisonTable(PRODUCTION_PRODUCTS), /^Variation/);

      // Not Staging first, whose cost grows the most
      expect(firstColumnOf(comparisonTable(PROJECTS)))
        .toEqual(['Production', 'Sandbox', 'Staging']);
      // Not the domains first, which cost more in September
      expect(firstColumnOf(comparisonTable(INFRASTRUCTURE))).toEqual([
        'Serveurs dédiés', 'VPS', 'Stockage', 'Load Balancer', 'Adresses IP', 'Noms de domaine',
        'Hôtes Private Cloud', 'Datastores Private Cloud',
      ]);
      // Nor the object storage before the savings plans
      expect(firstColumnOf(comparisonTable(PRODUCTION_PRODUCTS))).toEqual([
        'Instances', 'Savings plans', 'Stockage objet', 'Volumes', 'Snapshots',
      ]);
    });
  });

  // The month in progress at its projected cost, while the page projects it (#218): see
  // fixtures/compare.js, where September has not billed its dedicated server and the backups of
  // two VMs yet. One setting for the whole page, as the Trends tab's (#217).
  describe('projection of the month in progress (#218)', () => {
    const billedLate = { ...account, ...septemberInProgress, ...serverAndBackupsBilledLate };
    // The months that the tab asks for, as their requests name them, for all accounts
    const SEPTEMBER = ['2026-09-01', '2026-09-30', null];
    const AUGUST = ['2026-08-01', '2026-08-31', null];
    const JULY = ['2026-07-01', '2026-07-31', null];
    const PROJECTED = { projected: true };
    // What the tab asks for each month: its totals, its service types, its resource types and
    // its Veeam backups
    const figures = () => [
      api.fetchSummary, api.fetchByService, api.fetchByResourceType, api.fetchBackupStats,
    ];
    const projectionAsked = (fetchFigure) => fetchFigure.mock.calls
      .some((call) => call.at(-1)?.projected === true);
    const whyNotComputed = 'non calculable : mois en cours';

    it('offers to project it next to months A and B, off by default', async () => {
      const { user } = await renderDashboard(billedLate);

      await openTab(user, 'Comparaison');

      expect(within(comparedTotals()).getByRole('checkbox'))
        .toHaveAccessibleName('Projeter le mois en cours');
      expect(projectionCheckbox()).not.toBeChecked();

      await selectLanguage(user, 'en');

      expect(projectionCheckbox()).toHaveAccessibleName('Project the month in progress');
    });

    it('asks for the figures of the month in progress projected once ticked, and those only',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Comparaison');
        for (const fetchFigure of figures()) expect(projectionAsked(fetchFigure)).toBe(false);

        await toggleProjection(user);

        for (const fetchFigure of figures()) {
          expect(fetchFigure).toHaveBeenCalledWith(...SEPTEMBER, PROJECTED);
          expect(fetchFigure).not.toHaveBeenCalledWith(...AUGUST, PROJECTED);
        }
        // Not the projects, which compare what the month billed so far until #219
        expect(projectionAsked(api.fetchByProject)).toBe(false);
      });

    // Rather than compare a partial month with a complete one, or leave the variation out
    it('shows the totals of the month in progress at its projected cost, marked so', async () => {
      const { user } = await renderDashboard(billedLate);
      await openTab(user, 'Comparaison');
      // What September billed so far, without a variation
      expect(texts(comparedTotals()).slice(6)).toEqual([
        '1 042,00€', 'Août 2026', '—', '910,40€', 'Septembre 2026',
      ]);
      expect(within(comparedTotals()).getByTitle(whyNotComputed)).toHaveTextContent('—');

      await toggleProjection(user);

      // With the server and the backups at their cost of August: (1 220.40 - 1 042) / 1 042
      expect(texts(comparedTotals()).slice(6)).toEqual([
        '1 042,00€', 'Août 2026', '+17,1 %', '1 220,40€', 'projeté', 'Septembre 2026',
      ]);
      expect(inItalics(within(comparedTotals()).getByText('1 220,40€'))).toBe(true);
      expect(within(comparedTotals()).getByTitle('facturé 910,40€, projeté 1 220,40€'))
        .toHaveTextContent('1 220,40€ projeté');
      // August, complete, as it was
      expect(inItalics(within(comparedTotals()).getByText('1 042,00€'))).toBe(false);

      await toggleProjection(user);

      expect(texts(comparedTotals()).slice(6)).toEqual([
        '1 042,00€', 'Août 2026', '—', '910,40€', 'Septembre 2026',
      ]);
    });

    it('shows the infrastructure and backup comparisons at the projected cost, marked so',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await openComparison(user, BACKUP);
        // The server, not billed yet in September, and no variation
        expect(infrastructureRows()[0]).toEqual(['Serveurs dédiés', '270,00€', '0,00€', '—']);
        expect(rowsOf(comparisonTable(BACKUP))[1])
          .toEqual(['VMs Veeam Backup', '2 / 40,00€', '1 / 20,00€', '—']);

        await toggleProjection(user);

        // The server at its cost of August; the domains, billed, as they were
        expect(infrastructureRows()).toEqual([
          ['Serveurs dédiés', '270,00€', '270,00€', 'projeté', '0,0 %'],
          ['VPS', '0,00€', '0,00€', '—'],
          ['Stockage', '0,00€', '0,00€', '—'],
          ['Load Balancer', '0,00€', '0,00€', '—'],
          ['Adresses IP', '0,00€', '0,00€', '—'],
          ['Noms de domaine', '30,00€', '35,00€', '+16,7 %'],
          ['Hôtes Private Cloud', '0,00€', '0,00€', '—'],
          ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
        ]);
        expect(within(comparisonTable(INFRASTRUCTURE))
          .getByTitle('facturé 0,00€, projeté 270,00€')).toHaveTextContent('270,00€ projeté');
        // The two VMs at their cost of August, 25 € and 15 €, with the one billed
        expect(rowsOf(comparisonTable(BACKUP))).toEqual([
          ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
          ['VMs Veeam Backup', '2 / 40,00€', '3 / 60,00€ projeté', '+50,0 %'],
          ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', '—'],
        ]);
        const vms = within(comparisonTable(BACKUP)).getByTitle('facturé 20,00€, projeté 60,00€');
        expect(vms).toHaveTextContent('60,00€ projeté');
        expect(inItalics(within(vms).getByText('60,00€'))).toBe(true);
      });

    it('marks projeté the services that rows unfold into and that the month did not bill yet',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Comparaison');
        await openComparison(user, INFRASTRUCTURE);
        await openComparison(user, BACKUP);
        await toggleProjection(user);

        await toggleRow(user, INFRASTRUCTURE, 'Serveurs dédiés');
        await toggleRow(user, BACKUP, 'VMs Veeam Backup');

        expect(infrastructureRows()[1]).toEqual([
          'ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
          '270,00€', '270,00€', 'projeté', '0,0 %',
        ]);
        expect(within(comparisonTable(INFRASTRUCTURE)).getAllByTitle(
          'facturé 0,00€, projeté 270,00€',
        )).toHaveLength(2);
        // The VM added in September, billed, from 0 € in August
        expect(rowTextsOf(comparisonTable(BACKUP)).slice(2, 5)).toEqual([
          ['vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com',
            '25,00€', '25,00€', 'projeté', '0,0 %'],
          ['vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com',
            '15,00€', '15,00€', 'projeté', '0,0 %'],
          ['vm-files-1.example.com', 'Veeam Managed Backup - vm-files-1.example.com',
            '0,00€', '20,00€', '—'],
        ]);
        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('dedicated_server', ...SEPTEMBER, PROJECTED);
        expect(api.fetchResourceTypeDetails)
          .not.toHaveBeenCalledWith('dedicated_server', ...AUGUST, PROJECTED);
        expect(api.fetchBackupServices).toHaveBeenCalledWith(...SEPTEMBER, PROJECTED);
        expect(api.fetchBackupServices).not.toHaveBeenCalledWith(...AUGUST, PROJECTED);
      });

    // Only what the Private Cloud comparison reads: a host billed in August, whose bill of
    // September has not come yet
    it('shows the Private Cloud comparison at the projected cost, marked so', async () => {
      const hosts = (value) => ({
        name: 'Private Cloud Hosts', resource_type: 'private_cloud_host', color: '#9333ea',
        value, detailsCount: 1, serviceCount: 1,
      });
      const host = {
        domain: 'pcc-203-0-113-10/host/1234',
        description: 'Host Private Cloud 256 Go pcc-203-0-113-10 - 1 mois',
        total: 850,
        line_count: 1,
      };
      const { user } = await renderDashboard({
        ...billedLate,
        byResourceType: {
          ...billedLate.byResourceType,
          '2026-08': [...billedLate.byResourceType['2026-08'], hosts(850)],
        },
        projectedByResourceType: {
          '2026-09': [
            ...billedLate.projectedByResourceType['2026-09'], { ...hosts(850), projected: 850 },
          ],
        },
        resourceTypeDetails: {
          ...billedLate.resourceTypeDetails, private_cloud_host: { '2026-08': [host] },
        },
        projectedResourceTypeDetails: {
          ...billedLate.projectedResourceTypeDetails,
          private_cloud_host: { '2026-09': [{ ...host, projected: 850 }] },
        },
      });
      await openTab(user, 'Comparaison');
      await openComparison(user, PRIVATE_CLOUD);
      await toggleProjection(user);

      await toggleRow(user, PRIVATE_CLOUD, 'Hôtes Private Cloud');

      expect(rowTextsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['Hôtes Private Cloud', '850,00€', '850,00€', 'projeté', '0,0 %'],
        [host.domain, host.description, '850,00€', '850,00€', 'projeté', '0,0 %'],
        ['Datastores Private Cloud', '0,00€', '0,00€', '—'],
      ]);
    });

    // Until they project it too (#219): what September billed them so far, compared with no
    // variation, as without the projection
    it('leaves the projects as September billed them so far, without a variation', async () => {
      const { user } = await renderDashboard(billedLate);
      await openTab(user, 'Comparaison');

      await toggleProjection(user);

      expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '512,00€', '610,40€', '—'],
        ['Staging', '190,00€', '220,00€', '—'],
      ]);
      for (const variation of within(comparisonTable(PROJECTS)).getAllByText('—')) {
        expect(variation).toHaveAttribute('title', whyNotComputed);
      }
    });

    // Whichever of months A and B it is, and never a complete month
    it('projects only the month in progress, month A or month B', async () => {
      const { user } = await renderDashboard(billedLate);
      await openTab(user, 'Comparaison');
      await toggleProjection(user);

      // August and July, complete
      await pickMonth(user, 'Septembre 2026 (en cours)', 'Juillet 2026');

      // (980 - 1 042) / 1 042
      expect(texts(comparedTotals()).slice(6)).toEqual([
        '1 042,00€', 'Août 2026', '-6,0 %', '980,00€', 'Juillet 2026',
      ]);
      for (const fetchFigure of figures()) {
        expect(fetchFigure).toHaveBeenCalledWith(...JULY);
        expect(fetchFigure).not.toHaveBeenCalledWith(...JULY, PROJECTED);
      }

      // September, month A, and July: (980 - 1 220.40) / 1 220.40
      await pickMonth(user, 'Août 2026', 'Septembre 2026 (en cours)');

      expect(texts(comparedTotals()).slice(6)).toEqual([
        '1 220,40€', 'projeté', 'Septembre 2026', '-19,7 %', '980,00€', 'Juillet 2026',
      ]);
    });

    it('speaks English when the page does', async () => {
      const { user } = await renderDashboard(billedLate);
      await openTab(user, 'Comparaison');
      await openComparison(user, INFRASTRUCTURE);
      await toggleProjection(user);

      await selectLanguage(user, 'en');

      expect(texts(comparedTotals())).toEqual([
        'Month A :', 'August 2026', 'VS', 'Month B :', 'September 2026 (in progress)',
        'Project the month in progress',
        '1,042.00€', 'August 2026', '+17.1%', '1,220.40€', 'projected', 'September 2026',
      ]);
      expect(within(comparedTotals()).getByTitle('billed 910.40€, projected 1,220.40€'))
        .toHaveTextContent('1,220.40€ projected');
      expect(within(comparisonTable(/^Infrastructure Comparison/))
        .getByTitle('billed 0.00€, projected 270.00€')).toHaveTextContent('270.00€ projected');
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
      expect(texts(comparedTotals()).slice(6)).toEqual([
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
      'Project the month in progress',
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
    // The label of each row, its first text
    const infrastructureTypes = rowTextsOf(comparisonTable(/^Infrastructure Comparison/))
      .map(([type]) => type);
    expect(infrastructureTypes).toEqual([
      'Type',
      'Dedicated Servers',
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
          'Projeter le mois en cours',
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
      // A and B and the variation between them
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
          'Projeter le mois en cours',
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
          ['Serveurs dédiés', '70,00€', '270,00€', '+285,7 %'],
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
          'Projeter le mois en cours',
          '230,00€', 'Août 2026', '+56,5 %', '360,00€', 'Septembre 2026',
        ]);
        expect(rowsOf(comparisonTable(PROJECTS))).toEqual([
          ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
          ['Staging', '190,00€', '220,00€', '+15,8 %'],
        ]);
        expect(projectComparisons()).toEqual(['Staging (Projet)']);
        expect(infrastructureCosts()).toEqual([
          nothingIn('Serveurs dédiés'),
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
          'Projeter le mois en cours',
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
          'Projeter le mois en cours',
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
