import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { api } from './support/api.js';
import {
  cardOf,
  cardRowOf,
  openTab,
  renderDashboard,
  rowsOf,
  selectLanguage,
  selectMonth,
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
      // 115 / 1 250.40
      '% du coût total', '9.2%',
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
      // 40 / 1 042
      '% du coût total', '3.8%',
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
      '% du coût total', '0.0%',
    ]);
    expect(within(resourcesPanel()).getByText(
      'Aucun service de backup trouvé pour cette période',
    )).toBeInTheDocument();
    expect(within(resourcesPanel()).queryByRole('table')).not.toBeInTheDocument();
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
