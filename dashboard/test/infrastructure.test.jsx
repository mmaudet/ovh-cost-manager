import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, everyResourceType } from './fixtures/account.js';
import { api } from './support/api.js';
import {
  BOM,
  captureFileDownloads,
  csvFile,
  downloadFromPanelAndModal,
} from './support/downloads.js';
import {
  backdropOf,
  cardOf,
  cardRowOf,
  openTab,
  renderDashboard,
  rowsOf,
  selectLanguage,
  selectMonth,
  settle,
  texts,
} from './support/render.jsx';

// The KPI cards of the tab: one per resource type
const resourceTypeCards = (firstLabel = 'Serveurs dédiés') => cardRowOf(firstLabel);
// The costs by resource type of the month, each one showing its bill lines
// under it on a click
const costsByResourceType = (heading = 'Coûts par type de ressource') => cardOf(heading);
const resourceType = (name) => within(costsByResourceType()).getByText(name);
const billLines = () => within(costsByResourceType()).queryByRole('table');
// A panel of the inventory, found by its heading: "Serveurs dédiés (2)", "VPS"
const inventoryPanel = (heading) => cardOf(screen.getByRole('heading', { name: heading }));
const serversPanel = (heading = /^Serveurs dédiés \(/) => inventoryPanel(heading);
const serversButton = (name) => within(serversPanel()).getByRole('button', { name });

const serverRows = [
  ['ID', 'Datacenter', 'CPU', 'RAM', 'État', "Date d'expiration", 'Renouvellement'],
  ['backup-server', 'rbx8', 'Intel Xeon-E 2388G', '64 GB', 'ok', '2026-09-20', 'automatic'],
  // Just delivered: its RAM, expiration and renewal are not known yet
  ['ns3000002.ip-198-51-100.eu', 'gra3', 'AMD EPYC 4344P', '-', 'error', '-', '-'],
];

describe('Infrastructure tab', () => {
  it('loads the inventory when the tab opens, the resource types with the page', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchByResourceType).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(api.fetchInventoryServers).not.toHaveBeenCalled();
    expect(api.fetchInventoryVps).not.toHaveBeenCalled();
    expect(api.fetchInventoryStorage).not.toHaveBeenCalled();

    await openTab(user, 'Infrastructure');

    expect(api.fetchInventoryServers).toHaveBeenCalled();
    expect(api.fetchInventoryVps).toHaveBeenCalled();
    expect(api.fetchInventoryStorage).toHaveBeenCalled();
    // The bill lines of a resource type wait until the user opens it
    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
  });

  describe('KPI cards', () => {
    it('show the count and the cost of each resource type of the month', async () => {
      const { user } = await renderDashboard({ ...account, ...everyResourceType });

      await openTab(user, 'Infrastructure');

      expect(texts(resourceTypeCards())).toEqual([
        'Serveurs dédiés', '1', '270,00€',
        'VPS', '1', '11,99€',
        'Stockage', '1', '64,80€',
        'Load Balancers', '2', '18,00€',
        'Adresses IP', '4', '6,00€',
        'Hôtes Private Cloud', '2', '1 450,00€',
        'Datastores Private Cloud', '3', '380,00€',
      ]);
    });

    it('show nothing billed for the resource types missing from the month', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Infrastructure');

      // Only a dedicated server among them in September
      expect(texts(resourceTypeCards())).toEqual([
        'Serveurs dédiés', '1', '270,00€',
        'VPS', '0', '0,00€',
        'Stockage', '0', '0,00€',
        'Load Balancers', '0', '0,00€',
        'Adresses IP', '0', '0,00€',
        'Hôtes Private Cloud', '0', '0,00€',
        'Datastores Private Cloud', '0', '0,00€',
      ]);
    });

    it('open the bill lines of their resource type, until a second click', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');

      await user.click(cardOf('Serveurs dédiés'));
      await settle();

      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30');
      expect(rowsOf(billLines())).toEqual([
        ['Service', 'Description', 'Montant'],
        ['ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', '270,00€'],
      ]);

      await user.click(cardOf('Serveurs dédiés'));

      expect(billLines()).not.toBeInTheDocument();
    });
  });

  describe('costs by resource type', () => {
    it('list the resource types of the month, but Public Cloud and Web Cloud', async () => {
      const { user } = await renderDashboard({ ...account, ...everyResourceType });

      await openTab(user, 'Infrastructure');

      // Labelled by the server, in English only; the Other catch-all stays
      expect(texts(costsByResourceType())).toEqual([
        'Coûts par type de ressource', '(Septembre 2026)',
        'Private Cloud Hosts', '1 450,00€', '▼',
        'Private Cloud Datastores', '380,00€', '▼',
        'Dedicated Servers', '270,00€', '▼',
        'Backup', '90,00€', '▼',
        'Storage', '64,80€', '▼',
        'Licenses', '25,00€', '▼',
        'Load Balancers', '18,00€', '▼',
        'VPS', '11,99€', '▼',
        'Other', '7,50€', '▼',
        'IP', '6,00€', '▼',
      ]);
    });

    it('show the bill lines of a resource type under it, until a second click', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');

      await user.click(resourceType('Dedicated Servers'));
      await settle();

      expect(texts(costsByResourceType())).toEqual([
        'Coûts par type de ressource', '(Septembre 2026)',
        'Dedicated Servers', '270,00€', '▲',
        'Service', 'Description', 'Montant',
        'ns3000001.ip-203-0-113.eu',
        'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', '270,00€',
        'Backup', '90,00€', '▼',
        'Licenses', '25,00€', '▼',
      ]);

      await user.click(resourceType('Dedicated Servers'));

      expect(billLines()).not.toBeInTheDocument();
      expect(texts(costsByResourceType())).toContain('▼');
      expect(texts(costsByResourceType())).not.toContain('▲');
    });

    it('show the bill lines of one resource type at a time', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Dedicated Servers'));
      await settle();

      await user.click(resourceType('Backup'));
      await settle();

      // Most expensive service first
      expect(rowsOf(billLines())).toEqual([
        ['Service', 'Description', 'Montant'],
        ['vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com', '40,00€'],
        ['vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com', '30,00€'],
        ['vm-files-1.example.com', 'Veeam Managed Backup - vm-files-1.example.com', '20,00€'],
      ]);
      expect(within(costsByResourceType()).getAllByRole('table')).toHaveLength(1);
    });

    it('follow the month selector, the open resource type included', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Backup'));
      await settle();

      await selectMonth(user, 'Août 2026');

      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith('backup', '2026-08-01', '2026-08-31');
      expect(texts(costsByResourceType())).toEqual([
        'Coûts par type de ressource', '(Août 2026)',
        'Dedicated Servers', '270,00€', '▼',
        'Backup', '40,00€', '▲',
        'Service', 'Description', 'Montant',
        'vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com', '25,00€',
        'vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com', '15,00€',
      ]);
    });

    it('close when the user leaves the tab (#56)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Dedicated Servers'));
      await settle();

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Infrastructure');

      // The tab bar closes the open resource type, the logo does not (#56)
      expect(billLines()).not.toBeInTheDocument();
    });

    it('stay open when the user goes back to the Overview through the logo (#56)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Dedicated Servers'));
      await settle();

      await user.click(screen.getByRole('button', { name: 'OVH Cost Manager' }));
      await openTab(user, 'Infrastructure');

      // The logo keeps the open resource type, the tab bar does not (#56)
      expect(rowsOf(billLines())[1][0]).toBe('ns3000001.ip-203-0-113.eu');
    });

    it('are all closed when the link of the Overview opens the tab (#56)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Dedicated Servers'));
      await settle();
      await user.click(screen.getByRole('button', { name: 'OVH Cost Manager' }));

      await user.click(screen.getByRole('button', { name: 'Voir le détail infrastructure →' }));
      await settle();

      // The link opens the summary of the tab, whatever was open (#56)
      expect(texts(costsByResourceType())).toEqual([
        'Coûts par type de ressource', '(Septembre 2026)',
        'Dedicated Servers', '270,00€', '▼',
        'Backup', '90,00€', '▼',
        'Licenses', '25,00€', '▼',
      ]);
    });
  });

  describe('dedicated servers', () => {
    it('lists the dedicated servers of the inventory', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Infrastructure');

      expect(texts(screen.getByRole('heading', { name: /^Serveurs dédiés \(/ })))
        .toEqual(['Serveurs dédiés (2)', 'Tout afficher', 'CSV']);
      expect(rowsOf(within(serversPanel()).getByRole('table'))).toEqual(serverRows);
    });

    describe('"show all" modal', () => {
      const showAll = async (user) => {
        await user.click(serversButton('Tout afficher'));
        return screen.getByRole('dialog');
      };

      it('shows every server, and closes with its button', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');

        const dialog = await showAll(user);

        expect(within(dialog).getByText('Serveurs dédiés (2)')).toBeInTheDocument();
        expect(rowsOf(within(dialog).getByRole('table'))).toEqual(serverRows);

        await user.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('closes with Escape', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');
        await showAll(user);

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('closes on a click outside it', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');
        const dialog = await showAll(user);

        await user.click(backdropOf(dialog));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('downloads the servers as CSV, from the panel and from the modal', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');

      const [fromPanel, fromModal] = await downloadFromPanelAndModal(user, serversPanel());

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-dedicated-servers.csv', [
        '"Nom";"ID";"Datacentre";"CPU";"RAM (MB)";"OS";"État";"Date d\'expiration";'
          + '"Renouvellement"',
        '"backup-server";"ns3000001.ip-203-0-113.eu";"rbx8";"Intel Xeon-E 2388G";65536;'
          + '"debian12_64";"ok";"2026-09-20";"automatic"',
        // No expiration date: an empty cell; no renewal: an empty text
        '"ns3000002.ip-198-51-100.eu";"ns3000002.ip-198-51-100.eu";"gra3";"AMD EPYC 4344P";0;'
          + '"none_64";"error";;""',
      ]));
    });
  });

  it('lists the VPS and the file storage services of the inventory', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Infrastructure');

    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))).toEqual([
      ['ID', 'Modèle', 'Région', 'Spécifications', 'État', "Date d'expiration"],
      ['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7',
        '2 vCPU / 2048MB / 40GB', 'running', '2026-10-10'],
    ]);
    expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))).toEqual([
      ['ID', 'Type', 'Région', 'Taille (GB)', 'Shares', "Date d'expiration"],
      ['shared-files', 'netapp', 'eu-west-gra', '1024', '3', '2027-03-01'],
    ]);
  });

  it('shows only its cards with nothing of its own billed or in the inventory', async () => {
    // Only Public Cloud and domains billed: they have tabs of their own
    const publicAndWebCloud = account.byResourceType['2026-09']
      .filter((type) => ['cloud_project', 'domain'].includes(type.resource_type));
    const { user } = await renderDashboard({
      ...account,
      byResourceType: { '2026-09': publicAndWebCloud },
      inventoryServers: [],
      inventoryVps: [],
      inventoryStorage: [],
    });

    await openTab(user, 'Infrastructure');

    expect(texts(resourceTypeCards())).toEqual([
      'Serveurs dédiés', '0', '0,00€',
      'VPS', '0', '0,00€',
      'Stockage', '0', '0,00€',
      'Load Balancers', '0', '0,00€',
      'Adresses IP', '0', '0,00€',
      'Hôtes Private Cloud', '0', '0,00€',
      'Datastores Private Cloud', '0', '0,00€',
    ]);
    // No costs by resource type, no dedicated server, VPS or storage panel
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
  });

  it('speaks English when the page does, in its CSV file too', async () => {
    const { user } = await renderDashboard({ ...account, ...everyResourceType });
    await selectLanguage(user, 'en');

    await openTab(user, 'Infrastructure');

    expect(texts(cardRowOf('IP Addresses'))).toEqual([
      'Dedicated Servers', '1', '270.00€',
      'VPS', '1', '11.99€',
      'Storage', '1', '64.80€',
      'Load Balancers', '2', '18.00€',
      'IP Addresses', '4', '6.00€',
      'Private Cloud Hosts', '2', '1,450.00€',
      'Private Cloud Datastores', '3', '380.00€',
    ]);
    const costs = () => costsByResourceType('Costs by resource type');
    // Month labels come from the API, in French only (#33)
    expect(texts(costs()).slice(0, 5)).toEqual([
      'Costs by resource type', '(Septembre 2026)', 'Private Cloud Hosts', '1,450.00€', '▼',
    ]);

    await user.click(within(costs()).getByText('Dedicated Servers'));
    await settle();

    expect(rowsOf(within(costs()).getByRole('table'))[0])
      .toEqual(['Service', 'Description', 'Amount']);
    expect(texts(screen.getByRole('heading', { name: /^Dedicated Servers \(/ })))
      .toEqual(['Dedicated Servers (2)', 'Show all', 'CSV']);
    const servers = serversPanel(/^Dedicated Servers \(/);
    expect(rowsOf(within(servers).getByRole('table'))[0])
      .toEqual(['ID', 'Datacenter', 'CPU', 'RAM', 'State', 'Expiration date', 'Renewal']);
    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))[0])
      .toEqual(['ID', 'Model', 'Region', 'Specifications', 'State', 'Expiration date']);
    expect(rowsOf(within(inventoryPanel('Storage')).getByRole('table'))[0])
      .toEqual(['ID', 'Type', 'Region', 'Size (GB)', 'Shares', 'Expiration date']);
    const downloadedFiles = captureFileDownloads();

    await user.click(within(servers).getByRole('button', { name: 'CSV' }));

    const [file] = await downloadedFiles();
    expect(file.content.split('\n')[0]).toBe(
      `${BOM}"Name";"ID";"Datacenter";"CPU";"RAM (MB)";"OS";"State";"Expiration date";"Renewal"`,
    );
  });
});
