import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api } from './support/api.js';
import { captureFileDownloads } from './support/downloads.js';
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

const tableHeader = ['Service', 'Libellé de facture', 'Dernière facture', 'Coût'];
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

    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-10-01', '2026-09-30');
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30');
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

  describe('"show all" modal', () => {
    const showAll = async (user, family) => {
      await user.click(familyButton(family, 'Tout afficher'));
      return screen.getByRole('dialog');
    };

    it('shows every service of the family, and closes with its button', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');

      const dialog = await showAll(user, 'Emails');

      expect(within(dialog).getByText('Emails (2)')).toBeInTheDocument();
      expect(within(dialog).getByText('44,52€')).toBeInTheDocument();
      expect(rowsOf(within(dialog).getByRole('table'))).toEqual([
        tableHeader,
        ['example.com', 'Email Pro example.com - 2 comptes - 12 mois', '2026-09-01', '47,52€'],
        ['example.org', 'Avoir MX Plan example.org', '2026-09-01', '-3,00€'],
      ]);

      await user.click(within(dialog).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes with Escape', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');
      await showAll(user, 'Domaines');

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on a click outside it', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Web Cloud');
      const dialog = await showAll(user, 'Domaines');

      await user.click(backdropOf(dialog));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    const answer = api[request].getMockImplementation();
    let release;
    const heldBack = new Promise((resolve) => {
      release = resolve;
    });
    api[request].mockImplementation(async (...args) => {
      await heldBack;
      return answer(...args);
    });

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
      .toEqual(['Service', 'Bill wording', 'Last billed', 'Cost']);
    const downloadedFiles = captureFileDownloads();

    await user.click(familyButton('Domains', 'CSV'));

    const [file] = await downloadedFiles();
    expect(file.content.split('\n')[0]).toBe(
      `${BOM}"Service";"Family";"Bill wording";"Bill lines";"First billed";"Last billed";"Cost (EUR)"`,
    );
  });
});
