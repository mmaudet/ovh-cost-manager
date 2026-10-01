import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, everyResourceType } from './fixtures/account.js';
import { lyonAccount, removedAccount, severalAccounts } from './fixtures/accounts.js';
import { api } from './support/api.js';
import {
  BOM,
  captureFileDownloads,
  csvFile,
  downloadFromPanelAndModal,
} from './support/downloads.js';
import {
  cardOf,
  cardRowOf,
  closeAndCheckFocus,
  firstColumnOf,
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
const serversTable = () => within(serversPanel()).getByRole('table');
const vpsTable = () => within(inventoryPanel('VPS')).getByRole('table');
const storageTable = () => within(inventoryPanel('Stockage')).getByRole('table');

// The RAM in French units, and in powers of 1024 as OVH names it: its 65536 MB (#88)
const serverRows = [
  ['ID○', 'Datacenter○', 'CPU○', 'RAM○', 'État○', "Date d'expiration○", 'Renouvellement○'],
  ['backup-server', 'rbx8', 'Intel Xeon-E 2388G', '64 Go', 'ok', '2026-09-20', 'automatic'],
  // Just delivered: its RAM, expiration and renewal are not known yet
  ['ns3000002.ip-198-51-100.eu', 'gra3', 'AMD EPYC 4344P', '-', 'error', '-', '-'],
];

describe('Infrastructure tab', () => {
  it('loads the inventory when the tab opens, the resource types with the page', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchByResourceType).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
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

      // For all accounts (null), as the instance knows a single one: the request names none
      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30', null);
      expect(rowsOf(billLines())).toEqual([
        ['Service○', 'Description○', 'Montant○'],
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
        'Service', '○', 'Description', '○', 'Montant', '○',
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
        ['Service○', 'Description○', 'Montant○'],
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
        .toHaveBeenCalledWith('backup', '2026-08-01', '2026-08-31', null);
      expect(texts(costsByResourceType())).toEqual([
        'Coûts par type de ressource', '(Août 2026)',
        'Dedicated Servers', '270,00€', '▼',
        'Backup', '40,00€', '▲',
        'Service', '○', 'Description', '○', 'Montant', '○',
        'vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com', '25,00€',
        'vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com', '15,00€',
      ]);
    });

    it('sort the bill lines of a resource type by any column (#146)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');
      await user.click(resourceType('Backup'));
      await settle();

      await sortTable(user, billLines(), /^Montant/);
      await sortTable(user, billLines(), /^Montant/);

      // The least expensive service first
      expect(rowsOf(billLines())).toEqual([
        ['Service○', 'Description○', 'Montant▲'],
        ['vm-files-1.example.com', 'Veeam Managed Backup - vm-files-1.example.com', '20,00€'],
        ['vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com', '30,00€'],
        ['vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com', '40,00€'],
      ]);

      await sortTable(user, billLines(), /^Service/);
      await sortTable(user, billLines(), /^Service/);

      // From Z to A
      expect(firstColumnOf(billLines()))
        .toEqual(['vm-files-1.example.com', 'vm-db-1.example.com', 'vm-app-1.example.com']);
    });

    // Which ways of moving around the page keep the open resource type: see
    // navigation.test.jsx (#56)
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
      // The modal, which a screen reader names by its title (#236)
      const showAll = async (user) => {
        await user.click(serversButton('Tout afficher'));
        return screen.getByRole('dialog', { name: 'Serveurs dédiés (2)' });
      };

      it('takes the focus, shows every server, and closes with its button', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');

        const dialog = await showAll(user);

        expect(rowsOf(within(dialog).getByRole('table'))).toEqual(serverRows);
        await closeAndCheckFocus(user, dialog, serversButton('Tout afficher'), 'button');
      });

      it('closes with Escape, giving the focus back to the button that opened it', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');

        const dialog = await showAll(user);

        await closeAndCheckFocus(user, dialog, serversButton('Tout afficher'), 'escape');
      });

      it('closes on a click outside it, giving the focus back to its button', async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Infrastructure');

        const dialog = await showAll(user);

        await closeAndCheckFocus(user, dialog, serversButton('Tout afficher'), 'backdrop');
      });
    });

    it('downloads the servers as CSV, from the panel and from the modal', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Infrastructure');

      const [fromPanel, fromModal] = await downloadFromPanelAndModal(user, serversPanel());

      expect(fromModal).toEqual(fromPanel);
      // The RAM in megabytes as the API gives them, named in French units (#88)
      expect(fromPanel).toEqual(csvFile('ovh-dedicated-servers.csv', [
        '"Nom";"ID";"Datacentre";"CPU";"RAM (Mo)";"OS";"État";"Date d\'expiration";'
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

    // The sizes in French units and number format, as the Public Cloud tab writes them (#88):
    // the RAM in powers of 1024, the disk and the storage in powers of 1000
    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))).toEqual([
      ['ID○', 'Modèle○', 'Région○', 'Spécifications○', 'État○', "Date d'expiration○"],
      ['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7',
        '2 vCPU / 2,0 Go / 40 Go', 'running', '2026-10-10'],
    ]);
    expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))).toEqual([
      ['ID○', 'Type○', 'Région○', 'Taille○', 'Shares○', "Date d'expiration○"],
      ['shared-files', 'netapp', 'eu-west-gra', '1,0 To', '3', '2027-03-01'],
    ]);
  });

  // The VPS by their number of vCPUs, which their specifications start with (#146)
  it('sorts the VPS and the file storage services by any column', async () => {
    const [vps] = account.inventoryVps;
    const [storage] = account.inventoryStorage;
    const { user } = await renderDashboard({
      ...account,
      inventoryVps: [vps, {
        ...vps, id: 'vps-9e8d7c6b.vps.ovh.net', display_name: 'vps-9e8d7c6b.vps.ovh.net',
        model: 'vps-le-4-8-160', vcpus: 4, ram_mb: 8192, disk_gb: 160,
        expiration_date: '2026-11-02',
      }],
      // Its size unknown: "-"
      inventoryStorage: [
        { ...storage, id: 'netapp-1a2b3c4d', display_name: 'archives', total_size_gb: 0 },
        storage,
      ],
    });
    await openTab(user, 'Infrastructure');

    await sortTable(user, vpsTable(), /^Spécifications/);

    expect(rowsOf(vpsTable())).toEqual([
      ['ID○', 'Modèle○', 'Région○', 'Spécifications▼', 'État○', "Date d'expiration○"],
      ['vps-9e8d7c6b.vps.ovh.net', 'vps-le-4-8-160', 'Region OpenStack: os-gra7',
        '4 vCPU / 8,0 Go / 160 Go', 'running', '2026-11-02'],
      ['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7',
        '2 vCPU / 2,0 Go / 40 Go', 'running', '2026-10-10'],
    ]);

    await sortTable(user, storageTable(), /^Taille/);
    await sortTable(user, storageTable(), /^Taille/);

    // The smallest first, and last the one of unknown size
    expect(headerOf(storageTable()))
      .toEqual(['ID○', 'Type○', 'Région○', 'Taille▲', 'Shares○', "Date d'expiration○"]);
    expect(firstColumnOf(storageTable())).toEqual(['shared-files', 'archives']);
  });

  // The import stores 0 for a size the API did not give: "-", as for the RAM of a server,
  // rather than "0 o" (#88)
  it('writes a dash for the sizes of a VPS or storage the API did not give', async () => {
    const [vps] = account.inventoryVps;
    const [storage] = account.inventoryStorage;
    const { user } = await renderDashboard({
      ...account,
      inventoryVps: [{ ...vps, ram_mb: 0, disk_gb: 0 }],
      inventoryStorage: [{ ...storage, total_size_gb: 0 }],
    });

    await openTab(user, 'Infrastructure');

    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))[1])
      .toEqual(['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7',
        '2 vCPU / - / -', 'running', '2026-10-10']);
    expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))[1])
      .toEqual(['shared-files', 'netapp', 'eu-west-gra', '-', '3', '2027-03-01']);
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
    // The month in the language of the page, not in the French of the API (#33)
    expect(texts(costs()).slice(0, 5)).toEqual([
      'Costs by resource type', '(September 2026)', 'Private Cloud Hosts', '1,450.00€', '▼',
    ]);

    await user.click(within(costs()).getByText('Dedicated Servers'));
    await settle();

    expect(rowsOf(within(costs()).getByRole('table'))[0])
      .toEqual(['Service○', 'Description○', 'Amount○']);
    expect(texts(screen.getByRole('heading', { name: /^Dedicated Servers \(/ })))
      .toEqual(['Dedicated Servers (2)', 'Show all', 'CSV']);
    const servers = serversPanel(/^Dedicated Servers \(/);
    // The sizes in English units and number format (#88)
    expect(rowsOf(within(servers).getByRole('table')).slice(0, 2)).toEqual([
      ['ID○', 'Datacenter○', 'CPU○', 'RAM○', 'State○', 'Expiration date○', 'Renewal○'],
      ['backup-server', 'rbx8', 'Intel Xeon-E 2388G', '64 GB', 'ok', '2026-09-20', 'automatic'],
    ]);
    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))).toEqual([
      ['ID○', 'Model○', 'Region○', 'Specifications○', 'State○', 'Expiration date○'],
      ['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7',
        '2 vCPU / 2.0 GB / 40 GB', 'running', '2026-10-10'],
    ]);
    expect(rowsOf(within(inventoryPanel('Storage')).getByRole('table'))).toEqual([
      ['ID○', 'Type○', 'Region○', 'Size○', 'Shares○', 'Expiration date○'],
      ['shared-files', 'netapp', 'eu-west-gra', '1.0 TB', '3', '2027-03-01'],
    ]);
    const downloadedFiles = captureFileDownloads();

    await user.click(within(servers).getByRole('button', { name: 'CSV' }));

    const [file] = await downloadedFiles();
    expect(file.content.split('\n')[0]).toBe(
      `${BOM}"Name";"ID";"Datacenter";"CPU";"RAM (MB)";"OS";"State";"Expiration date";"Renewal"`,
    );
  });
});

// With several accounts in the instance (#123), see fixtures/accounts.js and
// fixtures/infrastructure.js: the tab shows the inventory and the bill lines of the account
// selected in the header, or those of every account, by default
describe('Infrastructure tab with several accounts', () => {
  // The panel of the servers, whose heading counts them
  const serversHeading = () => screen.getByRole('heading', { name: /^Serveurs dédiés \(/ });

  it('shows the inventory of the account selected, and of all accounts again', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await openTab(user, 'Infrastructure');
    expect(texts(serversHeading())[0]).toBe('Serveurs dédiés (4)');

    await selectAccount(user, 'yy2222-ovh');

    expect(texts(serversHeading())[0]).toBe('Serveurs dédiés (1)');
    expect(rowsOf(within(serversPanel()).getByRole('table'))).toEqual([
      serverRows[0],
      ['ns3000002.ip-198-51-100.eu', 'gra3', 'AMD EPYC 4344P', '-', 'error', '-', '-'],
    ]);
    expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))).toEqual([
      ['ID○', 'Modèle○', 'Région○', 'Spécifications○', 'État○', "Date d'expiration○"],
      ['staging-vps', 'vps-le-2-2-40', 'Region OpenStack: os-sbg5', '2 vCPU / 2,0 Go / 40 Go',
        'running', '2026-10-12'],
    ]);
    // No storage service
    expect(screen.queryByRole('heading', { name: 'Stockage' })).not.toBeInTheDocument();

    await selectAccount(user, 'Tous les comptes');

    expect(texts(serversHeading())[0]).toBe('Serveurs dédiés (4)');
    expect(within(inventoryPanel('Stockage')).getAllByRole('row')).toHaveLength(3);
  });

  it("shows the Unknown account's inventory: what no account claimed", async () => {
    const { user } = await renderDashboard(severalAccounts);
    await openTab(user, 'Infrastructure');

    await selectAccount(user, 'Compte inconnu');

    expect(rowsOf(within(serversPanel()).getByRole('table'))).toEqual([
      serverRows[0],
      ['legacy-server', 'sbg3', 'Intel Xeon E3-1245v5', '32 Go', 'ok', '-', 'manual'],
    ]);
    expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))).toEqual([
      ['ID○', 'Type○', 'Région○', 'Taille○', 'Shares○', "Date d'expiration○"],
      ['old-nas', 'netapp', 'eu-west-gra', '512 Go', '3', '2026-09-10'],
    ]);
    expect(screen.queryByRole('heading', { name: 'VPS' })).not.toBeInTheDocument();
  });

  it('shows the bill lines of the account selected', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await openTab(user, 'Infrastructure');
    await selectAccount(user, 'yy2222-ovh');

    await user.click(resourceType('Backup'));
    await settle();

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30', 'yy2222-ovh');
    expect(rowsOf(billLines())).toEqual([
      ['Service○', 'Description○', 'Montant○'],
      ['vm-app-1.example.com', 'Veeam Managed Backup - vm-app-1.example.com', '40,00€'],
      ['vm-db-1.example.com', 'Veeam Managed Backup - vm-db-1.example.com', '30,00€'],
      ['vm-files-1.example.com', 'Veeam Managed Backup - vm-files-1.example.com', '20,00€'],
    ]);
  });

  // The month selected stays until the account's months list loads, and says it lacks it, as
  // the header's summary and the other tabs wait for (#115, #120): the bill lines of that
  // month would never show
  it('asks for no bill lines of a month the account selected lacks', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await openTab(user, 'Infrastructure');
    await user.click(resourceType('Dedicated Servers'));
    await settle();

    await selectAccount(user, 'zz3333-ovh (non configuré)');

    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalledWith(
      'dedicated_server', '2026-09-01', '2026-09-30', removedAccount.id,
    );
    expect(api.fetchResourceTypeDetails).toHaveBeenCalledWith(
      'dedicated_server', '2026-08-01', '2026-08-31', removedAccount.id,
    );
  });

  describe('Account column', () => {
    // The servers of all accounts, each named by its account: its name, or else its NIC
    // handle, as that of the account removed from config.json, and the Unknown account for a
    // server that no account claimed
    const serverRowsWithAccount = [
      [
        'ID○', 'Compte○', 'Datacenter○', 'CPU○', 'RAM○', 'État○', "Date d'expiration○",
        'Renouvellement○',
      ],
      ['backup-server', 'Lyon subsidiary', 'rbx8', 'Intel Xeon-E 2388G', '64 Go', 'ok',
        '2026-09-20', 'automatic'],
      ['db-server', 'zz3333-ovh', 'rbx8', 'Intel Xeon-E 2388G', '64 Go', 'ok', '2026-09-17',
        'automatic'],
      ['legacy-server', 'Compte inconnu', 'sbg3', 'Intel Xeon E3-1245v5', '32 Go', 'ok', '-',
        'manual'],
      ['ns3000002.ip-198-51-100.eu', 'yy2222-ovh', 'gra3', 'AMD EPYC 4344P', '-', 'error', '-',
        '-'],
    ];

    it('names the account of each service when the page shows all accounts', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Infrastructure');

      expect(rowsOf(within(serversPanel()).getByRole('table'))).toEqual(serverRowsWithAccount);
      expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))).toEqual([
        [
          'ID○', 'Compte○', 'Modèle○', 'Région○', 'Spécifications○', 'État○',
          "Date d'expiration○",
        ],
        ['staging-vps', 'yy2222-ovh', 'vps-le-2-2-40', 'Region OpenStack: os-sbg5',
          '2 vCPU / 2,0 Go / 40 Go', 'running', '2026-10-12'],
        ['vps-0a1b2c3d.vps.ovh.net', 'Lyon subsidiary', 'vps-le-2-2-40',
          'Region OpenStack: os-gra7', '2 vCPU / 2,0 Go / 40 Go', 'running', '2026-10-10'],
      ]);
      expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))).toEqual([
        ['ID○', 'Compte○', 'Type○', 'Région○', 'Taille○', 'Shares○', "Date d'expiration○"],
        ['old-nas', 'Compte inconnu', 'netapp', 'eu-west-gra', '512 Go', '3', '2026-09-10'],
        ['shared-files', 'Lyon subsidiary', 'netapp', 'eu-west-gra', '1,0 To', '3',
          '2027-03-01'],
      ]);
    });

    // Their panel and their "show all" modal alike (#146)
    it('sorts the servers by any column, the account included, those without a value last',
      async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Infrastructure');

        await sortTable(user, serversTable(), /^Date d'expiration/);

        // The latest to expire first, and last, whichever way, the servers without a date
        expect(headerOf(serversTable())).toEqual([
          'ID○', 'Compte○', 'Datacenter○', 'CPU○', 'RAM○', 'État○', "Date d'expiration▼",
          'Renouvellement○',
        ]);
        expect(firstColumnOf(serversTable())).toEqual([
          'backup-server', 'db-server', 'legacy-server', 'ns3000002.ip-198-51-100.eu',
        ]);

        await sortTable(user, serversTable(), /^Date d'expiration/);

        expect(firstColumnOf(serversTable())).toEqual([
          'db-server', 'backup-server', 'legacy-server', 'ns3000002.ip-198-51-100.eu',
        ]);

        await sortTable(user, serversTable(), /^Compte/);

        const byAccount = [
          ['legacy-server', 'Compte inconnu'],
          ['backup-server', 'Lyon subsidiary'],
          ['ns3000002.ip-198-51-100.eu', 'yy2222-ovh'],
          ['db-server', 'zz3333-ovh'],
        ];
        const serversAndAccounts = (table) => rowsOf(table).slice(1)
          .map(([server, name]) => [server, name]);
        expect(serversAndAccounts(serversTable())).toEqual(byAccount);

        await user.click(serversButton('Tout afficher'));

        const tableOfDialog = within(screen.getByRole('dialog')).getByRole('table');
        expect(headerOf(tableOfDialog)[1]).toBe('Compte▲');
        expect(serversAndAccounts(tableOfDialog)).toEqual(byAccount);
      });

    it('names the account of each server in the "show all" modal too', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Infrastructure');

      await user.click(serversButton('Tout afficher'));

      expect(rowsOf(within(screen.getByRole('dialog')).getByRole('table')))
        .toEqual(serverRowsWithAccount);
    });

    // So that a spreadsheet can pivot the servers by account
    it('gives the account of each server in its CSV file', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Infrastructure');

      const [fromPanel, fromModal] = await downloadFromPanelAndModal(user, serversPanel());

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-dedicated-servers.csv', [
        '"Nom";"ID";"Compte";"Datacentre";"CPU";"RAM (Mo)";"OS";"État";"Date d\'expiration";'
          + '"Renouvellement"',
        '"backup-server";"ns3000001.ip-203-0-113.eu";"Lyon subsidiary";"rbx8";'
          + '"Intel Xeon-E 2388G";65536;"debian12_64";"ok";"2026-09-20";"automatic"',
        '"db-server";"ns3000003.ip-203-0-113.eu";"zz3333-ovh";"rbx8";"Intel Xeon-E 2388G";'
          + '65536;"debian12_64";"ok";"2026-09-17";"automatic"',
        '"legacy-server";"ns3000004.ip-203-0-113.eu";"Compte inconnu";"sbg3";'
          + '"Intel Xeon E3-1245v5";32768;"debian11_64";"ok";;"manual"',
        '"ns3000002.ip-198-51-100.eu";"ns3000002.ip-198-51-100.eu";"yy2222-ovh";"gra3";'
          + '"AMD EPYC 4344P";0;"none_64";"error";;""',
      ]));
    });

    // The bill lines by account, which the server gives for all accounts only: a service
    // billed to several accounts, as one that moved from an account to another, once for each
    it('names the account of each service among the bill lines of a resource type',
      async () => {
        const [app, db, files] = severalAccounts.resourceTypeDetailsByAccount.backup['2026-09'];
        const { user } = await renderDashboard({
          ...severalAccounts,
          resourceTypeDetailsByAccount: {
            // vm-db-1 moved from Lyon to yy2222-ovh during September: 10 € for each, then
            // by service, the last first, as the server gives services of the same cost
            backup: {
              '2026-09': [
                app, { ...db, total: 20 }, files, { ...db, total: 10, account: lyonAccount.nic },
              ],
            },
          },
        });
        await openTab(user, 'Infrastructure');

        await user.click(resourceType('Backup'));
        await settle();

        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30');
        expect(rowsOf(billLines())).toEqual([
          ['Service○', 'Compte○', 'Description○', 'Montant○'],
          ['vm-app-1.example.com', 'yy2222-ovh', 'Veeam Managed Backup - vm-app-1.example.com',
            '40,00€'],
          ['vm-db-1.example.com', 'yy2222-ovh', 'Veeam Managed Backup - vm-db-1.example.com',
            '20,00€'],
          ['vm-files-1.example.com', 'yy2222-ovh',
            'Veeam Managed Backup - vm-files-1.example.com', '20,00€'],
          ['vm-db-1.example.com', 'Lyon subsidiary',
            'Veeam Managed Backup - vm-db-1.example.com', '10,00€'],
        ]);
      });

    it('is not shown with an account selected, in the modal and the CSV file neither',
      async () => {
        const { user } = await renderDashboard(severalAccounts);
        await openTab(user, 'Infrastructure');
        await selectAccount(user, 'Lyon subsidiary');

        const [fromPanel, fromModal] = await downloadFromPanelAndModal(user, serversPanel());

        expect(rowsOf(within(screen.getByRole('dialog')).getByRole('table'))).toEqual([
          serverRows[0], serverRows[1],
        ]);
        expect(fromModal).toEqual(fromPanel);
        expect(fromPanel.content.slice(BOM.length).split('\n')[0]).toBe(
          '"Nom";"ID";"Datacentre";"CPU";"RAM (Mo)";"OS";"État";"Date d\'expiration";'
            + '"Renouvellement"',
        );
      });

    // Its bill lines are the account's own, which name no account
    it('asks for no bill lines by account with an account selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Infrastructure');
      await selectAccount(user, 'Lyon subsidiary');

      await user.click(resourceType('Dedicated Servers'));
      await settle();

      expect(api.fetchResourceTypeDetailsByAccount).not.toHaveBeenCalled();
      expect(rowsOf(billLines())).toEqual([
        ['Service○', 'Description○', 'Montant○'],
        ['ns3000001.ip-203-0-113.eu',
          'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', '270,00€'],
      ]);
    });

    // As the page shows them before an instance could import several accounts, in their CSV
    // files too, whatever the services say of their account
    it.each([
      ['no account, as before the first import since the upgrade', []],
      ['a single account', [lyonAccount]],
    ])('is not shown with %s', async (_, accounts) => {
      const { user } = await renderDashboard({ ...severalAccounts, accounts });
      await openTab(user, 'Infrastructure');
      const downloadedFiles = captureFileDownloads();

      await user.click(serversButton('CSV'));
      await user.click(resourceType('Dedicated Servers'));
      await settle();

      expect(rowsOf(within(serversPanel()).getByRole('table'))[0]).toEqual(serverRows[0]);
      expect(rowsOf(within(inventoryPanel('VPS')).getByRole('table'))[0][1]).toBe('Modèle○');
      expect(rowsOf(within(inventoryPanel('Stockage')).getByRole('table'))[0][1]).toBe('Type○');
      expect(rowsOf(billLines())[0]).toEqual(['Service○', 'Description○', 'Montant○']);
      expect(api.fetchResourceTypeDetailsByAccount).not.toHaveBeenCalled();
      const [file] = await downloadedFiles();
      expect(file.content.slice(BOM.length).split('\n')[0]).toBe(
        '"Nom";"ID";"Datacentre";"CPU";"RAM (Mo)";"OS";"État";"Date d\'expiration";'
          + '"Renouvellement"',
      );
    });

    it('speaks English when the page does, in the CSV file too', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectLanguage(user, 'en');
      await openTab(user, 'Infrastructure');
      const downloadedFiles = captureFileDownloads();

      await user.click(within(serversPanel(/^Dedicated Servers \(/))
        .getByRole('button', { name: 'CSV' }));

      expect(rowsOf(within(inventoryPanel('Storage')).getByRole('table'))).toEqual([
        ['ID○', 'Account○', 'Type○', 'Region○', 'Size○', 'Shares○', 'Expiration date○'],
        ['old-nas', 'Unknown account', 'netapp', 'eu-west-gra', '512 GB', '3', '2026-09-10'],
        ['shared-files', 'Lyon subsidiary', 'netapp', 'eu-west-gra', '1.0 TB', '3',
          '2027-03-01'],
      ]);
      const [file] = await downloadedFiles();
      expect(file.content.slice(BOM.length).split('\n').slice(0, 1)).toEqual([
        '"Name";"ID";"Account";"Datacenter";"CPU";"RAM (MB)";"OS";"State";"Expiration date";'
          + '"Renewal"',
      ]);
      expect(file.content).toContain('"legacy-server";"ns3000004.ip-203-0-113.eu";'
        + '"Unknown account";');
    });
  });
});
