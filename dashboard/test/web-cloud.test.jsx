import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { lyonAccount, removedAccount, severalAccounts } from './fixtures/accounts.js';
import { api, holdBack } from './support/api.js';
import {
  captureFileDownloads, csvFile, downloadFromPanelAndModal,
} from './support/downloads.js';
import {
  cardOf,
  cardRowOf,
  closeAndCheckFocus,
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

const periodLine = (label = '12 mois glissants') => screen.getByText(label);
const familyCards = (firstLabel = 'Domaines') => cardRowOf(firstLabel);
// The panel of a Web Cloud family, found by its heading: "Domaines (2)"
const familyPanel = (family) =>
  cardOf(screen.getByRole('heading', { name: new RegExp(`^${family} \\(`) }));
const familyTable = (family) => within(familyPanel(family)).getByRole('table');
// "Tout afficher" or "CSV", next to the heading of a family
const familyButton = (family, name) => within(familyPanel(family)).getByRole('button', { name });
const familyHeadings = () =>
  screen.queryAllByRole('heading', { level: 3 }).map((heading) => texts(heading));

const tableHeader = ['Service○', 'Libellé de facture○', 'Dernière facture○', 'Coût○'];
// The byte order mark that starts the CSV files, so that Excel reads their
// accents as UTF-8
const BOM = '\uFEFF';
const csvHeader =
  '"Service";"Famille";"Libellé de facture";"Lignes de facture";"Première facture";"Dernière facture";"Coût (EUR)"';

describe('Web Cloud tab', () => {
  it('loads the Web Cloud services when the tab opens, not before', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
    expect(api.fetchWebCloudItems).not.toHaveBeenCalled();

    await openTab(user, 'Web Cloud');

    // For all accounts (null), as the instance knows a single one: the request names none
    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-10-01', '2026-09-30', null);
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30', null);
  });

  it('covers the rolling 12 months that end on the selected month', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Web Cloud');

    expect(texts(periodLine())).toEqual([
      '12 mois glissants',
      '(oct. 2025 → sept. 2026)',
      "· domaines et hébergements se renouvellent à l'année, un seul mois n'en montrerait qu'une partie",
    ]);

    await selectMonth(user, 'Août 2026');

    expect(texts(periodLine())).toContain('(sept. 2025 → août 2026)');
    // Over those 12 months, only a domain and the hosting were billed. A
    // family without cost shows no amount, and gets no table.
    expect(texts(familyCards())).toEqual([
      'Domaines', '1', '15,99€',
      'Zones DNS', '0',
      'Hébergements', '1', '71,88€',
      'Emails', '0',
      'Options', '0',
      'Total', '87,87€',
    ]);
    expect(familyHeadings()).toEqual([
      ['Domaines (1)', '15,99€', 'Tout afficher', 'CSV'],
      ['Hébergements (1)', '71,88€', 'Tout afficher', 'CSV'],
    ]);
  });

  it('shows the count and the cost of each Web Cloud family', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Web Cloud');

    expect(texts(familyCards())).toEqual([
      'Domaines', '2', '28,48€',
      'Zones DNS', '1', '1,20€',
      'Hébergements', '1', '71,88€',
      'Emails', '2', '44,52€',
      'Options', '1', '11,88€',
      'Total', '157,96€',
    ]);
  });

  it('lists the services of each Web Cloud family in its own table', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Web Cloud');

    expect(familyHeadings()).toEqual([
      ['Domaines (2)', '28,48€', 'Tout afficher', 'CSV'],
      ['Zones DNS (1)', '1,20€', 'Tout afficher', 'CSV'],
      ['Hébergements (1)', '71,88€', 'Tout afficher', 'CSV'],
      ['Emails (2)', '44,52€', 'Tout afficher', 'CSV'],
      ['Options (1)', '11,88€', 'Tout afficher', 'CSV'],
    ]);
    expect(rowsOf(familyTable('Domaines'))).toEqual([
      tableHeader,
      ['example.com', 'Renouvellement du domaine example.com - 1 an', '2026-01-05', '15,99€'],
      ['example.org', 'Renouvellement du domaine example.org - 1 an', '2026-09-01', '12,49€'],
    ]);
    // The DNS zone of a domain is a service of its own
    expect(rowsOf(familyTable('Zones DNS'))).toEqual([
      tableHeader,
      ['example.com', 'Zone DNS Anycast example.com - 12 mois', '2026-09-01', '1,20€'],
    ]);
    expect(rowsOf(familyTable('Hébergements'))).toEqual([
      tableHeader,
      ['example.com', 'Hébergement Pro example.com - 12 mois', '2026-03-01', '71,88€'],
    ]);
    expect(rowsOf(familyTable('Emails'))).toEqual([
      tableHeader,
      ['example.com', 'Email Pro example.com - 2 comptes - 12 mois', '2026-09-01', '47,52€'],
      // A credit note
      ['example.org', 'Avoir MX Plan example.org', '2026-09-01', '-3,00€'],
    ]);
    expect(rowsOf(familyTable('Options'))).toEqual([
      tableHeader,
      ['example.com', 'Option CDN Basic example.com - 12 mois', '2026-09-01', '11,88€'],
    ]);
  });

  // Each family on its own (#146)
  it('sorts the services of a family by any column, in its "show all" modal too', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Web Cloud');

    await sortTable(user, familyTable('Domaines'), /^Dernière facture/);

    // The latest billed first
    expect(rowsOf(familyTable('Domaines'))).toEqual([
      ['Service○', 'Libellé de facture○', 'Dernière facture▼', 'Coût○'],
      ['example.org', 'Renouvellement du domaine example.org - 1 an', '2026-09-01', '12,49€'],
      ['example.com', 'Renouvellement du domaine example.com - 1 an', '2026-01-05', '15,99€'],
    ]);
    expect(headerOf(familyTable('Emails'))).toEqual(tableHeader);

    await sortTable(user, familyTable('Emails'), /^Coût/);
    await sortTable(user, familyTable('Emails'), /^Coût/);
    await user.click(familyButton('Emails', 'Tout afficher'));

    // The credit note first
    expect(rowsOf(within(screen.getByRole('dialog')).getByRole('table'))).toEqual([
      ['Service○', 'Libellé de facture○', 'Dernière facture○', 'Coût▲'],
      ['example.org', 'Avoir MX Plan example.org', '2026-09-01', '-3,00€'],
      ['example.com', 'Email Pro example.com - 2 comptes - 12 mois', '2026-09-01', '47,52€'],
    ]);
  });

  describe('"show all" modal', () => {
    // The modal of a family, which a screen reader names by its whole title, its parts apart:
    // the family, its count and its cost (#236)
    const modalNames = { Emails: 'Emails (2) 44,52€', Domaines: 'Domaines (2) 28,48€' };
    const showAll = async (user, family) => {
      await user.click(familyButton(family, 'Tout afficher'));
      return screen.getByRole('dialog', { name: modalNames[family] });
    };

    it('takes the focus, shows every service of the family, and closes with its button',
      async () => {
        const { user } = await renderDashboard();
        await openTab(user, 'Web Cloud');

        const dialog = await showAll(user, 'Emails');

        expect(rowsOf(within(dialog).getByRole('table'))).toEqual([
          tableHeader,
          ['example.com', 'Email Pro example.com - 2 comptes - 12 mois', '2026-09-01', '47,52€'],
          ['example.org', 'Avoir MX Plan example.org', '2026-09-01', '-3,00€'],
        ]);
        await closeAndCheckFocus(user, dialog, familyButton('Emails', 'Tout afficher'), 'button');
      });

    it('closes with Escape, giving the focus back to the button that opened it', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');

      const dialog = await showAll(user, 'Domaines');

      await closeAndCheckFocus(user, dialog, familyButton('Domaines', 'Tout afficher'), 'escape');
    });

    it('closes on a click outside it, giving the focus back to its button', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');

      const dialog = await showAll(user, 'Domaines');

      await closeAndCheckFocus(
        user, dialog, familyButton('Domaines', 'Tout afficher'), 'backdrop',
      );
    });
  });

  describe('CSV export', () => {
    it('downloads the services of a family', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');
      const downloadedFiles = captureFileDownloads();

      await user.click(familyButton('Emails', 'CSV'));

      const files = await downloadedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('ovh-email-2025-10-to-2026-09.csv');
      expect(files[0].type).toBe('text/csv;charset=utf-8');
      expect(files[0].content.startsWith(BOM)).toBe(true);
      expect(files[0].content.slice(BOM.length)).toBe([
        csvHeader,
        '"example.com";"email";"Email Pro example.com - 2 comptes - 12 mois";1;"2026-09-01";"2026-09-01";47,52',
        '"example.org";"email";"Avoir MX Plan example.org";1;"2026-09-01";"2026-09-01";-3',
      ].join('\n'));
    });

    it('downloads the same file from the "show all" modal', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');
      const downloadedFiles = captureFileDownloads();

      await user.click(familyButton('Zones DNS', 'CSV'));
      await user.click(familyButton('Zones DNS', 'Tout afficher'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CSV' }));

      const [fromPanel, fromModal] = await downloadedFiles();
      expect(fromModal).toEqual(fromPanel);
      expect(fromModal).toEqual({
        name: 'ovh-dns_zone-2025-10-to-2026-09.csv',
        type: 'text/csv;charset=utf-8',
        content: BOM + [
          csvHeader,
          // Amounts keep their significant decimals only
          '"example.com";"dns_zone";"Zone DNS Anycast example.com - 12 mois";1;"2026-09-01";"2026-09-01";1,2',
        ].join('\n'),
      });
    });
  });

  // Rather than zero services, and that none was billed (#62)
  it.each([
    ['figures', 'fetchWebCloudSummary'],
    ['services', 'fetchWebCloudItems'],
  ])('shows that it is loading until its %s arrive (#62)', async (_, request) => {
    const { user } = await renderDashboard();
    // Hold back one of its two answers
    const release = holdBack(api[request]);

    await user.click(screen.getByRole('button', { name: 'Web Cloud' }));

    expect(screen.getByText('Chargement des données...')).toBeInTheDocument();
    expect(screen.queryByText('Domaines')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucun service Web Cloud facturé sur cette période'))
      .not.toBeInTheDocument();
    // The period needs no answer
    expect(texts(periodLine())).toContain('(oct. 2025 → sept. 2026)');

    release();
    await settle();

    expect(screen.queryByText('Chargement des données...')).not.toBeInTheDocument();
    expect(texts(familyCards())).toEqual([
      'Domaines', '2', '28,48€',
      'Zones DNS', '1', '1,20€',
      'Hébergements', '1', '71,88€',
      'Emails', '2', '44,52€',
      'Options', '1', '11,88€',
      'Total', '157,96€',
    ]);
    expect(familyHeadings()).toHaveLength(5);
  });

  // Rather than that none was billed, or zero services above the tables (#62)
  it.each([
    ['figures', 'fetchWebCloudSummary'],
    ['services', 'fetchWebCloudItems'],
  ])('says that its data could not be loaded when its %s fail (#62)', async (_, request) => {
    const { user } = await renderDashboard();
    api[request].mockRejectedValue(new Error('Request failed with status code 500'));

    await openTab(user, 'Web Cloud');

    expect(screen.getByText('Impossible de charger les données Web Cloud.')).toBeInTheDocument();
    expect(screen.queryByText('Aucun service Web Cloud facturé sur cette période'))
      .not.toBeInTheDocument();
    expect(screen.queryByText('Chargement des données...')).not.toBeInTheDocument();
    expect(screen.queryByText('Domaines')).not.toBeInTheDocument();
    expect(familyHeadings()).toEqual([]);
  });

  it('says in English that its data could not be loaded (#62)', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');
    api.fetchWebCloudItems.mockRejectedValue(new Error('Request failed with status code 500'));

    await openTab(user, 'Web Cloud');

    expect(screen.getByText('Could not load the Web Cloud data.')).toBeInTheDocument();
  });

  it('says when no Web Cloud service was billed over the period', async () => {
    const { user } = await renderDashboard({ ...account, webCloudItems: {}, webCloudSummary: {} });

    await openTab(user, 'Web Cloud');

    expect(screen.getByText('Aucun service Web Cloud facturé sur cette période'))
      .toBeInTheDocument();
    expect(texts(familyCards())).toEqual([
      'Domaines', '0',
      'Zones DNS', '0',
      'Hébergements', '0',
      'Emails', '0',
      'Options', '0',
      'Total', '0,00€',
    ]);
    expect(familyHeadings()).toEqual([]);
  });

  it('speaks English when the page does, in its CSV files too', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');

    await openTab(user, 'Web Cloud');

    expect(texts(periodLine('Rolling 12 months'))).toEqual([
      'Rolling 12 months',
      '(Oct 2025 → Sep 2026)',
      '· domains and hosting renew yearly, a single month would only show a slice',
    ]);
    expect(texts(familyCards('Domains'))).toEqual([
      'Domains', '2', '28.48€',
      'DNS zones', '1', '1.20€',
      'Hosting', '1', '71.88€',
      'Emails', '2', '44.52€',
      'Options', '1', '11.88€',
      'Total', '157.96€',
    ]);
    expect(familyHeadings()[0]).toEqual(['Domains (2)', '28.48€', 'Show all', 'CSV']);
    expect(rowsOf(familyTable('Domains'))[0])
      .toEqual(['Service○', 'Bill wording○', 'Last billed○', 'Cost○']);
    const downloadedFiles = captureFileDownloads();

    await user.click(familyButton('Domains', 'CSV'));

    const [file] = await downloadedFiles();
    expect(file.content.split('\n')[0]).toBe(
      `${BOM}"Service";"Family";"Bill wording";"Bill lines";"First billed";"Last billed";"Cost (EUR)"`,
    );
  });
});

// With several accounts in the instance (#122), see fixtures/accounts.js and
// fixtures/web-cloud.js: the tab shows the services of the account selected in the header,
// or those of every account, by default
describe('Web Cloud tab with several accounts', () => {
  it('shows the services of the account selected, and of all accounts again', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await openTab(user, 'Web Cloud');

    await selectAccount(user, 'Lyon subsidiary');

    expect(texts(familyCards())).toEqual([
      'Domaines', '1', '15,99€',
      'Zones DNS', '0',
      'Hébergements', '1', '71,88€',
      'Emails', '1', '11,88€',
      'Options', '1', '11,88€',
      'Total', '111,63€',
    ]);
    expect(familyHeadings()).toEqual([
      ['Domaines (1)', '15,99€', 'Tout afficher', 'CSV'],
      ['Hébergements (1)', '71,88€', 'Tout afficher', 'CSV'],
      ['Emails (1)', '11,88€', 'Tout afficher', 'CSV'],
      ['Options (1)', '11,88€', 'Tout afficher', 'CSV'],
    ]);
    expect(rowsOf(familyTable('Emails'))).toEqual([
      tableHeader,
      ['example.com', 'Email Pro example.com - 2 comptes - 1 mois', '2026-09-01', '11,88€'],
    ]);

    await selectAccount(user, 'Tous les comptes');

    expect(texts(familyCards())).toEqual([
      'Domaines', '2', '28,48€',
      'Zones DNS', '1', '1,20€',
      'Hébergements', '1', '71,88€',
      'Emails', '3', '44,52€',
      'Options', '1', '11,88€',
      'Total', '157,96€',
    ]);
  });

  // July, its only month: the 12 months that end on it
  it("shows the Unknown account's services, over the 12 months that end on its latest month",
    async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');

      await selectAccount(user, 'Compte inconnu');

      expect(texts(periodLine())).toContain('(août 2025 → juil. 2026)');
      expect(texts(familyCards())).toEqual([
        'Domaines', '0',
        'Zones DNS', '1', '1,20€',
        'Hébergements', '0',
        'Emails', '0',
        'Options', '0',
        'Total', '1,20€',
      ]);
      expect(rowsOf(familyTable('Zones DNS'))).toEqual([
        tableHeader,
        ['example.com', 'Zone DNS Anycast example.com - 12 mois', '2026-07-01', '1,20€'],
      ]);
    });

  // The month selected stays until the account's months list loads, and says it lacks it, as
  // the header's summary and the other tabs wait for (#115, #120): the 12 months that end on
  // it would never show
  it('asks for no services of the 12 months ending on a month the account selected lacks',
    async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');

      await selectAccount(user, 'zz3333-ovh (non configuré)');

      for (const request of [api.fetchWebCloudSummary, api.fetchWebCloudItems]) {
        expect(request).not.toHaveBeenCalledWith('2025-10-01', '2026-09-30', removedAccount.id);
        expect(request).toHaveBeenCalledWith('2025-09-01', '2026-08-31', removedAccount.id);
      }
    });

  describe('Account column', () => {
    const headerWithAccount =
      ['Service○', 'Compte○', 'Libellé de facture○', 'Dernière facture○', 'Coût○'];

    // By its name, or else its NIC handle, as that of the account removed from config.json.
    // Email Pro example.com moved from that account to Lyon: a service of each, with its cost.
    it('names the account of each service when the page shows all accounts', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Web Cloud');

      expect(familyHeadings()).toEqual([
        ['Domaines (2)', '28,48€', 'Tout afficher', 'CSV'],
        ['Zones DNS (1)', '1,20€', 'Tout afficher', 'CSV'],
        ['Hébergements (1)', '71,88€', 'Tout afficher', 'CSV'],
        ['Emails (3)', '44,52€', 'Tout afficher', 'CSV'],
        ['Options (1)', '11,88€', 'Tout afficher', 'CSV'],
      ]);
      expect(rowsOf(familyTable('Emails'))).toEqual([
        headerWithAccount,
        ['example.com', 'zz3333-ovh', 'Email Pro example.com - 2 comptes - 1 mois',
          '2026-06-01', '35,64€'],
        ['example.com', 'Lyon subsidiary', 'Email Pro example.com - 2 comptes - 1 mois',
          '2026-09-01', '11,88€'],
        ['example.org', 'yy2222-ovh', 'Avoir MX Plan example.org', '2026-09-01', '-3,00€'],
      ]);
      expect(rowsOf(familyTable('Domaines'))).toEqual([
        headerWithAccount,
        ['example.com', 'Lyon subsidiary', 'Renouvellement du domaine example.com - 1 an',
          '2026-01-05', '15,99€'],
        ['example.org', 'yy2222-ovh', 'Renouvellement du domaine example.org - 1 an',
          '2026-09-01', '12,49€'],
      ]);
      // A service of a bill that no account claimed
      expect(rowsOf(familyTable('Zones DNS'))).toEqual([
        headerWithAccount,
        ['example.com', 'Compte inconnu', 'Zone DNS Anycast example.com - 12 mois',
          '2026-07-01', '1,20€'],
      ]);
    });

    it('names the account of each service in the "show all" modal too', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');

      await user.click(familyButton('Domaines', 'Tout afficher'));

      expect(rowsOf(within(screen.getByRole('dialog')).getByRole('table'))).toEqual([
        headerWithAccount,
        ['example.com', 'Lyon subsidiary', 'Renouvellement du domaine example.com - 1 an',
          '2026-01-05', '15,99€'],
        ['example.org', 'yy2222-ovh', 'Renouvellement du domaine example.org - 1 an',
          '2026-09-01', '12,49€'],
      ]);
    });

    // As the page shows them before an instance could import several accounts, in their CSV
    // files too
    it.each([
      ['no account, as before the first import since the upgrade', []],
      ['a single account', [lyonAccount]],
    ])('is not shown with %s', async (_, accounts) => {
      const { user } = await renderDashboard({ ...severalAccounts, accounts });
      await openTab(user, 'Web Cloud');
      const downloadedFiles = captureFileDownloads();

      await user.click(familyButton('Emails', 'CSV'));

      expect(rowsOf(familyTable('Emails'))[0]).toEqual(tableHeader);
      const [file] = await downloadedFiles();
      expect(file.content.slice(BOM.length).split('\n')[0]).toBe(csvHeader);
    });

    it('is not shown with an account selected, in the "show all" modal neither', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');

      await selectAccount(user, 'yy2222-ovh');
      await user.click(familyButton('Domaines', 'Tout afficher'));

      expect(rowsOf(within(screen.getByRole('dialog')).getByRole('table'))).toEqual([
        tableHeader,
        ['example.org', 'Renouvellement du domaine example.org - 1 an', '2026-09-01', '12,49€'],
      ]);
    });

    it('speaks English when the page does', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectLanguage(user, 'en');

      await openTab(user, 'Web Cloud');

      expect(rowsOf(familyTable('DNS zones'))).toEqual([
        ['Service○', 'Account○', 'Bill wording○', 'Last billed○', 'Cost○'],
        ['example.com', 'Unknown account', 'Zone DNS Anycast example.com - 12 mois',
          '2026-07-01', '1.20€'],
      ]);
    });
  });

  describe('CSV export', () => {
    const csvHeaderWithAccount = '"Service";"Compte";"Famille";"Libellé de facture";'
      + '"Lignes de facture";"Première facture";"Dernière facture";"Coût (EUR)"';

    // So that a spreadsheet can pivot the services by account
    it('gives the account of each service when the page shows all accounts', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, familyPanel('Emails'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-email-2025-10-to-2026-09.csv', [
        csvHeaderWithAccount,
        '"example.com";"zz3333-ovh";"email";"Email Pro example.com - 2 comptes - 1 mois";9;'
          + '"2025-10-01";"2026-06-01";35,64',
        '"example.com";"Lyon subsidiary";"email";"Email Pro example.com - 2 comptes - 1 mois";3;'
          + '"2026-07-01";"2026-09-01";11,88',
        '"example.org";"yy2222-ovh";"email";"Avoir MX Plan example.org";1;"2026-09-01";'
          + '"2026-09-01";-3',
      ]));
    });

    it('names the Unknown account, in the language of the page', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await selectLanguage(user, 'en');
      await openTab(user, 'Web Cloud');
      const downloadedFiles = captureFileDownloads();

      await user.click(familyButton('DNS zones', 'CSV'));

      const [file] = await downloadedFiles();
      expect(file.content.slice(BOM.length).split('\n')).toEqual([
        '"Service";"Account";"Family";"Bill wording";"Bill lines";"First billed";"Last billed";'
          + '"Cost (EUR)"',
        '"example.com";"Unknown account";"dns_zone";"Zone DNS Anycast example.com - 12 mois";1;'
          + '"2026-07-01";"2026-07-01";1,2',
      ]);
    });

    it('gives no account with an account selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Web Cloud');
      await selectAccount(user, 'Lyon subsidiary');

      const [fromPanel, fromModal] =
        await downloadFromPanelAndModal(user, familyPanel('Emails'));

      expect(fromModal).toEqual(fromPanel);
      expect(fromPanel).toEqual(csvFile('ovh-email-2025-10-to-2026-09.csv', [
        csvHeader,
        '"example.com";"email";"Email Pro example.com - 2 comptes - 1 mois";3;"2026-07-01";'
          + '"2026-09-01";11,88',
      ]));
    });
  });
});
