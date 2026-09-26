import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, everyResourceType, threeBilledProjects } from './fixtures/account.js';
import { months } from './fixtures/calendar.js';
import { api } from './support/api.js';
import {
  accordionOf,
  cardOf,
  dropdown,
  firstColumnOf,
  headerOf,
  openTab,
  renderDashboard,
  rowTextsOf,
  rowsOf,
  selectLanguage,
  settle,
  sortTable,
  texts,
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
// The comparison of what the Production project consumed
const PRODUCTION_CONSUMPTION = /^Production \(Projet\)/;
const toggle = (title) => screen.getByRole('button', { name: title });
const comparison = (title) => accordionOf(toggle(title));
const comparisonTable = (title) => within(comparison(title)).queryByRole('table');
const openComparison = async (user, title) => {
  await user.click(toggle(title));
  await settle();
};
// The comparisons of the consumption of each project, by their titles
const projectComparisons = () => screen
  .getAllByRole('button', { name: /\(Projet\)/ })
  .map((button) => texts(button)[0]);

describe('Compare tab', () => {
  it('loads the figures of month A when the tab opens, not before', async () => {
    const figures = [
      api.fetchSummary, api.fetchByService, api.fetchByProject,
      // The costs by resource type and the Veeam backups too (#32)
      api.fetchByResourceType, api.fetchBackupStats,
    ];
    const { user } = await renderDashboard();
    for (const fetchFigures of figures) {
      expect(fetchFigures).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    }
    expect(api.fetchBackupStats).not.toHaveBeenCalled();
    expect(api.fetchInventoryServers).not.toHaveBeenCalled();

    await openTab(user, 'Comparaison');

    // Month B, the latest month, is the one the page opens on: its figures
    // are there already, all but its Veeam backups (#32)
    for (const fetchFigures of figures) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    }
    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    // The dedicated servers of the inventory load with the tab (#35), the
    // rest of the inventory with the Infrastructure tab only, and the
    // consumption of a project once its comparison opens
    expect(api.fetchInventoryServers).toHaveBeenCalled();
    expect(api.fetchInventoryVps).not.toHaveBeenCalled();
    expect(api.fetchInventoryStorage).not.toHaveBeenCalled();
    expect(api.fetchProjectConsumption).not.toHaveBeenCalled();
  });

  describe('months A and B', () => {
    it('are the month before the latest one, and the latest one', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      // (1 250.40 - 1 042) / 1 042
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Août 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '1 042,00€', 'Août 2026', '+20.0%', '1 250,40€', 'Septembre 2026',
      ]);
    });

    it('are the months the user picks, compared either way', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      await pickMonth(user, 'Septembre 2026', 'Août 2026');

      expect(api.fetchSummary).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
      // (1 042 - 980) / 980
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Juillet 2026', 'VS', 'Mois B :', 'Août 2026',
        '980,00€', 'Juillet 2026', '+6.3%', '1 042,00€', 'Août 2026',
      ]);

      await pickMonth(user, 'Juillet 2026', 'Septembre 2026');

      // (1 042 - 1 250.40) / 1 250.40
      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Août 2026',
        '1 250,40€', 'Septembre 2026', '-16.7%', '1 042,00€', 'Août 2026',
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
        '980,00€', 'Juillet 2026', '+27.6%', '1 250,40€', 'Septembre 2026',
      ]);
    });

    it('are the same month when a single month was billed', async () => {
      const { user } = await renderDashboard({ ...account, months: [months[0]] });

      await openTab(user, 'Comparaison');

      expect(texts(comparedTotals())).toEqual([
        'Mois A :', 'Septembre 2026', 'VS', 'Mois B :', 'Septembre 2026',
        '1 250,40€', 'Septembre 2026', '0.0%', '1 250,40€', 'Septembre 2026',
      ]);
    });
  });

  it('draws the service types of months A and B in a chart', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchByService).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31');

    await openTab(user, 'Comparaison');

    // Nothing else shows under the heading, no list or total: the legend and
    // the axes are the chart's, and it draws nothing without a layout
    expect(screen.getByRole('heading', { name: 'Comparaison par service' }))
      .toBeInTheDocument();
    // What it is drawn from: the service types of month A, once the tab opens
    expect(api.fetchByService).toHaveBeenCalledWith('2026-08-01', '2026-08-31');

    await pickMonth(user, 'Septembre 2026', 'Juillet 2026');

    // ... and those of month B, once the user picks it
    expect(api.fetchByService).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
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
        ['Production', '512,00€', '610,40€', '+19.2%'],
        ['Staging', '190,00€', '220,00€', '+15.8%'],
      ]);
    });

    it('sorts the projects by name, month A, month B or variation, each way in turn', async () => {
      const { user } = await renderDashboard({ ...account, ...threeBilledProjects });
      await openTab(user, 'Comparaison');
      expect(projectRows()).toEqual([
        ['Projet○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '412,00€', '460,40€', '+11.7%'],
        ['Sandbox', '180,00€', '120,00€', '-33.3%'],
        ['Staging', '110,00€', '250,00€', '+127.3%'],
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

      expect(header()).toEqual(['Projet▼', 'Août 2026○', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Staging', 'Sandbox', 'Production']);

      await sortTable(user, projectTable(), /^Projet/);

      expect(header()).toEqual(['Projet▲', 'Août 2026○', 'Septembre 2026○', 'Variation○']);
      expect(projects()).toEqual(['Production', 'Sandbox', 'Staging']);
      // The comparisons of each project follow the same order
      expect(projectComparisons())
        .toEqual(['Production (Projet)', 'Sandbox (Projet)', 'Staging (Projet)']);
    });

    it('keeps its sort order when the user comes back to the tab', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await sortTable(user, projectTable(), /^Projet/);

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Comparaison');

      expect(projectRows()).toEqual([
        ['Projet▼', 'Août 2026○', 'Septembre 2026○', 'Variation○'],
        ['Staging', '190,00€', '220,00€', '+15.8%'],
        ['Production', '512,00€', '610,40€', '+19.2%'],
      ]);
    });

    it('leaves out the projects billed in month B only (#55)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Août 2026', 'Juillet 2026');

      // Staging was first billed in August: missing from the table and from
      // the comparisons of each project (#55)
      expect(projectRows()).toEqual([
        ['Projet○', 'Juillet 2026▼', 'Septembre 2026○', 'Variation○'],
        ['Production', '680,00€', '610,40€', '-10.2%'],
      ]);
      expect(projectComparisons()).toEqual(['Production (Projet)']);
    });

    it('compares a project billed in month A only with nothing', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      expect(projectRows()).toEqual([
        ['Projet○', 'Septembre 2026▼', 'Juillet 2026○', 'Variation○'],
        ['Production', '610,40€', '680,00€', '+11.4%'],
        ['Staging', '220,00€', '0,00€', '-100.0%'],
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
      // A variation from 0 € shows nothing, and an empty cell gives no text.
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))).toEqual([
        ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        // With the servers of the inventory, though the Infrastructure tab
        // never opened (#35)
        [
          'Liste des Serveurs dédiés présents au 15/09/2026',
          'backup-server', 'ns3000002.ip-198-51-100.eu', '270,00€', '270,00€', '0.0%',
        ],
        ['VPS', '0,00€', '0,00€'],
        ['Stockage', '0,00€', '0,00€'],
        ['Load Balancer', '0,00€', '0,00€'],
        ['Adresses IP', '0,00€', '0,00€'],
        // (35 - 30) / 30
        ['Noms de domaine', '30,00€', '35,00€', '+16.7%'],
        ['Hôtes Private Cloud', '0,00€', '0,00€'],
        ['Datastores Private Cloud', '0,00€', '0,00€'],
      ]);
      // 2 Veeam VMs backed up for 40 € in August, 3 for 90 € in September,
      // and an Enterprise licence of 25 € in September only (#32)
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['VMs Veeam Backup', '2 / 40,00€', '3 / 90,00€', '+125.0%'],
        ['Licence Veeam Enterprise', '0 / 0,00€', '1 / 25,00€', ''],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['Hôtes Private Cloud', '0,00€', '0,00€', ''],
        ['Datastores Private Cloud', '0,00€', '0,00€', ''],
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
      expect(api.fetchByResourceType).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
      expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
      expect(rowTextsOf(comparisonTable(INFRASTRUCTURE))).toEqual([
        ['Type', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        // With the servers of the inventory (#35)
        [
          'Liste des Serveurs dédiés présents au 15/09/2026',
          'backup-server', 'ns3000002.ip-198-51-100.eu', '270,00€', '270,00€', '0.0%',
        ],
        ['VPS', '11,99€', '0,00€', '-100.0%'],
        ['Stockage', '64,80€', '0,00€', '-100.0%'],
        ['Load Balancer', '18,00€', '0,00€', '-100.0%'],
        ['Adresses IP', '6,00€', '0,00€', '-100.0%'],
        // (30 - 35) / 35
        ['Noms de domaine', '35,00€', '30,00€', '-14.3%'],
        ['Hôtes Private Cloud', '1 450,00€', '0,00€', '-100.0%'],
        ['Datastores Private Cloud', '380,00€', '0,00€', '-100.0%'],
      ]);
      expect(rowsOf(comparisonTable(BACKUP))).toEqual([
        ['Catégorie', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        ['VMs Veeam Backup', '3 / 90,00€', '0 / 0,00€', '-100.0%'],
        ['Licence Veeam Enterprise', '1 / 25,00€', '0 / 0,00€', '-100.0%'],
      ]);
      expect(rowsOf(comparisonTable(PRIVATE_CLOUD))).toEqual([
        ['Type', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        ['Hôtes Private Cloud', '1 450,00€', '0,00€', '-100.0%'],
        ['Datastores Private Cloud', '380,00€', '0,00€', '-100.0%'],
      ]);
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
        '270,00€', '270,00€', '0.0%',
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
  });

  describe('project consumption comparisons', () => {
    it('are closed, one per project of the project comparison', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Comparaison');

      expect(projectComparisons()).toEqual(['Production (Projet)', 'Staging (Projet)']);
      expect(comparisonTable(PRODUCTION_CONSUMPTION)).not.toBeInTheDocument();
    });

    it('compare what a project consumed by cloud resource kind, once opened', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');

      await openComparison(user, PRODUCTION_CONSUMPTION);

      expect(api.fetchProjectConsumption)
        .toHaveBeenCalledWith('project-production', '2026-08-01', '2026-08-31');
      expect(api.fetchProjectConsumption)
        .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30');
      // The import keeps the consumption of the current month only (#54):
      // nothing in August, so no variation
      expect(rowsOf(comparisonTable(PRODUCTION_CONSUMPTION))).toEqual([
        ['Produit/Type', 'Août 2026', 'Septembre 2026', 'Variation'],
        ['instance', '0,00€', '234,25€', ''],
        ['instance_monthly', '0,00€', '64,00€', ''],
        ['volume', '0,00€', '7,50€', ''],
        ['snapshot', '0,00€', '3,25€', ''],
        ['objectStorage', '0,00€', '41,00€', ''],
      ]);
    });

    it('show a variation of -100% from the current month to any past one (#54)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Septembre 2026', 'Juillet 2026');
      await pickMonth(user, 'Août 2026', 'Septembre 2026');

      await openComparison(user, PRODUCTION_CONSUMPTION);

      // Month A is the current month, the only one whose consumption the
      // import keeps (#54): every cloud resource kind drops to nothing
      expect(rowsOf(comparisonTable(PRODUCTION_CONSUMPTION))).toEqual([
        ['Produit/Type', 'Septembre 2026', 'Juillet 2026', 'Variation'],
        ['instance', '234,25€', '0,00€', '-100.0%'],
        ['instance_monthly', '64,00€', '0,00€', '-100.0%'],
        ['volume', '7,50€', '0,00€', '-100.0%'],
        ['snapshot', '3,25€', '0,00€', '-100.0%'],
        ['objectStorage', '41,00€', '0,00€', '-100.0%'],
      ]);
    });

    it('say when a project consumed nothing in months A and B', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Comparaison');
      await pickMonth(user, 'Août 2026', 'Juillet 2026');
      await pickMonth(user, 'Septembre 2026', 'Août 2026');

      await openComparison(user, PRODUCTION_CONSUMPTION);

      // Production was billed both months, but the import keeps the
      // consumption of the current month only (#54)
      expect(within(comparison(PRODUCTION_CONSUMPTION))
        .getByText('Aucune donnée pour ce projet')).toBeInTheDocument();
      expect(comparisonTable(PRODUCTION_CONSUMPTION)).not.toBeInTheDocument();
    });
  });

  it('speaks English when the page does', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');

    await openTab(user, 'Compare');

    // Month labels come from the API, in French only (#33)
    expect(texts(comparedTotals())).toEqual([
      'Month A :', 'Août 2026', 'VS', 'Month B :', 'Septembre 2026',
      '1,042.00€', 'Août 2026', '+20.0%', '1,250.40€', 'Septembre 2026',
    ]);
    expect(screen.getByRole('heading', { name: 'Comparison by service' })).toBeInTheDocument();
    expect(rowsOf(comparisonTable(/^Comparison by project/))).toEqual([
      ['Project○', 'Août 2026▼', 'Septembre 2026○', 'Variation○'],
      ['Production', '512.00€', '610.40€', '+19.2%'],
      ['Staging', '190.00€', '220.00€', '+15.8%'],
    ]);

    await openComparison(user, /^Infrastructure Comparison/);
    await openComparison(user, /^Backup Comparison/);
    await openComparison(user, /^Private Cloud Comparison/);
    await openComparison(user, /^Production \(Project\)/);

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
    // The Veeam backups of months A and B (#32)
    expect(rowsOf(comparisonTable(/^Backup Comparison/))).toEqual([
      ['Category', 'Août 2026', 'Septembre 2026', 'Variation'],
      ['Veeam Backup VMs', '2 / 40.00€', '3 / 90.00€', '+125.0%'],
      ['Veeam Enterprise License', '0 / 0.00€', '1 / 25.00€', ''],
    ]);
    expect(rowsOf(comparisonTable(/^Private Cloud Comparison/)).map(([type]) => type))
      .toEqual(['Type', 'Private Cloud Hosts', 'Private Cloud Datastores']);
    expect(rowsOf(comparisonTable(/^Production \(Project\)/)).slice(0, 2)).toEqual([
      ['Product/Type', 'Août 2026', 'Septembre 2026', 'Variation'],
      ['instance', '0.00€', '234.25€', ''],
    ]);
  });
});
