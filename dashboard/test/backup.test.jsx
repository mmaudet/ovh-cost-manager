import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api, holdBack } from './support/api.js';
import {
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

const backupCards = (firstLabel = 'Coût total backup') => cardRowOf(firstLabel);
const resourcesPanel = (heading = 'Ressources Backup') => cardOf(heading);
const resourceRows = () => rowsOf(within(resourcesPanel()).getByRole('table'));

describe('Backup tab', () => {
  it('loads the backup figures when the tab opens, not before', async () => {
    const { user } = await renderDashboard();
    expect(api.fetchBackupStats).not.toHaveBeenCalled();

    await openTab(user, 'Backup');

    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
  });

  it('shows the backup costs of the selected month', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Backup');

    expect(texts(backupCards())).toEqual([
      'Coût total backup', '115,00€',
      'VMs Veeam', '3', '90,00€',
      'Licences Veeam Enterprise', '1', '25,00€',
      // 115 / 1 250.40, written the French way (#64)
      '% du coût total', '9,2 %',
    ]);
    expect(texts(within(resourcesPanel()).getByRole('heading')))
      .toEqual(['Ressources Backup', '(Septembre 2026)']);
    expect(rowsOf(within(resourcesPanel()).getByRole('table'))).toEqual([
      ['Catégorie', 'Nombre', 'Coût'],
      ['VMs Veeam Backup', '3', '90,00€'],
      ['Licence Veeam Enterprise', '1', '25,00€'],
      ['Total', '4', '115,00€'],
    ]);
  });

  it('follows the month selector', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Backup');

    await selectMonth(user, 'Août 2026');

    expect(texts(backupCards())).toEqual([
      'Coût total backup', '40,00€',
      'VMs Veeam', '2', '40,00€',
      'Licences Veeam Enterprise', '0',
      // 40 / 1 042, written the French way (#64)
      '% du coût total', '3,8 %',
    ]);
    expect(texts(within(resourcesPanel()).getByRole('heading')))
      .toEqual(['Ressources Backup', '(Août 2026)']);
    // No Enterprise license that month: no row for it
    expect(rowsOf(within(resourcesPanel()).getByRole('table'))).toEqual([
      ['Catégorie', 'Nombre', 'Coût'],
      ['VMs Veeam Backup', '2', '40,00€'],
      ['Total', '2', '40,00€'],
    ]);
  });

  it('says when nothing was backed up in the month', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Backup');

    await selectMonth(user, 'Juillet 2026');

    expect(texts(backupCards())).toEqual([
      'Coût total backup', '0,00€',
      'VMs Veeam', '0',
      'Licences Veeam Enterprise', '0',
      // Written the French way (#64)
      '% du coût total', '0,0 %',
    ]);
    expect(within(resourcesPanel()).getByText(
      'Aucun service de backup trouvé pour cette période',
    )).toBeInTheDocument();
    expect(within(resourcesPanel()).queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a share of 0,0 % of a month without cost (#64)', async () => {
    // Nothing billed in July: the server sums a total of 0
    const { user } = await renderDashboard({
      ...account,
      summary: { ...account.summary, '2026-07': undefined },
    });
    await openTab(user, 'Backup');

    await selectMonth(user, 'Juillet 2026');

    expect(texts(cardOf('% du coût total'))).toEqual(['% du coût total', '0,0 %']);
  });

  // Rather than figures that change once they arrive, as the Web Cloud tab does (#64)
  it('shows that it is loading until the backup statistics arrive (#64)', async () => {
    const { user } = await renderDashboard();
    // Hold back the backup statistics
    const release = holdBack(api.fetchBackupStats);

    await user.click(screen.getByRole('button', { name: 'Backup' }));

    expect(screen.getByText('Chargement des données...')).toBeInTheDocument();
    expect(screen.queryByText('Coût total backup')).not.toBeInTheDocument();
    expect(screen.queryByText('Ressources Backup')).not.toBeInTheDocument();

    release();
    await settle();
    expect(screen.queryByText('Chargement des données...')).not.toBeInTheDocument();
    expect(resourceRows()).toEqual([
      ['Catégorie', 'Nombre', 'Coût'],
      ['VMs Veeam Backup', '3', '90,00€'],
      ['Licence Veeam Enterprise', '1', '25,00€'],
      ['Total', '4', '115,00€'],
    ]);
  });

  it('says in English that it is loading (#64)', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');
    const release = holdBack(api.fetchBackupStats);

    await user.click(screen.getByRole('button', { name: 'Backup' }));

    expect(screen.getByText('Loading data...')).toBeInTheDocument();
    release();
    await settle();
  });

  // It then says so, above what the costs by resource type still tell: the VMs, whose bill
  // lines they sum, in the VMs row and in the Total row (#64)
  describe('when the backup statistics fail', () => {
    it('says so, and totals the VMs of the costs by resource type (#64)', async () => {
      const { user } = await renderDashboard();
      api.fetchBackupStats.mockRejectedValue(new Error('Request failed with status code 500'));

      await openTab(user, 'Backup');

      expect(screen.getByText('Impossible de charger les données Backup.')).toBeInTheDocument();
      expect(resourceRows()).toEqual([
        ['Catégorie', 'Nombre', 'Coût'],
        ['VMs Veeam Backup', '3', '90,00€'],
        ['Total', '3', '90,00€'],
      ]);
    });

    it('says so in English when the page does (#64)', async () => {
      const { user } = await renderDashboard();
      await selectLanguage(user, 'en');
      api.fetchBackupStats.mockRejectedValue(new Error('Request failed with status code 500'));

      await openTab(user, 'Backup');

      expect(screen.getByText('Could not load the Backup data.')).toBeInTheDocument();
    });
  });

  it('speaks English when the page does', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');

    await openTab(user, 'Backup');

    expect(texts(backupCards('Total Backup Cost'))).toEqual([
      'Total Backup Cost', '115.00€',
      'Veeam VMs', '3', '90.00€',
      'Veeam Enterprise Licenses', '1', '25.00€',
      '% of Total Cost', '9.2%',
    ]);
    expect(screen.getByRole('heading', { name: /^Backup Resources/ })).toBeInTheDocument();
    expect(rowsOf(within(resourcesPanel('Backup Resources')).getByRole('table'))).toEqual([
      ['Category', 'Count', 'Cost'],
      ['Veeam Backup VMs', '3', '90.00€'],
      ['Veeam Enterprise License', '1', '25.00€'],
      ['Total', '4', '115.00€'],
    ]);
  });
});
