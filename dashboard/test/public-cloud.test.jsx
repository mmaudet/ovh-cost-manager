import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
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
  openTab,
  panelOf,
  renderDashboard,
  rowTextsOf,
  rowsOf,
  selectLanguage,
  selectMonth,
  settle,
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
  ['Nom', 'Flavor', 'Région', 'État', 'Coût'],
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
  ['Nom', 'Type', 'Région', 'Taille', 'Coût'],
  ['archives-2025', 'Cold Archive', 'archived', 'GRA', '1,5 To', '~', '9,00€'],
  ['assets-example-com', 'Standard', 'GRA', '4,2 Go', '14,00€'],
  ['logs-empty', 'Standard', 'GRA', '0 o', '0,00€'],
  // Billed, but gone from the inventory
  ['old-exports', '†', 'Inconnu', 'SBG', '-', '2,00€'],
];
// Sizes in French units, as those of the buckets (#70)
const volumeRows = [
  ['Nom', 'Type', 'Région', 'Taille', 'Coût'],
  ['db-data', 'high-speed', 'SBG5', '200 Go', '~', '6,50€'],
  ['web-shared', 'classic', 'GRA11', '100 Go', '~', '3,00€'],
  // A bill line with no volume left behind it
  ['Disques supplémentaires à bhs5 de type classic', 'classic', 'bhs5', '-', '~', '1,50€'],
  ['old-backup', 'détaché', 'classic', 'GRA11', '50 Go', '~', '1,50€'],
];
const snapshotRows = [
  ['Nom', 'Région', 'Créé le', 'Taille', 'Coût'],
  ['db-1-before-upgrade', 'SBG5', '28/08/2026', '40 Go', '~4,00€'],
  ['web-1-golden', 'GRA11', '14/02/2026', '10 Go', '~2,00€'],
];
const savingsPlanRows = [
  ['Plan', 'Flavor', 'Couvert', 'Dernière facture', 'Coût'],
  ['savings-plan-b3-8-web', 'b3-8', '2 / 2', '2026-09-01', '20,00€'],
  ['savings-plan-c3-4-legacy', 'c3-4', '1 / 0', '2026-09-01', '8,00€'],
];

describe('Public Cloud tab', () => {
  it('loads its projects and figures when the tab opens, not before', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
    expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
    // The GPU costs of the month load with the page, for the Overview
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-09-01', '2026-09-30');

    await openTab(user, 'Public Cloud');

    expect(api.fetchProjectsEnriched).toHaveBeenCalled();
    expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
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
        ['Nom', 'État', 'Instances', 'Consommation en cours'],
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
        ['Nom', 'Flavor', 'Région', 'État', 'Coût'],
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
        ['Nom', 'Flavor', 'Région', 'État', 'Coût'],
        ['Non attribué (instances supprimées)', '180,00€'],
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
  });

  describe('volumes', () => {
    it('are listed with their share of the bill lines of their region and type', async () => {
      await openProduction();

      const table = resourceTable('Volumes');
      expect(rowTextsOf(table)).toEqual(volumeRows);
      expect(within(table).getByTitle('Attaché à aucune instance')).toHaveTextContent('détaché');
      expect(costsWith(table, PRO_RATA_SHARE)).toEqual(['~6,50€', '~3,00€', '~1,50€', '~1,50€']);
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
      .toEqual(['Name', 'State', 'Instances', 'Current consumption']);

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
    expect(rowsOf(instances)[0]).toEqual(['Name', 'Flavor', 'Region', 'State', 'Cost']);
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
      .toEqual(['Plan', 'Flavor', 'Covered', 'Last billed', 'Cost']);
    const downloadedFiles = captureFileDownloads();

    await user.click(resourceButton('Instances', 'CSV'));

    const [file] = await downloadedFiles();
    const lines = file.content.split('\n');
    expect(lines[0]).toBe(`${BOM}"Name";"Flavor";"Region";"State";"Cost (EUR)";"Estimated";`
      + '"Monthly billing";"Created at";"ID"');
    expect(lines[6]).toBe('"Unallocated (deleted instances)";"";;;6,4;0;;;');
  });
});
