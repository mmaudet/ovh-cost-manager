import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api } from './support/api.js';
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

  // The VMs row then counts the backup bill lines of the costs by resource type, and the
  // Total row with it (#64)
  describe('while the backup statistics are missing', () => {
    const fallbackRows = [
      ['Catégorie', 'Nombre', 'Coût'],
      ['VMs Veeam Backup', '3', '90,00€'],
      ['Total', '3', '90,00€'],
    ];
    const resourceRows = () => rowsOf(within(resourcesPanel()).getByRole('table'));

    it('totals the VMs of the costs by resource type while they load (#64)', async () => {
      const { user } = await renderDashboard();
      // Hold back the backup statistics
      const answer = api.fetchBackupStats.getMockImplementation();
      let release;
      const heldBack = new Promise((resolve) => {
        release = resolve;
      });
      api.fetchBackupStats.mockImplementation(async (...args) => {
        await heldBack;
        return answer(...args);
      });

      await user.click(screen.getByRole('button', { name: 'Backup' }));

      expect(resourceRows()).toEqual(fallbackRows);

      release();
      await settle();
      expect(resourceRows()).toEqual([
        ['Catégorie', 'Nombre', 'Coût'],
        ['VMs Veeam Backup', '3', '90,00€'],
        ['Licence Veeam Enterprise', '1', '25,00€'],
        ['Total', '4', '115,00€'],
      ]);
    });

    it('totals the VMs of the costs by resource type when they fail (#64)', async () => {
      const { user } = await renderDashboard();
      api.fetchBackupStats.mockRejectedValue(new Error('Request failed with status code 500'));

      await openTab(user, 'Backup');

      expect(resourceRows()).toEqual(fallbackRows);
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
