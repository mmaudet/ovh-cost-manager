import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, threeBilledProjects } from './fixtures/account.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from './fixtures/accounts.js';
import { api } from './support/api.js';
import { captureFileDownloads } from './support/downloads.js';
import {
  cardOf,
  cardRowOf,
  cloudProjectRow,
  firstColumnOf,
  headerBadge,
  headerOf,
  openTab,
  renderDashboard,
  rowsOf,
  selectAccount,
  selectLanguage,
  selectMonth,
  settle,
  sortTable,
  texts,
} from './support/render.jsx';

// What the Overview shows of the selected month, as the page requests it: for the account
// selected in the header, the last argument, null for all accounts (#118)
const figuresOfTheMonth = [
  api.fetchByService,
  api.fetchByProject,
  api.fetchByResourceType,
  api.fetchGpuSummary,
];
const serviceTypes = (heading = 'Répartition par service') => cardOf(heading);
const resourceTypes = (heading = 'Répartition par type de ressource') => cardOf(heading);
const gpuCosts = (heading = 'Coûts GPU') => cardOf(heading);
const projectBreakdown = (heading = 'Répartition par projet') => cardOf(heading);
const projectTable = () => within(projectBreakdown()).getByRole('table');
const projectRows = () => rowsOf(projectTable());
const budget = (heading = 'Consommation du budget') => cardOf(heading);
const budgetInput = () => within(budget()).getByRole('spinbutton');
const typeBudget = async (user, amount) => {
  await user.tripleClick(budgetInput());
  await user.keyboard(amount);
};
const forecastCard = () => cardOf('Prévision fin de mois');
// The buttons of the resource type breakdown that open the Infrastructure tab
// and, in a month billed for domains, the Web Cloud tab
const infrastructureDetailButton = () =>
  screen.getByRole('button', { name: 'Voir le détail infrastructure →' });
const webCloudDetailButton = () =>
  screen.queryByRole('button', { name: 'Voir le détail Web Cloud (domaines) →' });

// Seven services of the inventory that expire within 30 days or already have,
// as /api/inventory/expiring answers since #74: servers, VPS and storage
// services in one list, soonest first, so the expired one first
const expiringSoon = [
  { id: 'vps-2c3d4e5f.vps.ovh.net', display_name: 'legacy-vps',
    type: 'vps', expiration_date: '2026-09-10' },
  { id: 'ns3000003.ip-203-0-113.eu', display_name: null,
    type: 'dedicated_server', expiration_date: '2026-09-17' },
  { id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
    type: 'dedicated_server', expiration_date: '2026-09-20' },
  { id: 'netapp-8c9d0e1f', display_name: 'archives-nas',
    type: 'storage', expiration_date: '2026-10-02' },
  { id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
    type: 'vps', expiration_date: '2026-10-10' },
  { id: 'vps-4e5f6a7b.vps.ovh.net', display_name: 'staging-vps',
    type: 'vps', expiration_date: '2026-10-12' },
  { id: 'netapp-5f2c9a1e', display_name: 'shared-files',
    type: 'storage', expiration_date: '2026-10-14' },
];
// Four services that expired or expire one or two days from today, 15 September
const oneOrTwoDaysAway = [
  { id: 'vps-2c3d4e5f.vps.ovh.net', display_name: 'legacy-vps',
    type: 'vps', expiration_date: '2026-09-13' },
  { id: 'netapp-5f2c9a1e', display_name: 'shared-files',
    type: 'storage', expiration_date: '2026-09-14' },
  { id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
    type: 'dedicated_server', expiration_date: '2026-09-16' },
  { id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
    type: 'vps', expiration_date: '2026-09-17' },
];
const expirationCard = (heading = 'Expirations proches') =>
  cardOf(screen.getByRole('heading', { name: heading }));

describe('Overview tab', () => {
  it('loads everything it shows with the page', async () => {
    await renderDashboard();

    for (const fetchFigures of figuresOfTheMonth) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
    }
    // For all accounts (null), as the instance knows a single one (#123)
    expect(api.fetchExpiringServices).toHaveBeenCalledWith(30, null);
    // The budget
    expect(api.fetchConfig).toHaveBeenCalled();
  });

  it('keeps loading the figures of the selected month while another tab is open', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Web Cloud');

    await selectMonth(user, 'Juillet 2026');

    for (const fetchFigures of figuresOfTheMonth) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
    }
  });

  it('shows the cost of each service type of the month', async () => {
    await renderDashboard();

    // Besides a chart
    expect(texts(serviceTypes())).toEqual([
      'Répartition par service',
      'Compute', '800,40€',
      'Storage', '250,00€',
      'Other', '200,00€',
    ]);
  });

  it('shows the cost of each resource type of the month, with links to their tabs', async () => {
    await renderDashboard();

    // Labelled by the server, in English only
    expect(texts(resourceTypes())).toEqual([
      'Répartition par type de ressource',
      'Public Cloud', '830,40€',
      'Dedicated Servers', '270,00€',
      'Backup', '90,00€',
      'Domains', '35,00€',
      'Licenses', '25,00€',
      'Voir le détail infrastructure →',
      'Voir le détail Web Cloud (domaines) →',
    ]);
  });

  it('follows the month selector', async () => {
    const { user } = await renderDashboard();

    await selectMonth(user, 'Août 2026');

    expect(texts(serviceTypes())).toEqual([
      'Répartition par service',
      'Compute', '690,00€',
      'Storage', '202,00€',
      'Other', '150,00€',
    ]);
    expect(texts(resourceTypes()).slice(0, 9)).toEqual([
      'Répartition par type de ressource',
      'Public Cloud', '702,00€',
      'Dedicated Servers', '270,00€',
      'Backup', '40,00€',
      'Domains', '30,00€',
    ]);
    // 310 / 702
    expect(texts(gpuCosts()).slice(0, 3))
      .toEqual(['Coûts GPU', '310,00€', '(44,2 % du cloud)']);
    expect(projectRows()).toEqual([
      ['Projet○', 'Montant▼', '%'],
      ['Production', '512,00€', '72,9 %'],
      ['Staging', '190,00€', '27,1 %'],
      ['Total Cloud', '702,00€', '100 %'],
    ]);
    expect(texts(budget()).slice(0, 3))
      .toEqual(['Consommation du budget', '2 % utilisé', 'Consommé: 1 042,00€']);
  });

  describe('links', () => {
    it('open the Infrastructure tab from the resource type breakdown', async () => {
      const { user } = await renderDashboard();

      await user.click(infrastructureDetailButton());
      await settle();

      expect(texts(cardRowOf('Serveurs dédiés')).slice(0, 3))
        .toEqual(['Serveurs dédiés', '1', '270,00€']);
      expect(screen.queryByText('Répartition par service')).not.toBeInTheDocument();
    });

    it('open the Web Cloud tab from the resource type breakdown', async () => {
      const { user } = await renderDashboard();

      await user.click(webCloudDetailButton());
      await settle();

      // For all accounts (null)
      expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30', null);
      expect(screen.getByText('12 mois glissants')).toBeInTheDocument();
      expect(screen.queryByText('Répartition par service')).not.toBeInTheDocument();
    });

    it('lead to the Web Cloud tab only in a month billed for domains', async () => {
      const withoutDomains = account.byResourceType['2026-09']
        .filter((type) => type.resource_type !== 'domain');
      const { user } = await renderDashboard({
        ...account,
        byResourceType: { ...account.byResourceType, '2026-09': withoutDomains },
      });

      expect(webCloudDetailButton()).not.toBeInTheDocument();

      await selectMonth(user, 'Août 2026');

      expect(webCloudDetailButton()).toBeInTheDocument();
    });

    it('open a project of the project breakdown on the Public Cloud tab', async () => {
      const { user } = await renderDashboard();

      await user.click(within(projectBreakdown()).getByRole('button', { name: 'Staging' }));
      await settle();

      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-staging', '2026-09-01', '2026-09-30');
      expect(texts(cloudProjectRow('Staging'))).toEqual(['Staging', 'ok', '0', '52,35€', '▲']);
    });

    it('open a project of the GPU costs on the Public Cloud tab', async () => {
      const { user } = await renderDashboard();

      await user.click(within(gpuCosts()).getByRole('button', { name: 'Production' }));
      await settle();

      expect(texts(cloudProjectRow('Production')))
        .toEqual(['Production', 'Customer-facing services', 'ok', '5', '350,00€', '▲']);
    });
  });

  describe('GPU costs', () => {
    it('show the GPU costs of the month by model and by project, in the Cloud total', async () => {
      await renderDashboard();

      // 420.50 / 830.40
      expect(texts(gpuCosts())).toEqual([
        'Coûts GPU', '420,50€', '(50,6 % du cloud)',
        'Par modèle GPU', 'NVIDIA L4', '420,50€',
        'Par projet', 'Projet', 'Types GPU', 'Montant',
        'Production', 'l4-90', '420,50€', '100,0 %',
        'Total GPU', '420,50€',
      ]);
    });

    it('are left out of a month without any', async () => {
      const { user } = await renderDashboard();

      await selectMonth(user, 'Juillet 2026');

      expect(screen.queryByText('Coûts GPU')).not.toBeInTheDocument();
    });
  });

  describe('project breakdown', () => {
    // The columns with their sort marks, and the projects in the order shown
    const header = () => headerOf(projectTable());
    const projects = () => firstColumnOf(projectTable());

    it('breaks the Cloud total down by project, most expensive first', async () => {
      await renderDashboard();

      expect(projectRows()).toEqual([
        ['Projet○', 'Montant▼', '%'],
        ['Production', '610,40€', '73,5 %'],
        ['Staging', '220,00€', '26,5 %'],
        ['Total Cloud', '830,40€', '100 %'],
      ]);
    });

    // With its decimal, as the other shares, and as the Backup tab writes the share of a
    // month without cost (#64), where it read 0% (#87)
    it('gives each project a share of 0,0 % of a Cloud total of 0 €', async () => {
      const september = { ...account.summary['2026-09'], cloudTotal: 0 };
      await renderDashboard({ ...account, summary: { ...account.summary, '2026-09': september } });

      expect(projectRows()).toEqual([
        ['Projet○', 'Montant▼', '%'],
        ['Production', '610,40€', '0,0 %'],
        ['Staging', '220,00€', '0,0 %'],
        ['Total Cloud', '0,00€', '100 %'],
      ]);
    });

    it('sorts the projects by amount or by name, each way in turn', async () => {
      const { user } = await renderDashboard({ ...account, ...threeBilledProjects });
      expect(projectRows()).toEqual([
        ['Projet○', 'Montant▼', '%'],
        ['Production', '460,40€', '55,4 %'],
        ['Staging', '250,00€', '30,1 %'],
        ['Sandbox', '120,00€', '14,5 %'],
        ['Total Cloud', '830,40€', '100 %'],
      ]);

      await sortTable(user, projectTable(), /^Montant/);

      expect(header()).toEqual(['Projet○', 'Montant▲', '%']);
      expect(projects()).toEqual(['Sandbox', 'Staging', 'Production']);

      await sortTable(user, projectTable(), /^Projet/);

      expect(header()).toEqual(['Projet▼', 'Montant○', '%']);
      expect(projects()).toEqual(['Staging', 'Sandbox', 'Production']);

      await sortTable(user, projectTable(), /^Projet/);

      expect(header()).toEqual(['Projet▲', 'Montant○', '%']);
      expect(projects()).toEqual(['Production', 'Sandbox', 'Staging']);

      await sortTable(user, projectTable(), /^Montant/);

      expect(header()).toEqual(['Projet○', 'Montant▼', '%']);
      expect(projects()).toEqual(['Production', 'Staging', 'Sandbox']);
    });

    it('keeps its sort order when the user comes back to the tab', async () => {
      const { user } = await renderDashboard();
      await sortTable(user, projectTable(), /^Projet/);

      await openTab(user, 'Tendances');
      await openTab(user, "Vue d'ensemble");

      expect(projectRows()).toEqual([
        ['Projet▼', 'Montant○', '%'],
        ['Staging', '220,00€', '26,5 %'],
        ['Production', '610,40€', '73,5 %'],
        ['Total Cloud', '830,40€', '100 %'],
      ]);
    });
  });

  describe('budget', () => {
    it('shows the share of the budget the month has used', async () => {
      await renderDashboard();

      // 1 250.40 / 50 000
      expect(texts(budget())).toEqual([
        'Consommation du budget', '3 % utilisé', 'Consommé: 1 250,40€', 'Budget:', '€',
      ]);
      expect(budgetInput()).toHaveValue(50000);
    });

    it('starts from the budget of the configuration', async () => {
      await renderDashboard({ ...account, config: { budget: 2000, currency: 'EUR' } });

      expect(budgetInput()).toHaveValue(2000);
      // 1 250.40 / 2 000
      expect(texts(budget())).toContain('63 % utilisé');
    });

    it('takes the budget the user types, and flags a forecast above it', async () => {
      const { user } = await renderDashboard();
      expect(texts(forecastCard())).toContain('14/30 jours');

      await typeBudget(user, '800');

      // 1 250.40 / 800
      expect(texts(budget())).toEqual([
        'Consommation du budget', '156 % utilisé', 'Consommé: 1 250,40€', 'Budget:', '€',
      ]);
      // The forecast of 862.18 goes over it
      expect(texts(forecastCard()))
        .toEqual(['Prévision fin de mois', 'Septembre 2026', '862,18€', '> Budget!']);
    });

    it('keeps the budget the user typed across tabs', async () => {
      const { user } = await renderDashboard();
      await typeBudget(user, '800');

      await openTab(user, 'Tendances');

      expect(texts(forecastCard())).toContain('> Budget!');

      await openTab(user, "Vue d'ensemble");

      expect(budgetInput()).toHaveValue(800);
      expect(texts(budget())).toContain('156 % utilisé');
    });
  });

  // #74: the server listed the servers first, so that the card could miss the services that
  // expire soonest, and a service already expired read "Expire dans -5 jours"
  it('lists the five services that expire soonest, those already expired first', async () => {
    await renderDashboard({ ...account, expiringServices: expiringSoon });

    // A service without a display name shows its id
    expect(texts(cardOf(screen.getByRole('heading', { name: 'Expirations proches' })))).toEqual([
      'Expirations proches',
      'VPS', 'legacy-vps', 'Expiré depuis 5 jours',
      'Serveurs dédiés', 'ns3000003.ip-203-0-113.eu', 'Expire dans 2 jours',
      'Serveurs dédiés', 'backup-server', 'Expire dans 5 jours',
      'Stockage', 'archives-nas', 'Expire dans 17 jours',
      'VPS', 'vps-0a1b2c3d.vps.ovh.net', 'Expire dans 25 jours',
    ]);
    // All seven in the header, the expired one included, as in the card
    expect(texts(headerBadge('Expirations proches'))).toEqual(['7', 'Expirations proches']);
  });

  // #74: a single day read "1 jours", and "1 days" in English
  it('counts the days in the singular or the plural, as each language needs', async () => {
    const { user } = await renderDashboard({ ...account, expiringServices: oneOrTwoDaysAway });

    expect(texts(expirationCard())).toEqual([
      'Expirations proches',
      'VPS', 'legacy-vps', 'Expiré depuis 2 jours',
      'Stockage', 'shared-files', 'Expiré depuis 1 jour',
      'Serveurs dédiés', 'backup-server', 'Expire dans 1 jour',
      'VPS', 'vps-0a1b2c3d.vps.ovh.net', 'Expire dans 2 jours',
    ]);

    await selectLanguage(user, 'en');

    expect(texts(expirationCard('Expiring soon'))).toEqual([
      'Expiring soon',
      'VPS', 'legacy-vps', 'Expired 2 days ago',
      'Storage', 'shared-files', 'Expired 1 day ago',
      'Dedicated Servers', 'backup-server', 'Expires in 1 day',
      'VPS', 'vps-0a1b2c3d.vps.ovh.net', 'Expires in 2 days',
    ]);
  });

  it('speaks English when the page does', async () => {
    const { user } = await renderDashboard({ ...account, expiringServices: expiringSoon });

    await selectLanguage(user, 'en');

    expect(texts(serviceTypes('Breakdown by service'))).toEqual([
      'Breakdown by service', 'Compute', '800.40€', 'Storage', '250.00€', 'Other', '200.00€',
    ]);
    expect(texts(resourceTypes('Breakdown by resource type')).slice(-2)).toEqual([
      'View infrastructure detail →', 'View Web Cloud detail (domains) →',
    ]);
    expect(texts(gpuCosts('GPU Costs'))).toEqual([
      'GPU Costs', '420.50€', '(50.6% of cloud)',
      'By GPU model', 'NVIDIA L4', '420.50€',
      'By project', 'Project', 'GPU types', 'Amount',
      'Production', 'l4-90', '420.50€', '100.0%',
      'GPU Total', '420.50€',
    ]);
    expect(rowsOf(within(projectBreakdown('Breakdown by project')).getByRole('table'))).toEqual([
      ['Project○', 'Amount▼', '%'],
      ['Production', '610.40€', '73.5%'],
      ['Staging', '220.00€', '26.5%'],
      ['Cloud Total', '830.40€', '100%'],
    ]);
    expect(texts(budget('Budget consumption')))
      .toEqual(['Budget consumption', '3% used', 'Consumed: 1,250.40€', 'Budget:', '€']);
    // A service already expired, then one about to (#74)
    expect(texts(cardOf(screen.getByRole('heading', { name: 'Expiring soon' }))).slice(0, 7))
      .toEqual([
        'Expiring soon',
        'VPS', 'legacy-vps', 'Expired 5 days ago',
        'Dedicated Servers', 'ns3000003.ip-203-0-113.eu', 'Expires in 2 days',
      ]);
  });

  // An instance of several accounts (#118): the tab shows the figures of the account selected
  // in the header, or those of all accounts, where its lists name the account of each project,
  // and the services about to expire of each (#123). The budget follows it in its own ticket
  // (#117).
  describe('with several accounts', () => {
    // The breakdown by project and the GPU costs of September, with a single account, or with
    // all accounts but without the Account column
    const projectsOfOneAccount = [
      ['Projet○', 'Montant▼', '%'],
      ['Production', '610,40€', '73,5 %'],
      ['Staging', '220,00€', '26,5 %'],
      ['Total Cloud', '830,40€', '100 %'],
    ];
    const gpuCostsOfOneAccount = [
      'Coûts GPU', '420,50€', '(50,6 % du cloud)',
      'Par modèle GPU', 'NVIDIA L4', '420,50€',
      'Par projet', 'Projet', 'Types GPU', 'Montant',
      'Production', 'l4-90', '420,50€', '100,0 %',
      'Total GPU', '420,50€',
    ];

    it('loads its figures for the account selected, of a month the account was billed',
      async () => {
        const { user } = await renderDashboard(severalAccounts);

        await selectAccount(user, 'Lyon subsidiary');

        for (const fetchFigures of figuresOfTheMonth) {
          expect(fetchFigures).toHaveBeenCalledWith('2026-09-01', '2026-09-30', lyonAccount.id);
        }

        // Not billed in September: the page moves to its latest month, without asking for
        // September's figures of that account
        await selectAccount(user, 'zz3333-ovh (non configuré)');

        for (const fetchFigures of figuresOfTheMonth) {
          expect(fetchFigures)
            .not.toHaveBeenCalledWith('2026-09-01', '2026-09-30', removedAccount.id);
          expect(fetchFigures)
            .toHaveBeenCalledWith('2026-08-01', '2026-08-31', removedAccount.id);
        }
      });

    it('shows the figures of all accounts by default, with the account of each project',
      async () => {
        await renderDashboard(severalAccounts);

        expect(texts(serviceTypes())).toEqual([
          'Répartition par service',
          'Compute', '800,40€',
          'Storage', '250,00€',
          'Other', '200,00€',
        ]);
        expect(texts(resourceTypes()).slice(0, 11)).toEqual([
          'Répartition par type de ressource',
          'Public Cloud', '830,40€',
          'Dedicated Servers', '270,00€',
          'Backup', '90,00€',
          'Domains', '35,00€',
          'Licenses', '25,00€',
        ]);
        // Each account by its name, or else its NIC handle, as the accounts route lists it
        expect(texts(gpuCosts())).toEqual([
          'Coûts GPU', '420,50€', '(50,6 % du cloud)',
          'Par modèle GPU', 'NVIDIA L4', '420,50€',
          'Par projet', 'Projet', 'Compte', 'Types GPU', 'Montant',
          'Production', 'Lyon subsidiary', 'l4-90', '420,50€', '100,0 %',
          'Total GPU', '420,50€',
        ]);
        expect(projectRows()).toEqual([
          ['Projet○', 'Compte', 'Montant▼', '%'],
          ['Production', 'Lyon subsidiary', '610,40€', '73,5 %'],
          ['Staging', 'yy2222-ovh', '220,00€', '26,5 %'],
          ['Total Cloud', '830,40€', '100 %'],
        ]);
      });

    // Every figure is the account's: the Overview listed every account's projects, and read
    // the share of each in the Cloud total of the account selected, 100,0 % for Production
    it('shows the figures of the account selected alone, without the Account column',
      async () => {
        const { user } = await renderDashboard(severalAccounts);

        await selectAccount(user, 'Lyon subsidiary');

        expect(texts(serviceTypes())).toEqual([
          'Répartition par service',
          'Compute', '580,40€',
          'Other', '160,00€',
          'Storage', '150,00€',
        ]);
        expect(texts(resourceTypes()).slice(0, 7)).toEqual([
          'Répartition par type de ressource',
          'Public Cloud', '610,40€',
          'Dedicated Servers', '270,00€',
          'Domains', '10,00€',
        ]);
        // 420.50 / 610.40, the account's Cloud total
        expect(texts(gpuCosts())).toEqual([
          'Coûts GPU', '420,50€', '(68,9 % du cloud)',
          'Par modèle GPU', 'NVIDIA L4', '420,50€',
          'Par projet', 'Projet', 'Types GPU', 'Montant',
          'Production', 'l4-90', '420,50€', '100,0 %',
          'Total GPU', '420,50€',
        ]);
        expect(projectRows()).toEqual([
          ['Projet○', 'Montant▼', '%'],
          ['Production', '610,40€', '100,0 %'],
          ['Total Cloud', '610,40€', '100 %'],
        ]);
      });

    it('leaves out the GPU costs of an account that has none', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await selectAccount(user, 'yy2222-ovh');

      expect(screen.queryByText('Coûts GPU')).not.toBeInTheDocument();
      expect(projectRows()).toEqual([
        ['Projet○', 'Montant▼', '%'],
        ['Staging', '220,00€', '100,0 %'],
        ['Total Cloud', '220,00€', '100 %'],
      ]);
    });

    // Staging, moved from Lyon to yy2222-ovh during September: the server lists its costs once
    // for all accounts, and once for each account when asked by account (#118)
    const [production] = severalAccounts.projectsByAccount['2026-09'];
    const staging = (total, detailsCount, { nic }) => ({
      projectId: 'project-staging', projectName: 'Staging', total, detailsCount, account: nic,
    });
    const stagingMoved = {
      ...severalAccounts,
      projectsByAccount: {
        ...severalAccounts.projectsByAccount,
        '2026-09': [production, staging(170, 8, unnamedAccount), staging(50, 3, lyonAccount)],
      },
    };

    it('lists a project billed to two accounts once for each, with the account of each',
      async () => {
        await renderDashboard(stagingMoved);

        expect(projectRows()).toEqual([
          ['Projet○', 'Compte', 'Montant▼', '%'],
          ['Production', 'Lyon subsidiary', '610,40€', '73,5 %'],
          ['Staging', 'yy2222-ovh', '170,00€', '20,5 %'],
          ['Staging', 'Lyon subsidiary', '50,00€', '6,0 %'],
          ['Total Cloud', '830,40€', '100 %'],
        ]);
      });

    // What names no account lists each project once, at what every account paid for it. The
    // Compare tab names the account of each project too (#119, compare.test.jsx).
    it('keeps a project billed to two accounts once in the Markdown report', async () => {
      const { user } = await renderDashboard(stagingMoved);
      const downloadedFiles = captureFileDownloads();

      await user.selectOptions(screen.getByDisplayValue('Choisir...'), 'Markdown');

      const [report] = await downloadedFiles();
      expect(report.content.split('\n').filter((line) => line.startsWith('| Staging')))
        .toEqual(['| Staging | 220,00€ |']);
    });

    // Only the lists that name the account of each project ask for their projects by account
    it('asks for its projects by account only while its lists name the account of each',
      async () => {
        const { user } = await renderDashboard(severalAccounts);
        const byAccount = [api.fetchProjectsByAccount, api.fetchGpuProjectsByAccount];
        for (const fetchByAccount of byAccount) {
          expect(fetchByAccount).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
        }
        await selectAccount(user, 'Lyon subsidiary');

        await selectMonth(user, 'Août 2026');

        for (const fetchByAccount of byAccount) {
          expect(fetchByAccount).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31');
        }
      });

    it('shows the Account column again once all accounts are selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');

      await selectAccount(user, 'Tous les comptes');

      expect(headerOf(projectTable())).toEqual(['Projet○', 'Compte', 'Montant▼', '%']);
      expect(texts(gpuCosts())).toContain('Lyon subsidiary');
    });

    // The page of a single-account installation stays as it was, whatever the rows say of
    // their account
    it.each([
      ['a single account', [lyonAccount]],
      ['no account, as before the first import since the upgrade', []],
    ])('shows no Account column with %s', async (_, accounts) => {
      await renderDashboard({ ...severalAccounts, accounts });

      expect(projectRows()).toEqual(projectsOfOneAccount);
      expect(texts(gpuCosts())).toEqual(gpuCostsOfOneAccount);
      expect(api.fetchProjectsByAccount).not.toHaveBeenCalled();
      expect(api.fetchGpuProjectsByAccount).not.toHaveBeenCalled();
    });

    // The costs by resource type and the GPU costs of the month that the shell loads for the
    // tab feed other cards and tabs too, which follow the account with them: those of the
    // Public Cloud tab's cards are its own tests' (public-cloud.test.jsx)
    describe('as other cards and tabs read them', () => {
      it('count the resources of the account selected in the card of every resource',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          const resources = () => texts(cardOf('Total ressources'));
          expect(resources())
            .toEqual(['Total ressources', '9', '1 Serveurs dédiés · 0 VPS · 2 Projets Cloud']);

          await selectAccount(user, 'Lyon subsidiary');

          expect(resources())
            .toEqual(['Total ressources', '3', '1 Serveurs dédiés · 0 VPS · 1 Projets Cloud']);

          await selectAccount(user, 'yy2222-ovh');

          expect(resources())
            .toEqual(['Total ressources', '6', '0 Serveurs dédiés · 0 VPS · 1 Projets Cloud']);
        });

      it('fill the cards and the costs of the Infrastructure tab with those of the account',
        async () => {
          const { user } = await renderDashboard(severalAccounts);
          await openTab(user, 'Infrastructure');
          const dedicatedServers = () => texts(cardRowOf('Serveurs dédiés')).slice(0, 3);
          const costs = () => texts(cardOf(screen.getByRole('heading',
            { name: /^Coûts par type de ressource/ })));
          expect(dedicatedServers()).toEqual(['Serveurs dédiés', '1', '270,00€']);
          expect(costs()).toEqual([
            'Coûts par type de ressource', '(Septembre 2026)',
            'Dedicated Servers', '270,00€', '▼', 'Backup', '90,00€', '▼',
            'Licenses', '25,00€', '▼',
          ]);

          await selectAccount(user, 'yy2222-ovh');

          expect(dedicatedServers()).toEqual(['Serveurs dédiés', '0', '0,00€']);
          expect(costs()).toEqual([
            'Coûts par type de ressource', '(Septembre 2026)',
            'Backup', '90,00€', '▼', 'Licenses', '25,00€', '▼',
          ]);
        });
    });

    it('names the Unknown account in the Account column, in the language of the page',
      async () => {
        // An account, and the Unknown account, whose bills paid for a project that no account
        // claimed since
        const legacy = {
          projectId: 'project-legacy', projectName: 'Legacy', total: 220, detailsCount: 11,
          account: null,
        };
        const { user } = await renderDashboard({
          ...severalAccounts,
          accounts: [lyonAccount, unknownAccount],
          projectsByAccount: {
            ...severalAccounts.projectsByAccount, '2026-09': [production, legacy],
          },
        });

        expect(projectRows()).toEqual([
          ['Projet○', 'Compte', 'Montant▼', '%'],
          ['Production', 'Lyon subsidiary', '610,40€', '73,5 %'],
          ['Legacy', 'Compte inconnu', '220,00€', '26,5 %'],
          ['Total Cloud', '830,40€', '100 %'],
        ]);

        await selectLanguage(user, 'en');

        expect(rowsOf(within(projectBreakdown('Breakdown by project')).getByRole('table')))
          .toEqual([
            ['Project○', 'Account', 'Amount▼', '%'],
            ['Production', 'Lyon subsidiary', '610.40€', '73.5%'],
            ['Legacy', 'Unknown account', '220.00€', '26.5%'],
            ['Cloud Total', '830.40€', '100%'],
          ]);
      });

    // The inventory's services about to expire, which the header counts too (#123): see
    // fixtures/infrastructure.js
    describe('services about to expire', () => {
      // Those of every configured account, soonest first, each named by its account in
      // brackets, as Compare's servers are: its name, or else its NIC handle. The server leaves
      // out those of the Unknown account and of the account no longer configured, which no
      // import refreshes.
      const everyAccountsExpiring = [
        'Expirations proches',
        'Serveurs dédiés', 'backup-server', '(Lyon subsidiary)', 'Expire dans 5 jours',
        'VPS', 'vps-0a1b2c3d.vps.ovh.net', '(Lyon subsidiary)', 'Expire dans 25 jours',
        'VPS', 'staging-vps', '(yy2222-ovh)', 'Expire dans 27 jours',
      ];

      it('are those of the account selected, in the card and in the header', async () => {
        const { user } = await renderDashboard(severalAccounts);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['3', 'Expirations proches']);

        await selectAccount(user, 'Lyon subsidiary');

        expect(api.fetchExpiringServices).toHaveBeenCalledWith(30, lyonAccount.id);
        expect(texts(expirationCard())).toEqual([
          'Expirations proches',
          'Serveurs dédiés', 'backup-server', 'Expire dans 5 jours',
          'VPS', 'vps-0a1b2c3d.vps.ovh.net', 'Expire dans 25 jours',
        ]);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['2', 'Expirations proches']);

        // Those that all accounts leave out, whatever the month, as the inventory is what
        // exists now
        await selectAccount(user, 'Compte inconnu');

        expect(texts(expirationCard())).toEqual([
          'Expirations proches', 'Stockage', 'old-nas', 'Expiré depuis 5 jours',
        ]);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['1', 'Expirations proches']);

        await selectAccount(user, 'zz3333-ovh (non configuré)');

        expect(texts(expirationCard())).toEqual([
          'Expirations proches', 'Serveurs dédiés', 'db-server', 'Expire dans 2 jours',
        ]);

        await selectAccount(user, 'Tous les comptes');

        expect(texts(expirationCard())).toEqual(everyAccountsExpiring);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['3', 'Expirations proches']);
      });

      it('name the account of each service when the page shows all accounts', async () => {
        const { user } = await renderDashboard(severalAccounts);

        expect(texts(expirationCard())).toEqual(everyAccountsExpiring);

        await selectLanguage(user, 'en');

        expect(texts(expirationCard('Expiring soon')).slice(0, 5)).toEqual([
          'Expiring soon', 'Dedicated Servers', 'backup-server', '(Lyon subsidiary)',
          'Expires in 5 days',
        ]);
      });

      // Services that expired long ago, which no import refreshes, as those that the Unknown
      // account kept from before the accounts: listed for all accounts, the five oldest filled
      // the card, and the header counted them. The server leaves them out there.
      it('leave the services that no import refreshes to their own account', async () => {
        const stale = (id, name, date) => ({
          id, display_name: name, type: 'storage', expiration_date: date, account: null,
        });
        const soon = {
          id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
          type: 'dedicated_server', expiration_date: '2026-09-17', account: lyonAccount.nic,
        };
        const { user } = await renderDashboard({
          ...severalAccounts,
          expiringServices: [soon],
          ofAccount: {
            ...severalAccounts.ofAccount,
            unknown: {
              ...severalAccounts.ofAccount.unknown,
              expiringServices: [
                stale('netapp-0001', 'nas-1', '2025-01-31'),
                stale('netapp-0002', 'nas-2', '2025-03-31'),
                stale('netapp-0003', 'nas-3', '2025-06-30'),
                stale('netapp-0004', 'nas-4', '2025-09-30'),
                stale('netapp-0005', 'nas-5', '2025-12-31'),
              ],
            },
          },
        });

        expect(texts(expirationCard())).toEqual([
          'Expirations proches',
          'Serveurs dédiés', 'backup-server', '(Lyon subsidiary)', 'Expire dans 2 jours',
        ]);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['1', 'Expirations proches']);

        await selectAccount(user, 'Compte inconnu');

        expect(texts(expirationCard()).filter((text) => text.startsWith('nas-')))
          .toEqual(['nas-1', 'nas-2', 'nas-3', 'nas-4', 'nas-5']);
        expect(texts(headerBadge('Expirations proches'))).toEqual(['5', 'Expirations proches']);
      });

      // As the page shows them before an instance could import several accounts
      it.each([
        ['a single account', [lyonAccount]],
        ['no account, as before the first import since the upgrade', []],
      ])('name no account with %s', async (_, accounts) => {
        await renderDashboard({ ...severalAccounts, accounts });

        expect(texts(expirationCard()))
          .toEqual(everyAccountsExpiring.filter((text) => !text.startsWith('(')));
      });
    });
  });
});
