import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { publicCloudFigures } from './fixtures/public-cloud.js';
import { lyonAccount, removedAccount, severalAccounts } from './fixtures/accounts.js';
import { api, holdBack } from './support/api.js';
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
  cloudProjectsTable,
  cloudTotalCard,
  headerOf,
  monthSelector,
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
  tabButton,
  texts,
} from './support/render.jsx';

// The Public Cloud figures of the month, one card each
const figures = () => cardRowOf('Kubernetes');
// The rows of the list of projects, each as the texts it shows, in the order shown: without its
// header, nor its total
const projectRowsShown = () => [...cloudProjectsTable().tBodies[0].rows]
  .map((row) => texts(row));
// The total under the list of projects, as the texts it shows (#180)
const projectListTotal = () => texts(cloudProjectsTable().tFoot);
// What the column of the amounts billed in the month shows for each project, in the order
// shown, '' for a cell that shows nothing: while no project is open (#180)
const billedColumn = () => {
  const table = cloudProjectsTable();
  const column = [...table.tHead.rows[0].cells]
    .findIndex((cell) => /^(Facturé en|Billed in) /.test(cell.textContent));
  return [...table.tBodies[0].rows].map((row) => texts(row.cells[column]).join(' '));
};
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
  ['logs-empty', 'Vide', 'GRA', '0 o', '0,00€'],
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
      'Autres services', '0',
    ]);
  });

  // The cards add up to the cloud total that the month's bills give, and a card gathers the
  // products that no card of their own counts (#145)
  it('adds its cards up to the cloud total billed in the month', async () => {
    const { user } = await renderDashboard({
      ...account,
      publicCloudStats: {
        ...account.publicCloudStats,
        // With the credit, 830,40€, the cloud total of September
        '2026-09': publicCloudFigures({
          instances: { total: 693.4 },
          volumes: { count: 3, total: 12.5 },
          snapshots: { count: 2, total: 6 },
          savingsPlans: { count: 2, total: 28 },
          objectStorage: { count: 3, total: 25 },
          registry: { count: 1, total: 40 },
          other: {
            total: 35.5,
            products: [
              { product: 'databases', total: 30 }, { product: 'loadBalancers', total: 5.5 },
            ],
          },
          credits: { total: -10 },
        }),
      },
    });

    await openTab(user, 'Public Cloud');

    expect(texts(screen.getByText(/^Coûts Public Cloud facturés/))).toEqual([
      'Coûts Public Cloud facturés en septembre 2026 : 830,40€, que détaillent les cartes '
      + 'ci-dessous. OVHcloud facture la consommation à l\'heure le mois suivant : la '
      + 'consommation en cours, en haut de la page et dans la liste des projets, n\'est pas '
      + 'encore facturée.',
    ]);
    expect(texts(figures()).slice(-3)).toEqual(['Autres services', '2', '35,50€']);
    expect(texts(screen.getByText(/^Autres services :/)))
      .toEqual(['Autres services : Bases de données 30,00€ · Load balancers 5,50€']);
    expect(texts(screen.getByText(/^Crédit Cloud utilisé :/)))
      .toEqual(['Crédit Cloud utilisé : -10,00€']);

    await selectLanguage(user, 'en');

    expect(texts(screen.getByText(/^Public Cloud costs billed/))).toEqual([
      'Public Cloud costs billed in September 2026: 830.40€, which the cards below break down. '
      + 'OVHcloud bills hourly usage the month after: the current consumption, at the top of '
      + 'the page and in the list of projects, is not billed yet.',
    ]);
    expect(texts(figures()).slice(-3)).toEqual(['Other services', '2', '35.50€']);
    expect(texts(screen.getByText(/^Other services:/)))
      .toEqual(['Other services: Databases 30.00€ · Load balancers 5.50€']);
    expect(texts(screen.getByText(/^Cloud credit used:/)))
      .toEqual(['Cloud credit used: -10.00€']);
  });

  describe('projects', () => {
    // What each consumed since the 1st of the current month, not billed yet, and what the bills
    // of the month selected charged it, which OVHcloud bills the month after use (#180)
    it('are listed with their state, instance count, current consumption and billed amount',
      async () => {
        const { user } = await renderDashboard();

        await openTab(user, 'Public Cloud');

        expect(rowTextsOf(within(cloudProjects()).getByRole('table'))).toEqual([
          ['Nom', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○',
            'Facturé en septembre 2026', '○'],
          ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '610,40€', '▼'],
          ['Staging', 'ok', '0', '52,35€', '220,00€', '▼'],
          // Nothing consumed, and no bill line of the month
          ['Sandbox', 'ok', '0', '-', '-', '▼'],
          ['Total Cloud', '830,40€'],
        ]);
        expect(detailHeadings()).toEqual([]);
      });

    // The bills of a month charge what the projects used the month before: what they billed
    // follows the month selected, not what the projects consume in the current month
    it('give what the month selected billed them, and their current consumption whatever it',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Public Cloud');

        await selectMonth(user, 'Août 2026');

        expect(headerOf(cloudProjectsTable())).toEqual([
          'Nom○', 'État○', 'Instances○', 'Consommation en cours○', 'Facturé en août 2026○', '',
        ]);
        expect(projectRowsShown()).toEqual([
          ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '512,00€', '▼'],
          ['Staging', 'ok', '0', '52,35€', '190,00€', '▼'],
          ['Sandbox', 'ok', '0', '-', '-', '▼'],
        ]);
        expect(projectListTotal()).toEqual(['Total Cloud', '702,00€']);
        expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '702,00€', 'Public Cloud']);
      });

    // As after a change of month, the page showing the month once its figures have loaded: rather
    // than show that nothing was billed, or a total that the amounts would not add up to, the
    // list gives neither until what the month billed its projects loads (#62, #180)
    it('give no amount until what the month billed them loads', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');
      const releaseAugust = holdBack(api.fetchByProject, (from) => from === '2026-08-01');

      await user.selectOptions(monthSelector(), 'Août 2026');
      await screen.findByRole('columnheader', { name: /^Facturé en août 2026/ });

      expect(projectRowsShown()).toEqual([
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '▼'],
        ['Staging', 'ok', '0', '52,35€', '▼'],
        ['Sandbox', 'ok', '0', '-', '▼'],
      ]);
      expect(cloudProjectsTable().tFoot).toBeNull();

      releaseAugust();
      await settle();

      expect(billedColumn()).toEqual(['512,00€', '190,00€', '-']);
      expect(projectListTotal()).toEqual(['Total Cloud', '702,00€']);
    });

    it('give no amount when what the month billed them cannot load', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');
      api.fetchByProject.mockRejectedValue(new Error('Request failed with status code 500'));

      await selectMonth(user, 'Août 2026');

      expect(billedColumn()).toEqual(['', '', '']);
      expect(cloudProjectsTable().tFoot).toBeNull();
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
        ['Autres services (1)', '40,00€'],
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

      await sortTable(user, cloudProjectsTable(), /^Consommation en cours/);
      await sortTable(user, cloudProjectsTable(), /^Consommation en cours/);

      // The least consuming first, and last the project that consumed nothing
      expect(rowTextsOf(cloudProjectsTable())).toEqual([
        ['Nom', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '▲',
          'Facturé en septembre 2026', '○'],
        ['Staging', 'ok', '0', '52,35€', '220,00€', '▼'],
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '610,40€', '▼'],
        ['Sandbox', 'ok', '0', '-', '-', '▼'],
        // The total stays under them
        ['Total Cloud', '830,40€'],
      ]);

      await openProject(user, 'Production');
      // By the header of the list, rather than one of the tables of the project's detail
      await sortTable(user, cloudProjectsTable().tHead, /^Nom/);

      expect(headerOf(cloudProjectsTable())).toEqual([
        'Nom▲', 'État○', 'Instances○', 'Consommation en cours○', 'Facturé en septembre 2026○', '',
      ]);
      // Each row by its first text: Production, its detail, then the other projects
      expect([...cloudProjectsTable().tBodies[0].rows].map((row) => texts(row)[0]))
        .toEqual(['Production', 'Consommation par ressource', 'Sandbox', 'Staging']);
    });

    // What the reporter of #180 looked for: amounts by project that add up to the Cloud total
    // of the month, which the list gives under them
    it('add up what the month billed them to its Cloud total', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Public Cloud');

      expect(billedColumn()).toEqual(['610,40€', '220,00€', '-']);
      // 610,40€ + 220,00€, the Cloud total of the KPI card
      expect(projectListTotal()).toEqual(['Total Cloud', '830,40€']);
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '830,40€', 'Public Cloud']);
    });

    // As the other columns (#146), by the amount, whatever the month's bills gave it: the
    // project that no bill line of the month names comes last either way, as a project that
    // consumed nothing does
    it('sort by what the month billed them, the project billed nothing last', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Public Cloud');
      const projectNames = () => projectRowsShown().map(([name]) => name);

      await sortTable(user, cloudProjectsTable(), /^Facturé en/);

      expect(headerOf(cloudProjectsTable()).at(-2)).toBe('Facturé en septembre 2026▼');
      expect(projectNames()).toEqual(['Production', 'Staging', 'Sandbox']);

      await sortTable(user, cloudProjectsTable(), /^Facturé en/);

      expect(headerOf(cloudProjectsTable()).at(-2)).toBe('Facturé en septembre 2026▲');
      expect(projectNames()).toEqual(['Staging', 'Production', 'Sandbox']);
    });

    // The list gives the projects of the inventory, which may lack a project billed in the
    // month: here Staging, which September billed 220,00€
    describe('billed in the month that the list lacks', () => {
      const withoutStaging = () => {
        const [production, , sandbox] = account.projectsEnriched;
        return { ...account, projectsEnriched: [production, sandbox] };
      };
      // That of the account whose bills charged it, whether another account holds it or none
      const NOT_IN_INVENTORY = "Facturé mais absent de l'inventaire des projets du compte";

      it('have a row of their own, after the others, so that the list adds up to the Cloud total',
        async () => {
          const { user } = await renderDashboard(withoutStaging());

          await openTab(user, 'Public Cloud');

          // Its id, as the server may not name it, and what the month billed it only
          expect(projectRowsShown()).toEqual([
            ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '610,40€', '▼'],
            ['Sandbox', 'ok', '0', '-', '-', '▼'],
            ['Staging', '†', 'project-staging', '-', '-', '-', '220,00€'],
          ]);
          expect(within(cloudProjectsTable()).getByTitle(NOT_IN_INVENTORY)).toHaveTextContent('†');
          expect(projectListTotal()).toEqual(['Total Cloud', '830,40€']);

          await selectLanguage(user, 'en');

          expect(within(cloudProjectsTable())
            .getByTitle("Billed but not in the account's project inventory"))
            .toHaveTextContent('†');
        });

      // Such as the projects of an account whose inventory another account holds
      it('show when the list has no project of its own', async () => {
        const { user } = await renderDashboard({ ...account, projectsEnriched: [] });

        await openTab(user, 'Public Cloud');

        expect(projectRowsShown()).toEqual([
          ['Production', '†', 'project-production', '-', '-', '-', '610,40€'],
          ['Staging', '†', 'project-staging', '-', '-', '-', '220,00€'],
        ]);
        expect(projectListTotal()).toEqual(['Total Cloud', '830,40€']);
      });

      // Which projects the list lacks tells only once it has loaded: until then, as when the tab
      // first opens, the page shows no list, rather than every project billed as one that the
      // inventory lacks
      it('wait for the list of projects to load', async () => {
        const { user } = await renderDashboard();
        const release = holdBack(api.fetchProjectsEnriched);

        // Without openTab(), which would wait for the list held back
        await user.click(tabButton('Public Cloud'));

        expect(screen.queryByRole('heading', { name: 'Projets Cloud' })).not.toBeInTheDocument();
        expect(screen.queryByTitle(NOT_IN_INVENTORY)).not.toBeInTheDocument();

        release();
        await settle();

        expect(projectRowsShown().map(([name]) => name))
          .toEqual(['Production', 'Staging', 'Sandbox']);
        expect(screen.queryByTitle(NOT_IN_INVENTORY)).not.toBeInTheDocument();
      });

      // The inventory has none of its resources
      it('have no detail to open', async () => {
        const { user } = await renderDashboard(withoutStaging());
        await openTab(user, 'Public Cloud');

        await user.click(within(cloudProjectsTable()).getByText('Staging'));
        await settle();

        expect(detailHeadings()).toEqual([]);
        expect(api.fetchProjectConsumption).not.toHaveBeenCalled();
        expect(api.fetchProjectInstances).not.toHaveBeenCalled();
      });

      // They have no state, instance count or consumption in the list: they come last by those,
      // either way, as a project without a value there does (#146)
      it('sort by what the month billed them, and last by what the list lacks of them',
        async () => {
          const { user } = await renderDashboard(withoutStaging());
          await openTab(user, 'Public Cloud');
          const projectNames = () => projectRowsShown().map(([name]) => name);

          await sortTable(user, cloudProjectsTable(), /^Facturé en/);

          expect(projectNames()).toEqual(['Production', 'Staging', 'Sandbox']);

          await sortTable(user, cloudProjectsTable(), /^Instances/);

          expect(projectNames()).toEqual(['Production', 'Sandbox', 'Staging']);

          await sortTable(user, cloudProjectsTable(), /^Instances/);

          expect(projectNames()).toEqual(['Sandbox', 'Production', 'Staging']);
        });
    });

    // Which ways of moving around the page keep the open project: see navigation.test.jsx (#56)
  });

  describe('project detail', () => {
    // The products that no section of its own lists, from the bills of the month (#145)
    it('names the other services of the project, its registry among them', async () => {
      await openProduction();

      const panel = panelOf(screen.getByRole('heading', { name: /^Autres services \(/ }));
      expect(rowTextsOf(within(panel).getByRole('table'))).toEqual([['Registre', '40,00€']]);
    });

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
        'Autres services', '0',
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

    // OVHcloud gives a class to each object: an empty bucket has none (#145)
    it('say that an empty bucket has no class, and why', async () => {
      await openProduction();

      expect(within(resourceTable('Buckets')).getByText('Vide')).toHaveAttribute(
        'title', "Un bucket vide n'a pas de classe : OVHcloud en donne une à chaque objet",
      );
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
        '"logs-empty";;;"GRA";0;0;0;0;1;"2026-09-10T08:00:00Z"',
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

  // The panel and the "show all" modal of each resource table share its order (#146)
  it.each(['Instances', 'Buckets', 'Volumes', 'Snapshots', 'Savings plans'])(
    'shows the %s in their "show all" modal in the order of their panel',
    async (kind) => {
      const { user } = await openProduction();
      // The least expensive first
      await sortTable(user, resourceTable(kind), /^Coût/);
      await sortTable(user, resourceTable(kind), /^Coût/);
      const panelOrder = namesIn(resourceTable(kind));

      const dialog = await showAll(user, kind);

      const tableOfDialog = within(dialog).getByRole('table');
      expect(headerOf(tableOfDialog).at(-1)).toBe('Coût▲');
      expect(namesIn(tableOfDialog)).toEqual(panelOrder);
    },
  );

  it('shows only its figures when there is no Public Cloud project', async () => {
    // None in the inventory, and none that the bills of the month name, which the list would
    // give (#180)
    const { user } = await renderDashboard({ ...account, projectsEnriched: [], byProject: {} });

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
    expect(rowTextsOf(within(cloudProjects()).getByRole('table'))[0]).toEqual([
      'Name', '○', 'State', '○', 'Instances', '○', 'Current consumption', '○',
      'Billed in September 2026', '○',
    ]);
    expect(projectListTotal()).toEqual(['Cloud Total', '830.40€']);

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
      'Other services', '0',
    ]);
    expect(detailHeadings()).toEqual([
      ['Consumption by resource'],
      ['Instances (5)', '538.90€', 'Show all', 'CSV'],
      ['Buckets (4)', '25.00€', 'Show all', 'CSV'],
      ['Volumes (4)', '12.50€', 'Show all', 'CSV'],
      ['Snapshots (2)', '6.00€', 'Show all', 'CSV'],
      ['Savings plans (2)', '28.00€', 'Show all', 'CSV'],
      ['Other services (1)', '40.00€'],
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
      ['logs-empty', 'Empty', 'GRA', '0 B', '0.00€'],
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
        'Autres services', '0',
      ]);
      expect(projectRowsShown().map(([name]) => name))
        .toEqual(['Production', 'Staging', 'Sandbox']);
      expect(projectListTotal()).toEqual(['Total Cloud', '830,40€']);
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
        'Autres services', '0',
      ]);
      expect(projectRowsShown()).toEqual([
        ['Production', 'Customer-facing services', 'ok', '5', '350,00€', '610,40€', '▼'],
      ]);
      // What the account's bills of the month charged its projects: its Cloud total (#180)
      expect(projectListTotal()).toEqual(['Total Cloud', '610,40€']);
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '610,40€', 'Public Cloud']);

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
        'Autres services', '0',
      ]);
      expect(projectRowsShown()).toEqual([['Staging', 'ok', '0', '52,35€', '220,00€', '▼']]);
      expect(projectListTotal()).toEqual(['Total Cloud', '220,00€']);
      expect(texts(cloudTotalCard())).toEqual(['Total Cloud', '220,00€', 'Public Cloud']);
    });

    it('shows the projects of the Unknown account', async () => {
      await openOnAccount('Compte inconnu');

      expect(projectRowsShown()).toEqual([['Sandbox', 'ok', '0', '-', '-', '▼']]);
      expect(projectListTotal()).toEqual(['Total Cloud', '0,00€']);
      // Nothing billed in July, its only month
      expect(figuresOfTheTab()).toEqual([
        'Projets Cloud', '0', 'Instances', '0', 'Instances GPU', '0', 'Kubernetes', '0',
        'Stockage Objet', '0', 'Volumes', '0', 'Snapshots', '0', 'Savings plans', '0',
        'Registre', '0',
        'Autres services', '0',
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
        ['Autres services (1)', '40,00€'],
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
        'Facturé en septembre 2026', '○',
      ];

      it('names the account of each project when all accounts are shown', async () => {
        const { user } = await renderDashboard(severalAccounts);

        await openTab(user, 'Public Cloud');

        // Its name, or else its NIC handle, and the Unknown account for a project without one
        expect(rowTextsOf(cloudProjectsTable())).toEqual([
          ['Nom', '○', 'Compte', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○',
            'Facturé en septembre 2026', '○'],
          ['Production', 'Customer-facing services', 'Lyon subsidiary', 'ok', '5', '350,00€',
            '610,40€', '▼'],
          ['Staging', 'yy2222-ovh', 'ok', '0', '52,35€', '220,00€', '▼'],
          ['Sandbox', 'Compte inconnu', 'ok', '0', '-', '-', '▼'],
          ['Total Cloud', '830,40€'],
        ]);

        await selectLanguage(user, 'en');

        expect(rowTextsOf(cloudProjectsTable())[0]).toEqual([
          'Name', '○', 'Account', '○', 'State', '○', 'Instances', '○', 'Current consumption', '○',
          'Billed in September 2026', '○',
        ]);
        expect(rowTextsOf(cloudProjectsTable())[3])
          .toEqual(['Sandbox', 'Unknown account', 'ok', '0', '-', '-', '▼']);
      });

      // What the month billed each account's projects, which the Overview's breakdown by project
      // loads for the month (#118)
      it('gives no amount until what the month billed each account loads', async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Public Cloud');
        const releaseAugust = holdBack(api.fetchProjectsByAccount, (from) => from === '2026-08-01');

        await user.selectOptions(monthSelector(), 'Août 2026');
        await screen.findByRole('columnheader', { name: /^Facturé en août 2026/ });

        expect(billedColumn()).toEqual(['', '', '']);
        expect(cloudProjectsTable().tFoot).toBeNull();

        releaseAugust();
        await settle();

        expect(billedColumn()).toEqual(['512,00€', '190,00€', '-']);
        expect(projectListTotal()).toEqual(['Total Cloud', '702,00€']);
      });

      // What the bills of the month charged a project is then what those of each account
      // charged it, as in the Overview's breakdown by project (#118)
      it('names the account whose bills charged a project that the list lacks', async () => {
        const [lyonProduction, , unknownSandbox] = severalAccounts.projectsEnriched;
        const { user } = await renderDashboard({
          ...severalAccounts, projectsEnriched: [lyonProduction, unknownSandbox],
        });

        await openTab(user, 'Public Cloud');

        expect(projectRowsShown()).toEqual([
          ['Production', 'Customer-facing services', 'Lyon subsidiary', 'ok', '5', '350,00€',
            '610,40€', '▼'],
          ['Sandbox', 'Compte inconnu', 'ok', '0', '-', '-', '▼'],
          ['Staging', '†', 'project-staging', 'yy2222-ovh', '-', '-', '-', '220,00€'],
        ]);
        expect(projectListTotal()).toEqual(['Total Cloud', '830,40€']);
      });

      it('names no account once one is selected, and names them again with all accounts',
        async () => {
          const { user } = await openOnAccount('Lyon subsidiary');

          expect(rowTextsOf(cloudProjectsTable())[0]).toEqual(WITHOUT_ACCOUNT);

          await selectAccount(user, 'Tous les comptes');

          expect(rowTextsOf(cloudProjectsTable())[0]).toEqual([
            'Nom', '○', 'Compte', '○', 'État', '○', 'Instances', '○', 'Consommation en cours', '○',
            'Facturé en septembre 2026', '○',
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

        expect(rowTextsOf(cloudProjectsTable())[0]).toEqual(WITHOUT_ACCOUNT);
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
