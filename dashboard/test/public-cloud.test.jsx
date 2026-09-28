import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { lyonAccount, removedAccount, severalAccounts } from './fixtures/accounts.js';
import { api } from './support/api.js';
import {
  BOM,
  captureFileDownloads,
  csvFile,
  downloadFromPanelAndModal,
} from './support/downloads.js';
import {
  backdropOf,
  cardRowOf,
  cloudProjectRow,
  cloudProjects,
  headerOf,
  openTab,
  panelOf,
  renderDashboard,
  rowTextsOf,
  rowsOf,
  selectAccount,
  selectLanguage,
  selectMonth,
  settle,
  sortTable,
  texts,
} from './support/render.jsx';

// The Public Cloud figures of the month, one card each
const figures = () => cardRowOf('Kubernetes');
const openProject = async (user, name) => {
  await user.click(within(cloudProjects()).getByText(name));
  await settle();
};
// The headings of the detail of the open project: one per part it shows
const detailHeadings = () => within(cloudProjects())
  .queryAllByRole('heading', { level: 4 })
  .map((heading) => texts(heading));
// The panel of a resource table of the open project, found by its heading:
// "Buckets (4)"
const resourcePanel = (kind) =>
  panelOf(screen.getByRole('heading', { name: new RegExp(`^${kind} \\(`) }));
const resourceTable = (kind) => within(resourcePanel(kind)).getByRole('table');
// The name of each row of a table, in the order shown: the first text of its first cell
const namesIn = (table) => rowTextsOf(table).slice(1).map(([name]) => name);
// The table of the projects, without the tables of the detail of the open project
const projectsTable = () => within(cloudProjects()).getAllByRole('table')[0];
const resourceButton = (kind, name) => within(resourcePanel(kind)).getByRole('button', { name });
const showAll = async (user, kind) => {
  await user.click(resourceButton(kind, 'Tout afficher'));
  return screen.getByRole('dialog');
};
const openProduction = async () => {
  const { user } = await renderDashboard();
  await openTab(user, 'Public Cloud');
  await openProject(user, 'Production');
  return { user };
};

// The tooltips of the estimated costs
const EVEN_SHARE = 'Part égale de la ligne horaire agrégée de ce flavor : '
  + "l'API n'expose pas le temps de fonctionnement par instance";
const COLD_ARCHIVE_SHARE = 'Quote-part de la ligne agrégée « Stockage Cold Archive », '
  + 'au prorata du volume stocké';
const PRO_RATA_SHARE =
  "Quote-part d'une ligne de facture agrégée par région, au prorata de la taille";
const costsWith = (table, tooltip) =>
  within(table).getAllByTitle(tooltip).map((cell) => cell.textContent);

const instanceRows = [
  ['Nom○', 'Flavor○', 'Région○', 'État○', 'Coût○'],
  ['inference-1', 'l4-90.consumption', 'GRA11', 'ACTIVE', '~420,50€'],
  ['db-1', 'r3-32.monthly.postpaid', 'SBG5', 'ACTIVE', '64,00€'],
  ['web-1', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
  ['web-2', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
  // The bill lines of the instances gone from the inventory
  ['Non attribué (instances supprimées)', '6,40€'],
  // Shut off all month: not billed
  ['batch-1', 'd2-4', 'GRA11', 'SHUTOFF', '-'],
];
// Sizes in French units, with a decimal comma (#70)
const bucketRows = [
  ['Nom', '○', 'Type', '○', 'Région', '○', 'Taille', '○', 'Coût', '○'],
  ['archives-2025', 'Cold Archive', 'archived', 'GRA', '1,5 To', '~', '9,00€'],
  ['assets-example-com', 'Standard', 'GRA', '4,2 Go', '14,00€'],
  ['logs-empty', 'Standard', 'GRA', '0 o', '0,00€'],
  // Billed, but gone from the inventory
  ['old-exports', '†', 'Inconnu', 'SBG', '-', '2,00€'],
];
// Sizes in French units, as those of the buckets (#70)
const volumeRows = [
  ['Nom', '○', 'Type', '○', 'Région', '○', 'Taille', '○', 'Coût', '○'],
  ['db-data', 'high-speed', 'SBG5', '200 Go', '~', '6,50€'],
  ['web-shared', 'classic', 'GRA11', '100 Go', '~', '3,00€'],
  // A bill line with no volume left behind it
  ['Disques supplémentaires à bhs5 de type classic', 'classic', 'bhs5', '-', '~', '1,50€'],
  ['old-backup', 'détaché', 'classic', 'GRA11', '50 Go', '~', '1,50€'],
];
const snapshotRows = [
  ['Nom○', 'Région○', 'Créé le○', 'Taille○', 'Coût○'],
  ['db-1-before-upgrade', 'SBG5', '28/08/2026', '40 Go', '~4,00€'],
  ['web-1-golden', 'GRA11', '14/02/2026', '10 Go', '~2,00€'],
];
const savingsPlanRows = [
  ['Plan○', 'Flavor○', 'Couvert○', 'Dernière facture○', 'Coût○'],
  ['savings-plan-b3-8-web', 'b3-8', '2 / 2', '2026-09-01', '20,00€'],
  ['savings-plan-c3-4-legacy', 'c3-4', '1 / 0', '2026-09-01', '8,00€'],
];

describe('Public Cloud tab', () => {
  it('loads its projects and figures when the tab opens, not before', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
    expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
    // The GPU costs of the month load with the page, for the Overview
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);

    await openTab(user, 'Public Cloud');

    // For all accounts
    expect(api.fetchProjectsEnriched).toHaveBeenCalledWith(null);
    expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
    // The resources of a project wait until the user opens it
    expect(api.fetchProjectConsumption).not.toHaveBeenCalled();
    expect(api.fetchProjectInstances).not.toHaveBeenCalled();
  });

  it('shows the Public Cloud figures of the selected month', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Public Cloud');

    // Amounts only where something was billed
    expect(texts(figures())).toEqual([
      'Projets Cloud', '2',
      'Instances', '5', '718,90€',
      'Instances GPU', '1',
      'Kubernetes', '0',
      'Stockage Objet', '3', '25,00€',
      'Volumes', '3', '12,50€',
      'Snapshots', '2', '6,00€',
      'Savings plans', '2', '28,00€',
      'Registre', '1', '40,00€',
    ]);
  });

  describe('projects', () => {
    it('are listed with their state, instance count and current consumption', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Public Cloud');

      expect(rowTextsOf(within(cloudProjects()).getByRole('table'))).toEqual([
        ['Nom', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○'],
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '▼'],
        ['Staging', 'ok', '0', '52,35€', '▼'],
        // Nothing consumed
        ['Sandbox', 'ok', '0', '-', '▼'],
      ]);
      expect(detailHeadings()).toEqual([]);
    });

    it('show the detail of a project under it on a click, until a second click', async () => {
      const { user } = await openProduction();

      expect(texts(cloudProjectRow('Production'))).toContain('▲');
      expect(detailHeadings()).toEqual([
        ['Consommation par ressource'],
        ['Instances (5)', '538,90€', 'Tout afficher', 'CSV'],
        ['Buckets (4)', '25,00€', 'Tout afficher', 'CSV'],
        ['Volumes (4)', '12,50€', 'Tout afficher', 'CSV'],
        ['Snapshots (2)', '6,00€', 'Tout afficher', 'CSV'],
        ['Savings plans (2)', '28,00€', 'Tout afficher', 'CSV'],
        ['Quotas par région'],
      ]);

      await openProject(user, 'Production');

      expect(texts(cloudProjectRow('Production'))).toContain('▼');
      expect(detailHeadings()).toEqual([]);
    });

    it('show the detail of one project at a time', async () => {
      const { user } = await openProduction();

      await openProject(user, 'Staging');

      expect(texts(cloudProjectRow('Production'))).toContain('▼');
      expect(texts(cloudProjectRow('Staging'))).toContain('▲');
      expect(detailHeadings()).toEqual([
        ['Consommation par ressource'],
        ['Instances (0)', '180,00€', 'Tout afficher', 'CSV'],
      ]);
    });

    it('sort by any column, the detail of the open project under it (#146)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');

      await sortTable(user, projectsTable(), /^Consommation en cours/);
      await sortTable(user, projectsTable(), /^Consommation en cours/);

      // The least consuming first, and last the project that consumed nothing
      expect(rowTextsOf(projectsTable())).toEqual([
        ['Nom', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '▲'],
        ['Staging', 'ok', '0', '52,35€', '▼'],
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '▼'],
        ['Sandbox', 'ok', '0', '-', '▼'],
      ]);

      await openProject(user, 'Production');
      // By the header of the list, rather than one of the tables of the project's detail
      await sortTable(user, projectsTable().tHead, /^Nom/);

      expect(headerOf(projectsTable()))
        .toEqual(['Nom▲', 'État○', 'Instances○', 'Consommation en cours○', '']);
      // Each row by its first text: Production, its detail, then the other projects
      expect([...projectsTable().tBodies[0].rows].map((row) => texts(row)[0]))
        .toEqual(['Production', 'Consommation par ressource', 'Sandbox', 'Staging']);
    });

    // Which ways of moving around the page keep the open project: see navigation.test.jsx (#56)
  });

  describe('project detail', () => {
    it('loads the resources of the project, for the selected month', async () => {
      await openProduction();

      // All the consumption kept, whatever the month
      expect(api.fetchProjectConsumption).toHaveBeenCalledWith('project-production');
      expect(api.fetchProjectQuotas).toHaveBeenCalledWith('project-production');
      for (const fetchResources of [
        api.fetchProjectInstances,
        api.fetchProjectInstanceTotal,
        api.fetchProjectBuckets,
        api.fetchProjectVolumes,
        api.fetchProjectSnapshots,
        api.fetchProjectSavingsPlans,
      ]) {
        expect(fetchResources)
          .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30');
      }
    });

    it('follows the month selector, as the figures do', async () => {
      const { user } = await openProduction();

      await selectMonth(user, 'Août 2026');

      expect(texts(figures())).toEqual([
        'Projets Cloud', '2',
        'Instances', '5', '590,60€',
        'Instances GPU', '1',
        'Kubernetes', '0',
        // The empty bucket was created in September
        'Stockage Objet', '2', '24,90€',
        'Volumes', '3', '12,50€',
        'Snapshots', '2', '6,00€',
        'Savings plans', '2', '28,00€',
        'Registre', '1', '40,00€',
      ]);
      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-production', '2026-08-01', '2026-08-31');
      expect(detailHeadings()[1]).toEqual(['Instances (5)', '440,60€', 'Tout afficher', 'CSV']);
      expect(rowsOf(resourceTable('Instances'))).toEqual([
        ['Nom○', 'Flavor○', 'Région○', 'État○', 'Coût○'],
        ['inference-1', 'l4-90.consumption', 'GRA11', 'ACTIVE', '~310,00€'],
        ['db-1', 'r3-32.monthly.postpaid', 'SBG5', 'ACTIVE', '64,00€'],
        ['web-1', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
        ['web-2', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
        ['batch-1', 'd2-4', 'GRA11', 'SHUTOFF', '~18,60€'],
      ]);
    });

    it('shows the quotas of the regions where the project runs something', async () => {
      await openProduction();

      const quotas = panelOf(screen.getByRole('heading', { name: 'Quotas par région' }));
      expect(texts(quotas)).toEqual([
        'Quotas par région',
        'GRA11', 'vCPU: 28/64', 'Instances: 4/20',
        'SBG5', 'vCPU: 4/32', 'Instances: 1/10',
      ]);
    });

    it('says when a project has no consumption or instance, and shows nothing else', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');

      await openProject(user, 'Sandbox');

      expect(within(cloudProjects()).getByText('Pas de données de consommation'))
        .toBeInTheDocument();
      expect(within(cloudProjects()).getByText('Aucune instance')).toBeInTheDocument();
      // No amount, no action, and no buckets, volumes, snapshots, savings
      // plans or quotas
      expect(detailHeadings()).toEqual([['Instances (0)']]);
    });
  });

  describe('instances', () => {
    it('are listed most expensive first, with the unallocated row', async () => {
      await openProduction();

      // The unallocated row is not an instance
      expect(detailHeadings()[1]).toEqual(['Instances (5)', '538,90€', 'Tout afficher', 'CSV']);
      expect(rowsOf(resourceTable('Instances'))).toEqual(instanceRows);
    });

    it('mark their estimated costs, explained in a tooltip', async () => {
      await openProduction();

      // Hourly instances get an even share of the line of their flavor and
      // region; the monthly one is billed under its own id
      expect(costsWith(resourceTable('Instances'), EVEN_SHARE))
        .toEqual(['~420,50€', '~24,00€', '~24,00€']);
    });

    it('show only the unallocated row once all the instances are gone', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');

      await openProject(user, 'Staging');

      expect(rowsOf(resourceTable('Instances'))).toEqual([
        ['Nom○', 'Flavor○', 'Région○', 'État○', 'Coût○'],
        ['Non attribué (instances supprimées)', '180,00€'],
      ]);
    });

    // The row of the bill lines of the deleted instances has a cost, but no name, flavor,
    // region or state: it sorts by its cost as an instance does, and comes last by any other
    // column, as any row without a value there (#146)
    it('sort by any column, the unallocated row by its cost only', async () => {
      const { user } = await openProduction();
      const table = () => resourceTable('Instances');

      await sortTable(user, table(), /^Nom/);

      expect(headerOf(table())).toEqual(['Nom▲', 'Flavor○', 'Région○', 'État○', 'Coût○']);
      expect(namesIn(table())).toEqual([
        'batch-1', 'db-1', 'inference-1', 'web-1', 'web-2', 'Non attribué (instances supprimées)',
      ]);

      await sortTable(user, table(), /^Nom/);

      expect(namesIn(table())).toEqual([
        'web-2', 'web-1', 'inference-1', 'db-1', 'batch-1', 'Non attribué (instances supprimées)',
      ]);

      await sortTable(user, table(), /^Coût/);
      await sortTable(user, table(), /^Coût/);

      // The least expensive first, the instances of the same cost in their order, and last the
      // instance that nothing billed
      expect(rowsOf(table())).toEqual([
        ['Nom○', 'Flavor○', 'Région○', 'État○', 'Coût▲'],
        ['Non attribué (instances supprimées)', '6,40€'],
        ['web-1', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
        ['web-2', 'b3-8.consumption', 'GRA11', 'ACTIVE', '~24,00€'],
        ['db-1', 'r3-32.monthly.postpaid', 'SBG5', 'ACTIVE', '64,00€'],
        ['inference-1', 'l4-90.consumption', 'GRA11', 'ACTIVE', '~420,50€'],
        ['batch-1', 'd2-4', 'GRA11', 'SHUTOFF', '-'],
      ]);
    });

    describe('"show all" modal', () => {
      it('shows every instance of the project, and closes with its button', async () => {
        const { user } = await openProduction();

        const dialog = await showAll(user, 'Instances');

        expect(within(dialog).getByText('Instances (5)')).toBeInTheDocument();
        expect(within(dialog).getByText('538,90€')).toBeInTheDocument();
        expect(within(dialog).getByText('Production')).toBeInTheDocument();
        expect(rowsOf(within(dialog).getByRole('table'))).toEqual(instanceRows);

        await user.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('closes with Escape', async () => {
        const { user } = await openProduction();
        await showAll(user, 'Instances');

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('closes on a click outside it', async () => {
        const { user } = await openProduction();
        const dialog = await showAll(user, 'Instances');

        await user.click(backdropOf(dialog));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('are downloaded as CSV in the server order, from the panel and the modal', async () => {
      const { user } = await openProduction();

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Instances'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-instances-Production.csv', [
        '"Nom";"Flavor";"Région";"État";"Coût (EUR)";"Estimé";"Facturation mensuelle";'
          + '"Créé le";"ID"',
        // No cost: an empty cell
        '"batch-1";"d2-4";"GRA11";"SHUTOFF";;0;0;"2026-05-04T08:00:00Z";"instance-batch-1"',
        '"db-1";"r3-32.monthly.postpaid";"SBG5";"ACTIVE";64;0;1;"2025-11-20T09:00:00Z";'
          + '"instance-db-1"',
        '"inference-1";"l4-90.consumption";"GRA11";"ACTIVE";420,5;1;0;"2026-08-01T07:30:00Z";'
          + '"instance-gpu-1"',
        '"web-1";"b3-8.consumption";"GRA11";"ACTIVE";24;1;0;"2026-02-10T08:00:00Z";'
          + '"instance-web-1"',
        '"web-2";"b3-8.consumption";"GRA11";"ACTIVE";24;1;0;"2026-02-10T08:05:00Z";'
          + '"instance-web-2"',
        // Its label for a name, and an empty text for a flavor
        '"Non attribué (instances supprimées)";"";;;6,4;0;;;',
      ]));
    });
  });

  describe('buckets', () => {
    it('are listed by name, with their class, size and cost', async () => {
      await openProduction();

      const table = resourceTable('Buckets');
      expect(rowTextsOf(table)).toEqual(bucketRows);
      expect(within(table).getByTitle("Facturé mais absent de l'inventaire"))
        .toHaveTextContent('†');
      expect(costsWith(table, COLD_ARCHIVE_SHARE)).toEqual(['~9,00€']);
    });

    it('are all shown in their "show all" modal, which closes with its button', async () => {
      const { user } = await openProduction();

      const dialog = await showAll(user, 'Buckets');

      expect(within(dialog).getByText('Buckets (4)')).toBeInTheDocument();
      expect(within(dialog).getByText('25,00€')).toBeInTheDocument();
      expect(within(dialog).getByText('Septembre 2026')).toBeInTheDocument();
      expect(rowTextsOf(within(dialog).getByRole('table'))).toEqual(bucketRows);

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The issue's example (#146): the largest or the most expensive buckets first, a click on a
    // header away
    it('sort by size or by cost, the largest first, then the smallest', async () => {
      const { user } = await openProduction();
      const table = () => resourceTable('Buckets');

      await sortTable(user, table(), /^Taille/);

      // 1,5 To, 4,2 Go, 0 o, and last the bucket gone from the inventory, without a size
      expect(headerOf(table())).toEqual(['Nom○', 'Type○', 'Région○', 'Taille▼', 'Coût○']);
      expect(namesIn(table()))
        .toEqual(['archives-2025', 'assets-example-com', 'logs-empty', 'old-exports']);

      await sortTable(user, table(), /^Taille/);

      expect(headerOf(table())).toEqual(['Nom○', 'Type○', 'Région○', 'Taille▲', 'Coût○']);
      expect(namesIn(table()))
        .toEqual(['logs-empty', 'assets-example-com', 'archives-2025', 'old-exports']);

      await sortTable(user, table(), /^Coût/);

      // 14 €, ~9 €, 2 €, 0 €
      expect(headerOf(table())).toEqual(['Nom○', 'Type○', 'Région○', 'Taille○', 'Coût▼']);
      expect(namesIn(table()))
        .toEqual(['assets-example-com', 'archives-2025', 'old-exports', 'logs-empty']);

      await sortTable(user, table(), /^Coût/);

      expect(headerOf(table())).toEqual(['Nom○', 'Type○', 'Région○', 'Taille○', 'Coût▲']);
      expect(namesIn(table()))
        .toEqual(['logs-empty', 'old-exports', 'archives-2025', 'assets-example-com']);
    });

    it('show in the order of their panel in the "show all" modal, and back', async () => {
      const { user } = await openProduction();
      await sortTable(user, resourceTable('Buckets'), /^Coût/);

      const dialog = await showAll(user, 'Buckets');
      const tableOfDialog = () => within(dialog).getByRole('table');

      expect(headerOf(tableOfDialog())).toEqual(['Nom○', 'Type○', 'Région○', 'Taille○', 'Coût▼']);
      expect(namesIn(tableOfDialog()))
        .toEqual(['assets-example-com', 'archives-2025', 'old-exports', 'logs-empty']);

      // From Z to A
      await sortTable(user, tableOfDialog(), /^Nom/);
      await sortTable(user, tableOfDialog(), /^Nom/);
      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(headerOf(resourceTable('Buckets')))
        .toEqual(['Nom▼', 'Type○', 'Région○', 'Taille○', 'Coût○']);
      expect(namesIn(resourceTable('Buckets')))
        .toEqual(['old-exports', 'logs-empty', 'assets-example-com', 'archives-2025']);
    });

    it('keep their sort order when the user comes back to the tab', async () => {
      const { user } = await openProduction();
      await sortTable(user, resourceTable('Buckets'), /^Taille/);

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Public Cloud');

      // The project is still open (#56)
      expect(headerOf(resourceTable('Buckets')))
        .toEqual(['Nom○', 'Type○', 'Région○', 'Taille▼', 'Coût○']);
      expect(namesIn(resourceTable('Buckets')))
        .toEqual(['archives-2025', 'assets-example-com', 'logs-empty', 'old-exports']);
    });

    it('are downloaded as CSV by name, from the panel and the modal', async () => {
      const { user } = await openProduction();

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Buckets'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-buckets-2026-09.csv', [
        '"Nom";"Type";"Statut";"Région";"Objets";"Taille (octets)";"Coût (EUR)";"Estimé";'
          + '"Dans l\'inventaire";"Créé le"',
        '"archives-2025";"Cold Archive";"archived";"GRA";12;1500000000000;9;1;1;'
          + '"2025-06-30T08:00:00Z"',
        '"assets-example-com";"Standard";;"GRA";1520;4200000000;14;0;1;"2025-11-03T08:00:00Z"',
        '"logs-empty";"Standard";;"GRA";0;0;0;0;1;"2026-09-10T08:00:00Z"',
        '"old-exports";;;"SBG";;;2;0;0;',
      ]));
    });

    // As the other exports, whatever the order the table shows (#146)
    it('are downloaded as CSV by name whatever the order they show in', async () => {
      const { user } = await openProduction();
      await sortTable(user, resourceTable('Buckets'), /^Coût/);

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Buckets'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel.content.split('\n').slice(1).map((line) => line.split(';')[0]))
        .toEqual(['"archives-2025"', '"assets-example-com"', '"logs-empty"', '"old-exports"']);
    });
  });

  describe('volumes', () => {
    it('are listed with their share of the bill lines of their region and type', async () => {
      await openProduction();

      const table = resourceTable('Volumes');
      expect(rowTextsOf(table)).toEqual(volumeRows);
      expect(within(table).getByTitle('Attaché à aucune instance')).toHaveTextContent('détaché');
      expect(costsWith(table, PRO_RATA_SHARE)).toEqual(['~6,50€', '~3,00€', '~1,50€', '~1,50€']);
    });

    it('sort by any column, the one without a size last (#146)', async () => {
      const { user } = await openProduction();
      const table = () => resourceTable('Volumes');

      await sortTable(user, table(), /^Taille/);
      await sortTable(user, table(), /^Taille/);

      // 50 Go, 100 Go, 200 Go, and last the bill line without a volume behind it
      expect(rowTextsOf(table())[0])
        .toEqual(['Nom', '○', 'Type', '○', 'Région', '○', 'Taille', '▲', 'Coût', '○']);
      expect(namesIn(table())).toEqual([
        'old-backup', 'web-shared', 'db-data', 'Disques supplémentaires à bhs5 de type classic',
      ]);
    });

    it('are all shown in their "show all" modal, which closes with its button', async () => {
      const { user } = await openProduction();

      const dialog = await showAll(user, 'Volumes');

      expect(within(dialog).getByText('Volumes (4)')).toBeInTheDocument();
      expect(within(dialog).getByText('12,50€')).toBeInTheDocument();
      expect(rowTextsOf(within(dialog).getByRole('table'))).toEqual(volumeRows);

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('are downloaded as CSV, from the panel and the modal', async () => {
      const { user } = await openProduction();

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Volumes'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-volumes-2026-09.csv', [
        '"Nom";"Type";"Région";"Taille (Go)";"Statut";"Attaché";"Coût (EUR)";"Estimé";'
          + '"Créé le";"ID"',
        '"db-data";"high-speed";"SBG5";200;"in-use";"instance-db-1";6,5;1;'
          + '"2025-11-20T09:05:00Z";"volume-db-data"',
        '"web-shared";"classic";"GRA11";100;"in-use";"instance-web-1";3;1;'
          + '"2026-02-10T08:10:00Z";"volume-web-shared"',
        '"Disques supplémentaires à bhs5 de type classic";"classic";"bhs5";;;"";1,5;1;;',
        '"old-backup";"classic";"GRA11";50;"available";"";1,5;1;"2025-12-01T10:00:00Z";'
          + '"volume-old-backup"',
      ]));
    });
  });

  describe('snapshots', () => {
    it('are listed with their share of the bill line of their region', async () => {
      await openProduction();

      const table = resourceTable('Snapshots');
      expect(rowsOf(table)).toEqual(snapshotRows);
      expect(costsWith(table, PRO_RATA_SHARE)).toEqual(['~4,00€', '~2,00€']);
    });

    it('sort by creation date, the latest first, then the oldest (#146)', async () => {
      const { user } = await openProduction();
      const table = () => resourceTable('Snapshots');

      await sortTable(user, table(), /^Créé le/);

      expect(headerOf(table())).toEqual(['Nom○', 'Région○', 'Créé le▼', 'Taille○', 'Coût○']);
      expect(namesIn(table())).toEqual(['db-1-before-upgrade', 'web-1-golden']);

      await sortTable(user, table(), /^Créé le/);

      expect(namesIn(table())).toEqual(['web-1-golden', 'db-1-before-upgrade']);
    });

    it('are all shown in their "show all" modal, which closes with its button', async () => {
      const { user } = await openProduction();

      const dialog = await showAll(user, 'Snapshots');

      expect(within(dialog).getByText('Snapshots (2)')).toBeInTheDocument();
      expect(within(dialog).getByText('6,00€')).toBeInTheDocument();
      expect(rowsOf(within(dialog).getByRole('table'))).toEqual(snapshotRows);

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('are downloaded as CSV, from the panel and the modal', async () => {
      const { user } = await openProduction();

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Snapshots'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-snapshots-2026-09.csv', [
        '"Nom";"Région";"Taille (Go)";"Visibilité";"OS";"Coût (EUR)";"Estimé";"Créé le";"ID"',
        '"db-1-before-upgrade";"SBG5";40;"private";"linux";4;1;"2026-08-28T10:00:00Z";'
          + '"snapshot-db-1-before-upgrade"',
        '"web-1-golden";"GRA11";10;"private";"linux";2;1;"2026-02-14T10:30:00Z";'
          + '"snapshot-web-1-golden"',
      ]));
    });
  });

  describe('savings plans', () => {
    it('are listed with the coverage of their flavor, flagged when it goes over', async () => {
      await openProduction();

      const table = resourceTable('Savings plans');
      expect(rowsOf(table)).toEqual(savingsPlanRows);
      expect(within(table).getByTitle(
        "Les plans de ce flavor paient plus d'instances que le projet n'en fait tourner",
      )).toHaveTextContent('1 / 0');
      expect(within(table).getByTitle('Instances payées par tous les plans de ce flavor / '
        + "instances de ce flavor dans l'inventaire")).toHaveTextContent('2 / 2');
    });

    // By the instances that the plans of their flavor pay for (#146)
    it('sort by coverage, the plans that cover the most first, then the fewest', async () => {
      const { user } = await openProduction();
      const table = () => resourceTable('Savings plans');

      await sortTable(user, table(), /^Couvert/);
      await sortTable(user, table(), /^Couvert/);

      expect(rowsOf(table())).toEqual([
        ['Plan○', 'Flavor○', 'Couvert▲', 'Dernière facture○', 'Coût○'],
        ['savings-plan-c3-4-legacy', 'c3-4', '1 / 0', '2026-09-01', '8,00€'],
        ['savings-plan-b3-8-web', 'b3-8', '2 / 2', '2026-09-01', '20,00€'],
      ]);
    });

    it('are all shown in their "show all" modal, which closes with its button', async () => {
      const { user } = await openProduction();

      const dialog = await showAll(user, 'Savings plans');

      expect(within(dialog).getByText('Savings plans (2)')).toBeInTheDocument();
      expect(within(dialog).getByText('28,00€')).toBeInTheDocument();
      expect(rowsOf(within(dialog).getByRole('table'))).toEqual(savingsPlanRows);

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('are downloaded as CSV, from the panel and the modal', async () => {
      const { user } = await openProduction();

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, resourcePanel('Savings plans'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-savings-plans-2026-09.csv', [
        '"Plan";"Flavor";"Instances couvertes";"Instances couvertes (total du flavor)";'
          + '"Instances en inventaire";"Durée";"Mois facturés";"Première facture";'
          + '"Dernière facture";"Coût (EUR)"',
        '"savings-plan-b3-8-web";"b3-8";2;2;2;"1M";1;"2026-09-01";"2026-09-01";20',
        '"savings-plan-c3-4-legacy";"c3-4";1;1;0;"1M";1;"2026-09-01";"2026-09-01";8',
      ]));
    });
  });

  it('shows only its figures when there is no Public Cloud project', async () => {
    const { user } = await renderDashboard({ ...account, projectsEnriched: [] });

    await openTab(user, 'Public Cloud');

    // The figures read the bills, the instance count the projects
    expect(texts(figures()).slice(0, 5))
      .toEqual(['Projets Cloud', '2', 'Instances', '0', '718,90€']);
    expect(screen.queryByRole('heading', { name: 'Projets Cloud' })).not.toBeInTheDocument();
  });

  it('speaks English when the page does, in its CSV files too', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');
    await openTab(user, 'Public Cloud');
    expect(rowTextsOf(within(cloudProjects()).getByRole('table'))[0])
      .toEqual(['Name', '○', 'State', '○', 'Instances', '○', 'Current consumption', '○']);

    await openProject(user, 'Production');

    expect(texts(figures())).toEqual([
      'Cloud Projects', '2',
      'Instances', '5', '718.90€',
      'GPU Instances', '1',
      'Kubernetes', '0',
      'Object Storage', '3', '25.00€',
      'Volumes', '3', '12.50€',
      'Snapshots', '2', '6.00€',
      'Savings plans', '2', '28.00€',
      'Container Registry', '1', '40.00€',
    ]);
    expect(detailHeadings()).toEqual([
      ['Consumption by resource'],
      ['Instances (5)', '538.90€', 'Show all', 'CSV'],
      ['Buckets (4)', '25.00€', 'Show all', 'CSV'],
      ['Volumes (4)', '12.50€', 'Show all', 'CSV'],
      ['Snapshots (2)', '6.00€', 'Show all', 'CSV'],
      ['Savings plans (2)', '28.00€', 'Show all', 'CSV'],
      ['Quotas by region'],
    ]);
    const instances = resourceTable('Instances');
    expect(rowsOf(instances)[0]).toEqual(['Name○', 'Flavor○', 'Region○', 'State○', 'Cost○']);
    expect(rowsOf(instances)[5]).toEqual(['Unallocated (deleted instances)', '6.40€']);
    expect(costsWith(instances, 'Even share of the aggregated hourly line for this flavor: '
      + 'the API exposes no per-instance runtime')).toEqual(['~420.50€', '~24.00€', '~24.00€']);
    // Sizes in English units (#70)
    expect(rowTextsOf(resourceTable('Buckets')).slice(1)).toEqual([
      ['archives-2025', 'Cold Archive', 'archived', 'GRA', '1.5 TB', '~', '9.00€'],
      ['assets-example-com', 'Standard', 'GRA', '4.2 GB', '14.00€'],
      ['logs-empty', 'Standard', 'GRA', '0 B', '0.00€'],
      ['old-exports', '†', 'Unknown', 'SBG', '-', '2.00€'],
    ]);
    expect(rowTextsOf(resourceTable('Volumes'))[4])
      .toEqual(['old-backup', 'detached', 'classic', 'GRA11', '50 GB', '~', '1.50€']);
    expect(rowsOf(resourceTable('Snapshots'))[1])
      .toEqual(['db-1-before-upgrade', 'SBG5', '8/28/2026', '40 GB', '~4.00€']);
    expect(rowsOf(resourceTable('Savings plans'))[0])
      .toEqual(['Plan○', 'Flavor○', 'Covered○', 'Last billed○', 'Cost○']);
    const downloadedFiles = captureFileDownloads();

    await user.click(resourceButton('Instances', 'CSV'));

    const [file] = await downloadedFiles();
    const lines = file.content.split('\n');
    expect(lines[0]).toBe(`${BOM}"Name";"Flavor";"Region";"State";"Cost (EUR)";"Estimated";`
      + '"Monthly billing";"Created at";"ID"');
    expect(lines[6]).toBe('"Unallocated (deleted instances)";"";;;6,4;0;;;');

    await user.click(resourceButton('Buckets', 'Show all'));

    // The month in the language of the page, not in the French of the API (#33)
    expect(within(screen.getByRole('dialog')).getByText('September 2026')).toBeInTheDocument();
  });

  // Several accounts in the instance, all of them shown by default, or the one the header
  // selects (#121): see fixtures/accounts.js
  describe('with several accounts', () => {
    // The figures of the tab, card after card, as the user reads them: those of its own
    // queries, and the Cloud projects and GPU instances cards, which read the costs by
    // resource type and the GPU costs that the shell loads for the Overview (#118). The GPU
    // instances are those of the inventory that /api/gpu/summary lists, whatever the month.
    const figuresOfTheTab = () => [...figures().children].map((card) => texts(card)).flat();
    const projectRows = () => rowTextsOf(within(cloudProjects()).getByRole('table')).slice(1);
    const openOnAccount = async (label) => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Public Cloud');
      await selectAccount(user, label);
      return { user };
    };

    it('shows the projects and figures of all accounts by default', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Public Cloud');

      expect(figuresOfTheTab()).toEqual([
        'Projets Cloud', '2',
        'Instances', '5', '718,90€',
        'Instances GPU', '1',
        'Kubernetes', '0',
        'Stockage Objet', '3', '25,00€',
        'Volumes', '3', '12,50€',
        'Snapshots', '2', '6,00€',
        'Savings plans', '2', '28,00€',
        'Registre', '1', '40,00€',
      ]);
      expect(projectRows().map(([name]) => name)).toEqual(['Production', 'Staging', 'Sandbox']);
    });

    it('shows the projects and figures of the account selected', async () => {
      const { user } = await openOnAccount('Lyon subsidiary');

      expect(figuresOfTheTab()).toEqual([
        'Projets Cloud', '1',
        'Instances', '5', '538,90€',
        'Instances GPU', '1',
        'Kubernetes', '0',
        'Stockage Objet', '3', '25,00€',
        'Volumes', '3', '12,50€',
        'Snapshots', '2', '6,00€',
        'Savings plans', '2', '28,00€',
        'Registre', '0',
      ]);
      expect(projectRows()).toEqual([
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '▼'],
      ]);

      await selectAccount(user, 'yy2222-ovh');

      expect(figuresOfTheTab()).toEqual([
        'Projets Cloud', '1',
        'Instances', '0', '180,00€',
        'Instances GPU', '0',
        'Kubernetes', '0',
        'Stockage Objet', '0',
        'Volumes', '0',
        'Snapshots', '0',
        'Savings plans', '0',
        'Registre', '1', '40,00€',
      ]);
      expect(projectRows()).toEqual([['Staging', 'ok', '0', '52,35€', '▼']]);
    });

    it('shows the projects of the Unknown account', async () => {
      await openOnAccount('Compte inconnu');

      expect(projectRows()).toEqual([['Sandbox', 'ok', '0', '-', '▼']]);
      // Nothing billed in July, its only month
      expect(figuresOfTheTab()).toEqual([
        'Projets Cloud', '0', 'Instances', '0', 'Instances GPU', '0', 'Kubernetes', '0',
        'Stockage Objet', '0', 'Volumes', '0', 'Snapshots', '0', 'Savings plans', '0',
        'Registre', '0',
      ]);
    });

    // A project belongs to one account: its detail shows under its row, which the list of
    // another account leaves out
    it('shows the detail of a project of the account selected only', async () => {
      const { user } = await openOnAccount('Lyon subsidiary');

      await openProject(user, 'Production');

      expect(detailHeadings()).toEqual([
        ['Consommation par ressource'],
        ['Instances (5)', '538,90€', 'Tout afficher', 'CSV'],
        ['Buckets (4)', '25,00€', 'Tout afficher', 'CSV'],
        ['Volumes (4)', '12,50€', 'Tout afficher', 'CSV'],
        ['Snapshots (2)', '6,00€', 'Tout afficher', 'CSV'],
        ['Savings plans (2)', '28,00€', 'Tout afficher', 'CSV'],
        ['Quotas par région'],
      ]);

      await selectAccount(user, 'yy2222-ovh');

      expect(detailHeadings()).toEqual([]);
    });

    // The month selected stays until the months list of the account loads, and says it lacks
    // it: the header then selects the account's latest month, August (#115, #120)
    it('asks for no figures of a month that the account selected lacks', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Public Cloud');

      await selectAccount(user, 'zz3333-ovh (non configuré)');

      expect(api.fetchPublicCloudStats)
        .not.toHaveBeenCalledWith('2026-09-01', '2026-09-30', removedAccount.id);
      expect(api.fetchPublicCloudStats)
        .toHaveBeenCalledWith('2026-08-01', '2026-08-31', removedAccount.id);
    });

    // The project stays selected across account switches (#56), open only while the account
    // shown lists it: here the Unknown account, whose only month is July
    it('closes the open project under an account that lacks it, and asks nothing of it',
      async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Public Cloud');
        await openProject(user, 'Production');
        const detailRequests = [
          api.fetchProjectConsumption, api.fetchProjectQuotas, api.fetchProjectInstances,
          api.fetchProjectInstanceTotal, api.fetchProjectBuckets, api.fetchProjectVolumes,
          api.fetchProjectSnapshots, api.fetchProjectSavingsPlans,
        ];
        detailRequests.forEach((request) => request.mockClear());

        await selectAccount(user, 'Compte inconnu');

        expect(texts(cloudProjectRow('Sandbox'))).toContain('▼');
        expect(detailHeadings()).toEqual([]);
        detailRequests.forEach((request) => expect(request).not.toHaveBeenCalled());

        await selectAccount(user, 'Tous les comptes');

        // Open again, on July, which all accounts have too
        expect(texts(cloudProjectRow('Production'))).toContain('▲');
        expect(api.fetchProjectInstances)
          .toHaveBeenCalledWith('project-production', '2026-07-01', '2026-07-31');
        expect(detailHeadings()[1]).toEqual(['Instances (0)']);
      });

    describe('account column', () => {
      const WITHOUT_ACCOUNT = [
        'Nom', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○',
      ];

      it('names the account of each project when all accounts are shown', async () => {
        const { user } = await renderDashboard(severalAccounts);

        await openTab(user, 'Public Cloud');

        // Its name, or else its NIC handle, and the Unknown account for a project without one
        expect(rowTextsOf(projectsTable())).toEqual([
          ['Nom', '○', 'Compte', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○'],
          ['Production', 'Customer-facing services', 'Lyon subsidiary', 'ok', '5', '350,00€',
            '▼'],
          ['Staging', 'yy2222-ovh', 'ok', '0', '52,35€', '▼'],
          ['Sandbox', 'Compte inconnu', 'ok', '0', '-', '▼'],
        ]);

        await selectLanguage(user, 'en');

        expect(rowTextsOf(projectsTable())[0]).toEqual([
          'Name', '○', 'Account', '○', 'State', '○', 'Instances', '○', 'Current consumption', '○',
        ]);
        expect(rowTextsOf(projectsTable())[3])
          .toEqual(['Sandbox', 'Unknown account', 'ok', '0', '-', '▼']);
      });

      it('names no account once one is selected, and names them again with all accounts',
        async () => {
          const { user } = await openOnAccount('Lyon subsidiary');

          expect(rowTextsOf(projectsTable())[0]).toEqual(WITHOUT_ACCOUNT);

          await selectAccount(user, 'Tous les comptes');

          expect(rowTextsOf(projectsTable())[0]).toEqual([
            'Nom', '○', 'Compte', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○',
          ]);
        });

      // As before several accounts: an installation with a single account, or one before its
      // first import since the upgrade, whose accounts route lists none
      it.each([
        ['no account', []],
        ['a single account', [lyonAccount]],
      ])('names no account with %s', async (_, accounts) => {
        const { user } = await renderDashboard({ ...severalAccounts, accounts });

        await openTab(user, 'Public Cloud');

        expect(rowTextsOf(projectsTable())[0]).toEqual(WITHOUT_ACCOUNT);
      });
    });

    // The CSV files of the resources of the open project, which leave the page and the
    // project's row: a project's resources belong to its account
    describe('CSV files of the resources of a project', () => {
      // The second cell of each line of a CSV file, its header first
      const secondCells = (file) => file.content.slice(BOM.length).split('\n')
        .map((line) => line.split(';')[1]);

      it.each([
        ['Instances', 6],
        ['Buckets', 4],
        ['Volumes', 4],
        ['Snapshots', 2],
        ['Savings plans', 2],
      ])('name its account after the name of each of its %s, from the panel and the modal',
        async (kind, count) => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Public Cloud');
          await openProject(user, 'Production');

          const [fromPanel, fromModal] =
            await downloadFromPanelAndModal(user, resourcePanel(kind));

          expect(fromModal).toEqual(fromPanel);
          expect(secondCells(fromPanel))
            .toEqual(['"Compte"', ...Array(count).fill('"Lyon subsidiary"')]);
        });

      it('name an account without a name by its NIC handle, in the language of the page',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await selectLanguage(user, 'en');
          await openTab(user, 'Public Cloud');
          await openProject(user, 'Staging');
          const downloadedFiles = captureFileDownloads();

          await user.click(resourceButton('Instances', 'CSV'));

          const [file] = await downloadedFiles();
          expect(file.content.slice(BOM.length).split('\n')).toEqual([
            '"Name";"Account";"Flavor";"Region";"State";"Cost (EUR)";"Estimated";'
              + '"Monthly billing";"Created at";"ID"',
            '"Unallocated (deleted instances)";"yy2222-ovh";"";;;180;0;;;',
          ]);
        });

      it('name no account once one is selected', async () => {
        const { user } = await openOnAccount('Lyon subsidiary');
        await openProject(user, 'Production');

        const [fromPanel, fromModal] =
          await downloadFromPanelAndModal(user, resourcePanel('Volumes'));

        expect(fromModal).toEqual(fromPanel);
        expect(secondCells(fromPanel)[0]).toBe('"Type"');
      });
    });
  });
});
