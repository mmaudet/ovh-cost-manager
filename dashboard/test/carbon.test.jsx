import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { severalAccounts } from './fixtures/accounts.js';
import { api } from './support/api.js';
import { captureFileDownloads, csvFile } from './support/downloads.js';
import {
  cardOf, cardRowOf, disclosure, openTab, renderDashboard, rowsOf, selectAccount,
  selectLanguage, selectMonth, sentenceOf, texts,
} from './support/render.jsx';

// The cards of the month's carbon footprint: its total, with its market-based total and what
// separates them (#152), then its emission sources
const footprintCards = (firstLabel = 'Empreinte carbone') => cardRowOf(firstLabel);

// What says what separates the market-based footprint from the other (#152)
const MARKET_BASED_SENTENCE = "L'empreinte market-based tient compte des contrats d'énergie "
  + "bas carbone d'OVHcloud, au lieu du mix électrique local de chaque datacenter.";

// The cards of August, the synthetic account's latest month with a footprint
const AUGUST_CARDS = [
  'Empreinte carbone', '4 036,50 kgCO₂e', 'Market-based : 3 012,25 kgCO₂e',
  MARKET_BASED_SENTENCE,
  'Fabrication', '1 234,50 kgCO₂e',
  'Électricité', '2 345,25 kgCO₂e',
  'Opérations', '456,75 kgCO₂e',
];

describe('Carbon tab', () => {
  it('loads the carbon footprint when the tab opens, not before', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchCarbonFootprint).not.toHaveBeenCalled();

    await openTab(user, 'Carbone');

    // Of the month selected, for all accounts
    expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-09', null);
  });

  it('shows the carbon footprint of the month selected, by emission source', async () => {
    const { user } = await renderDashboard();
    await selectMonth(user, 'Août 2026');

    await openTab(user, 'Carbone');

    expect(screen.getByRole('heading', { name: 'Août 2026' })).toBeInTheDocument();
    expect(texts(footprintCards())).toEqual(AUGUST_CARDS);
    // And the trend that ends on it (#154)
    expect(api.fetchCarbonTrend).toHaveBeenCalledWith('2026-08', null);
  });

  // OVHcloud never gives the current month's footprint, nor the previous one's until it has
  // computed it, and the page opens on the current month (#152)
  describe('for a month without a carbon footprint', () => {
    it('shows the latest month that has one, as the month is too recent to have it yet',
      async () => {
        const { user } = await renderDashboard();

        // September, the current month
        await openTab(user, 'Carbone');

        expect(screen.getByText("Septembre 2026 n'a pas encore d'empreinte carbone : OVHcloud "
          + 'la publie une fois le mois terminé.')).toBeInTheDocument();
        expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-08', null);
        expect(screen.getByRole('heading', { name: 'Août 2026 · dernier mois disponible' }))
          .toBeInTheDocument();
        expect(texts(footprintCards())).toEqual(AUGUST_CARDS);
      });

    // A month before the latest that has a footprint will never have one
    it('shows the latest month that has one, without telling to wait for an older month',
      async () => {
        const { user } = await renderDashboard();
        await selectMonth(user, 'Juillet 2026');

        await openTab(user, 'Carbone');

        expect(screen.getByText("Juillet 2026 n'a pas d'empreinte carbone.")).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Août 2026 · dernier mois disponible' }))
          .toBeInTheDocument();
      });

    it('shows the latest month that has one for the account selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'yy2222-ovh');

      await openTab(user, 'Carbone');

      expect(api.fetchCarbonFootprint).toHaveBeenLastCalledWith('2026-08', 'yy2222-ovh');
      expect(screen.getByRole('heading', { name: 'Août 2026 · dernier mois disponible' }))
        .toBeInTheDocument();
      expect(texts(footprintCards())).toEqual([
        'Empreinte carbone', '2 600,00 kgCO₂e', 'Market-based : 2 000,00 kgCO₂e',
        MARKET_BASED_SENTENCE,
        'Fabrication', '800,00 kgCO₂e',
        'Électricité', '1 500,00 kgCO₂e',
        'Opérations', '300,00 kgCO₂e',
      ]);
    });
  });

  // When the account shown has no footprint at all, the tab says why, from what the accounts
  // route says of it (#153)
  describe('without any carbon footprint', () => {
    // How to get one, for a configured account or for all accounts
    const HOW_TO = "Pas encore d'empreinte carbone. Pour l'importer, ajoutez à la clé API du "
      + 'compte le droit POST /me/carbonCalculator/csv, et importez avec --include-carbon, que '
      + "--all comprend. OVHcloud ne calcule pas l'empreinte de tous ses services : voir la "
      + "liste de ceux qu'il couvre.";
    const GUIDE = 'https://docs.ovhcloud.com/fr/guides/account-and-service-management/'
      + 'managing-billing-payments-and-services/carbon-footprint';

    // What the panel that says it reads, its code and link within the sentences
    const message = () => sentenceOf(screen.getByText(/empreinte carbone/, { selector: 'div' }));

    it('says how to get one for a configured account', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');

      await openTab(user, 'Carbone');

      expect(message()).toBe(HOW_TO);
      expect(screen.getByRole('link', { name: "la liste de ceux qu'il couvre" }))
        .toHaveAttribute('href', GUIDE);
      expect(screen.queryByText('Empreinte carbone')).toBeNull();
    });

    it('says how to get one when the only account has none', async () => {
      const { user } = await renderDashboard({ ...account, carbonFootprint: {} });

      await openTab(user, 'Carbone');

      expect(message()).toBe(HOW_TO);
    });

    it('says how to get one when all accounts are shown and none has one', async () => {
      const { user } = await renderDashboard({ ...severalAccounts, carbonFootprint: {} });

      await openTab(user, 'Carbone');

      expect(message()).toBe(HOW_TO);
    });

    it('says that the Unknown account never has one', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Compte inconnu');

      await openTab(user, 'Carbone');

      expect(screen.getByText("Le compte inconnu n'a pas d'empreinte carbone : elle s'importe "
        + 'compte par compte.')).toBeInTheDocument();
    });

    it('says that an account no longer configured is no longer imported', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'zz3333-ovh (non configuré)');

      await openTab(user, 'Carbone');

      expect(screen.getByText("Ce compte n'a pas d'empreinte carbone : il n'est plus importé."))
        .toBeInTheDocument();
    });
  });

  // Nor will an account no longer imported ever get the footprint of a later month than its
  // latest (#153)
  it('says that an account no longer configured is no longer imported, for a later month',
    async () => {
      const removed = 'zz3333-ovh';
      const { user } = await renderDashboard({
        ...severalAccounts,
        ofAccount: {
          ...severalAccounts.ofAccount,
          [removed]: {
            ...severalAccounts.ofAccount[removed],
            // Its footprint of July, its latest
            carbonFootprint: {
              '2026-08': {
                month: '2026-08', footprint: null, latestMonth: '2026-07',
                accountsWithoutFootprint: null,
              },
              '2026-07': {
                ...severalAccounts.carbonFootprint['2026-08'], month: '2026-07',
                latestMonth: '2026-07', accountsWithoutFootprint: null,
              },
            },
          },
        },
      });
      await selectAccount(user, 'zz3333-ovh (non configuré)');

      await openTab(user, 'Carbone');

      expect(screen.getByText("Août 2026 n'a pas d'empreinte carbone : ce compte n'est plus "
        + 'importé.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Juillet 2026 · dernier mois disponible' }))
        .toBeInTheDocument();
    });

  // With all accounts shown, their sum leaves out those without a footprint (#153)
  it('names the accounts without a carbon footprint for the month it shows', async () => {
    const { user } = await renderDashboard(severalAccounts);

    // September, which shows August
    await openTab(user, 'Carbone');

    expect(screen.getByText('Sans empreinte carbone en août 2026 : Lyon subsidiary, '
      + 'zz3333-ovh.')).toBeInTheDocument();
  });

  it('follows the account selected in the header', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await selectAccount(user, 'yy2222-ovh');
    await selectMonth(user, 'Août 2026');

    await openTab(user, 'Carbone');

    expect(api.fetchCarbonFootprint).toHaveBeenLastCalledWith('2026-08', 'yy2222-ovh');
    expect(texts(footprintCards())[1]).toBe('2 600,00 kgCO₂e');
  });

  it('speaks English', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'EN');

    await openTab(user, 'Carbon');
    expect(screen.getByText('September 2026 has no carbon footprint yet: OVHcloud publishes '
      + 'it once the month is over.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'August 2026 · latest month available' }))
      .toBeInTheDocument();

    await selectMonth(user, 'August 2026');
    expect(texts(footprintCards('Carbon footprint'))).toEqual([
      'Carbon footprint', '4,036.50 kgCO₂e', 'Market-based: 3,012.25 kgCO₂e',
      "The market-based footprint counts OVHcloud's low-carbon energy contracts instead of "
        + "each datacenter's local electricity mix.",
      'Manufacturing', '1,234.50 kgCO₂e',
      'Electricity', '2,345.25 kgCO₂e',
      'Operations', '456.75 kgCO₂e',
    ]);
  });

  it('says in English how to get a footprint, and which accounts have none', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await selectLanguage(user, 'EN');

    await openTab(user, 'Carbon');
    expect(screen.getByText('Without a carbon footprint in August 2026: Lyon subsidiary, '
      + 'zz3333-ovh.')).toBeInTheDocument();

    await selectAccount(user, 'Lyon subsidiary');
    expect(sentenceOf(screen.getByText(/carbon footprint/, { selector: 'div' }))).toBe(
      'No carbon footprint yet. To import it, add the right POST /me/carbonCalculator/csv to '
      + "the account's API key, and import with --include-carbon, which --all includes. "
      + 'OVHcloud does not compute the footprint of all its services: see the list of those it '
      + 'covers.',
    );
    expect(screen.getByRole('link', { name: 'the list of those it covers' })).toHaveAttribute(
      'href', 'https://docs.ovhcloud.com/en/guides/account-and-service-management/'
        + 'managing-billing-payments-and-services/carbon-footprint',
    );
  });

  // The footprint of the 12 months up to the month that the tab shows (#154)
  describe('trend', () => {
    // The table of its months, which the chart draws
    const trendTable = (summary = 'Voir les chiffres') =>
      within(disclosure(summary)).getByRole('table');
    // Its legend, which names the emission sources that it stacks
    const legend = (name = "Postes d'émission") => screen.getByRole('list', { name });
    // A month without a footprint
    const none = (month) => [month, '—', '—', '—', '—'];

    it('shows the 12 months up to the month it shows, by emission source', async () => {
      const { user } = await renderDashboard();

      // September, which shows August
      await openTab(user, 'Carbone');

      expect(api.fetchCarbonTrend).toHaveBeenCalledWith('2026-08', null);
      expect(screen.getByRole('heading', { name: 'Tendance sur 12 mois (kgCO₂e)' }))
        .toBeInTheDocument();
      expect(texts(legend())).toEqual(['Fabrication', 'Électricité', 'Opérations']);
      expect(rowsOf(trendTable())).toEqual([
        ['Mois', 'Fabrication', 'Électricité', 'Opérations', 'Total'],
        none('Septembre 2025'), none('Octobre 2025'), none('Novembre 2025'),
        ['Décembre 2025', '1 100,00', '2 100,00', '400,00', '3 600,00'],
        ['Janvier 2026', '1 150,00', '2 200,00', '420,00', '3 770,00'],
        ['Février 2026', '1 150,00', '2 150,00', '410,00', '3 710,00'],
        ['Mars 2026', '1 175,00', '2 250,00', '430,00', '3 855,00'],
        ['Avril 2026', '1 200,00', '2 300,00', '440,00', '3 940,00'],
        ['Mai 2026', '1 200,00', '2 275,00', '435,00', '3 910,00'],
        ['Juin 2026', '1 225,00', '2 325,00', '450,00', '4 000,00'],
        none('Juillet 2026'),
        ['Août 2026', '1 234,50', '2 345,25', '456,75', '4 036,50'],
      ]);
    });

    it('asks for no trend without any carbon footprint', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');

      await openTab(user, 'Carbone');

      expect(api.fetchCarbonTrend).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: /Tendance/ })).toBeNull();
    });

    it('follows the account selected in the header', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'yy2222-ovh');

      await openTab(user, 'Carbone');

      expect(api.fetchCarbonTrend).toHaveBeenLastCalledWith('2026-08', 'yy2222-ovh');
      expect(rowsOf(trendTable()).at(-1))
        .toEqual(['Août 2026', '800,00', '1 500,00', '300,00', '2 600,00']);
    });

    it('speaks English', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'EN');

      await openTab(user, 'Carbon');

      expect(screen.getByRole('heading', { name: '12-month trend (kgCO₂e)' }))
        .toBeInTheDocument();
      expect(texts(legend('Emission sources')))
        .toEqual(['Manufacturing', 'Electricity', 'Operations']);
      const rows = rowsOf(trendTable('See the figures'));
      expect(rows[0]).toEqual(['Month', 'Manufacturing', 'Electricity', 'Operations', 'Total']);
      expect(rows.at(-1)).toEqual(['August 2026', '1,234.50', '2,345.25', '456.75', '4,036.50']);
    });
  });

  // Each line of the month's footprint, next to what it cost in the month of use (#155)
  describe('list', () => {
    const HEADING = 'Empreinte et coût de chaque élément';
    const list = (heading = HEADING) =>
      within(cardOf(screen.getByRole('heading', { name: heading }))).getByRole('table');
    const HEADER = [
      'Élément', 'Type', 'Datacenter', 'Empreinte (kgCO₂e)', 'Coût',
      'Intensité (kgCO₂e/€)',
    ];

    it('lists the lines of the month it shows, with their cost and intensity', async () => {
      const { user } = await renderDashboard();

      // September, which shows August
      await openTab(user, 'Carbone');

      expect(api.fetchCarbonByServer).toHaveBeenCalledWith('2026-08', null);
      expect(rowsOf(list())).toEqual([
        HEADER,
        ['ns1234567.ip-10-0-0.eu', 'Serveur dédié', 'GRA', '1 500,00', '3 000,00€', '0,500'],
        ['b2-15.monthly', 'Instance', 'GRA', '1 200,50', '24 010,00€', '0,050'],
        // Nothing billed it
        ['r2-15', 'Instance', 'SBG', '900,00', '—', '—'],
        ['high-speed', 'Volume', 'GRA', '436,00', '1 744,00€', '0,250'],
      ]);
    });

    // Before July 2026, OVHcloud's file names no dedicated server
    it('shows the servers that the file does not name in one line', async () => {
      const { user } = await renderDashboard({
        ...account,
        carbonByServer: {
          '2026-08': {
            month: '2026-08',
            lines: [
              {
                type: 'BAREMETAL', name: null, range: null, datacenter: null, serverDomain: null,
                unnamedServers: 26, account: 'xx1111-ovh', footprint: 941.83, cost: 7149.72,
                intensity: 0.1317,
              },
              {
                type: 'PCI-COMPUTE', name: 'b3-64', range: 'b3', datacenter: 'ALL',
                serverDomain: null, unnamedServers: null, account: 'xx1111-ovh', footprint: 1,
                cost: 10, intensity: 0.1,
              },
            ],
          },
        },
      });

      await openTab(user, 'Carbone');

      expect(rowsOf(list()).slice(1)).toEqual([
        [
          'Serveurs dédiés non nommés par OVHcloud (26)', 'Serveur dédié', '—', '941,83',
          '7 149,72€', '0,132',
        ],
        // A line that names no datacenter
        ['b3-64', 'Instance', 'Tous', '1,00', '10,00€', '0,100'],
      ]);
    });

    it('names the account of each line when all accounts are shown', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Carbone');

      // Second, as in the other lists
      const rows = rowsOf(list());
      expect(rows[0]).toEqual([HEADER[0], 'Compte', ...HEADER.slice(1)]);
      expect(rows.slice(1).map((row) => row[1])).toEqual(Array(4).fill('yy2222-ovh'));
    });

    it('asks for no list without any carbon footprint', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'Lyon subsidiary');

      await openTab(user, 'Carbone');

      expect(api.fetchCarbonByServer).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: HEADING })).toBeNull();
    });

    it('follows the account selected in the header', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectAccount(user, 'yy2222-ovh');

      await openTab(user, 'Carbone');

      expect(api.fetchCarbonByServer).toHaveBeenLastCalledWith('2026-08', 'yy2222-ovh');
      expect(rowsOf(list()).slice(1)).toEqual([
        ['ns1234567.ip-10-0-0.eu', 'Serveur dédié', 'GRA', '1 500,00', '3 000,00€', '0,500'],
      ]);
    });

    // As the other lists do, from the rows the page holds (#156)
    it('exports the lines of the month it shows to CSV', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Carbone');
      const downloadedFiles = captureFileDownloads();

      await user.click(within(cardOf(screen.getByRole('heading', { name: HEADING })))
        .getByRole('button', { name: 'CSV' }));

      expect(await downloadedFiles()).toEqual([csvFile('ovh-carbon-footprint-2026-08.csv', [
        '"Élément";"Type";"Gamme";"Datacenter";"Empreinte (kgCO2e)";"Coût";'
          + '"Intensité (kgCO2e/€)"',
        '"ns1234567.ip-10-0-0.eu";"BAREMETAL";"advance gen4";"GRA";1500;3000;0,5',
        '"b2-15.monthly";"PCI-COMPUTE";"b2";"GRA";1200,5;24010;0,05',
        '"r2-15";"PCI-COMPUTE";"r2";"SBG";900;;',
        '"high-speed";"PCI-BLOCK-STORAGE";"high-speed";"GRA";436;1744;0,25',
      ])]);
    });

    it('names the account of each line in the CSV when all accounts are shown', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Carbone');
      const downloadedFiles = captureFileDownloads();

      await user.click(within(cardOf(screen.getByRole('heading', { name: HEADING })))
        .getByRole('button', { name: 'CSV' }));

      const [{ content }] = await downloadedFiles();
      const [header, first] = content.slice(1).split('\n');
      expect(header).toBe('"Élément";"Compte";"Type";"Gamme";"Datacenter";'
        + '"Empreinte (kgCO2e)";"Coût";"Intensité (kgCO2e/€)"');
      expect(first).toBe('"ns1234567.ip-10-0-0.eu";"yy2222-ovh";"BAREMETAL";"advance gen4";'
        + '"GRA";1500;3000;0,5');
    });

    it('speaks English', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'EN');

      await openTab(user, 'Carbon');

      const rows = rowsOf(list('Footprint and cost of each item'));
      expect(rows.slice(0, 2)).toEqual([
        ['Item', 'Type', 'Datacenter', 'Footprint (kgCO₂e)', 'Cost', 'Intensity (kgCO₂e/€)'],
        ['ns1234567.ip-10-0-0.eu', 'Dedicated server', 'GRA', '1,500.00', '3,000.00€', '0.500'],
      ]);
    });
  });
});
