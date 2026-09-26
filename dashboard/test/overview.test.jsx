import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { threeBilledProjects } from './fixtures/public-cloud.js';
import { api } from './support/api.js';
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
  selectLanguage,
  selectMonth,
  settle,
  sortTable,
  texts,
} from './support/render.jsx';

// What the Overview shows of the selected month, as the page requests it
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

// Six services of the inventory that expire within 30 days, as
// /api/inventory/expiring answers: the servers, then the VPS, then the
// storage services, each by date
const expiringSoon = [
  { id: 'ns3000003.ip-203-0-113.eu', display_name: null,
    type: 'dedicated_server', expiration_date: '2026-09-17' },
  { id: 'ns3000001.ip-203-0-113.eu', display_name: 'backup-server',
    type: 'dedicated_server', expiration_date: '2026-09-20' },
  { id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d.vps.ovh.net',
    type: 'vps', expiration_date: '2026-10-10' },
  { id: 'vps-4e5f6a7b.vps.ovh.net', display_name: 'staging-vps',
    type: 'vps', expiration_date: '2026-10-12' },
  { id: 'netapp-8c9d0e1f', display_name: 'archives-nas',
    type: 'storage', expiration_date: '2026-10-02' },
  { id: 'netapp-5f2c9a1e', display_name: 'shared-files',
    type: 'storage', expiration_date: '2026-10-14' },
];

describe('Overview tab', () => {
  it('loads everything it shows with the page', async () => {
    await renderDashboard();

    for (const fetchFigures of figuresOfTheMonth) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    }
    expect(api.fetchExpiringServices).toHaveBeenCalledWith(30);
    // The budget
    expect(api.fetchConfig).toHaveBeenCalled();
  });

  it('keeps loading the figures of the selected month while another tab is open', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Web Cloud');

    await selectMonth(user, 'Juillet 2026');

    for (const fetchFigures of figuresOfTheMonth) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
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
    expect(texts(gpuCosts()).slice(0, 3)).toEqual(['Coûts GPU', '310,00€', '(44.2% du cloud)']);
    expect(projectRows()).toEqual([
      ['Projet○', 'Montant▼', '%'],
      ['Production', '512,00€', '72.9%'],
      ['Staging', '190,00€', '27.1%'],
      ['Total Cloud', '702,00€', '100%'],
    ]);
    expect(texts(budget()).slice(0, 3))
      .toEqual(['Consommation du budget', '2% utilisé', 'Consommé: 1 042,00€']);
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

      expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30');
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
        'Coûts GPU', '420,50€', '(50.6% du cloud)',
        'Par modèle GPU', 'NVIDIA L4', '420,50€',
        'Par projet', 'Projet', 'Types GPU', 'Montant',
        'Production', 'l4-90', '420,50€', '100.0%',
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
        ['Production', '610,40€', '73.5%'],
        ['Staging', '220,00€', '26.5%'],
        ['Total Cloud', '830,40€', '100%'],
      ]);
    });

    it('sorts the projects by amount or by name, each way in turn', async () => {
      const { user } = await renderDashboard({ ...account, ...threeBilledProjects });
      expect(projectRows()).toEqual([
        ['Projet○', 'Montant▼', '%'],
        ['Production', '460,40€', '55.4%'],
        ['Staging', '250,00€', '30.1%'],
        ['Sandbox', '120,00€', '14.5%'],
        ['Total Cloud', '830,40€', '100%'],
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
        ['Staging', '220,00€', '26.5%'],
        ['Production', '610,40€', '73.5%'],
        ['Total Cloud', '830,40€', '100%'],
      ]);
    });
  });

  describe('budget', () => {
    it('shows the share of the budget the month has used', async () => {
      await renderDashboard();

      // 1 250.40 / 50 000
      expect(texts(budget()))
        .toEqual(['Consommation du budget', '3% utilisé', 'Consommé: 1 250,40€', 'Budget:', '€']);
      expect(budgetInput()).toHaveValue(50000);
    });

    it('starts from the budget of the configuration', async () => {
      await renderDashboard({ ...account, config: { budget: 2000, currency: 'EUR' } });

      expect(budgetInput()).toHaveValue(2000);
      // 1 250.40 / 2 000
      expect(texts(budget())).toContain('63% utilisé');
    });

    it('takes the budget the user types, and flags a forecast above it', async () => {
      const { user } = await renderDashboard();
      expect(texts(forecastCard())).toContain('14/30 jours');

      await typeBudget(user, '800');

      // 1 250.40 / 800
      expect(texts(budget()))
        .toEqual(['Consommation du budget', '156% utilisé', 'Consommé: 1 250,40€', 'Budget:', '€']);
      // The forecast of 862.18 goes over it
      expect(texts(forecastCard()))
        .toEqual(['Prévision fin de mois', 'septembre 2026', '862,18€', '> Budget!']);
    });

    it('keeps the budget the user typed across tabs', async () => {
      const { user } = await renderDashboard();
      await typeBudget(user, '800');

      await openTab(user, 'Tendances');

      expect(texts(forecastCard())).toContain('> Budget!');

      await openTab(user, "Vue d'ensemble");

      expect(budgetInput()).toHaveValue(800);
      expect(texts(budget())).toContain('156% utilisé');
    });
  });

  it('lists the first five services that expire within 30 days', async () => {
    await renderDashboard({ ...account, expiringServices: expiringSoon });

    // A service without a display name shows its id
    expect(texts(cardOf(screen.getByRole('heading', { name: 'Expirations proches' })))).toEqual([
      'Expirations proches',
      'Serveurs dédiés', 'ns3000003.ip-203-0-113.eu', 'Expire dans 2 jours',
      'Serveurs dédiés', 'backup-server', 'Expire dans 5 jours',
      'VPS', 'vps-0a1b2c3d.vps.ovh.net', 'Expire dans 25 jours',
      'VPS', 'staging-vps', 'Expire dans 27 jours',
      'Stockage', 'archives-nas', 'Expire dans 17 jours',
    ]);
    // All six in the header
    expect(texts(headerBadge('Expirations proches'))).toEqual(['6', 'Expirations proches']);
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
    expect(texts(cardOf(screen.getByRole('heading', { name: 'Expiring soon' }))).slice(0, 4))
      .toEqual([
        'Expiring soon', 'Dedicated Servers', 'ns3000003.ip-203-0-113.eu', 'Expires in 2 days',
      ]);
  });
});
