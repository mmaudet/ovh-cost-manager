import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { severalAccounts } from './fixtures/accounts.js';
import { api } from './support/api.js';
import {
  cardRowOf, openTab, renderDashboard, selectAccount, selectLanguage, selectMonth, texts,
} from './support/render.jsx';

// The cards of the month's carbon footprint: its total, then its emission sources
const footprintCards = (firstLabel = 'Empreinte carbone') => cardRowOf(firstLabel);

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

    expect(texts(footprintCards())).toEqual([
      'Empreinte carbone', '4 036,50 kgCO₂e',
      'Fabrication', '1 234,50 kgCO₂e',
      'Électricité', '2 345,25 kgCO₂e',
      'Opérations', '456,75 kgCO₂e',
    ]);
  });

  it('says so when the month selected has no carbon footprint', async () => {
    const { user } = await renderDashboard();

    // September, the current month
    await openTab(user, 'Carbone');

    expect(screen.getByText("Septembre 2026 : pas d'empreinte carbone.")).toBeInTheDocument();
    expect(screen.queryByText('Empreinte carbone')).toBeNull();
  });

  it('follows the account selected in the header', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await selectAccount(user, 'yy2222-ovh');
    await selectMonth(user, 'Août 2026');

    await openTab(user, 'Carbone');

    expect(api.fetchCarbonFootprint).toHaveBeenLastCalledWith('2026-08', 'yy2222-ovh');
    expect(texts(footprintCards())).toEqual([
      'Empreinte carbone', '2 600,00 kgCO₂e',
      'Fabrication', '800,00 kgCO₂e',
      'Électricité', '1 500,00 kgCO₂e',
      'Opérations', '300,00 kgCO₂e',
    ]);
  });

  it('speaks English', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'EN');

    await openTab(user, 'Carbon');
    expect(screen.getByText('September 2026: no carbon footprint.')).toBeInTheDocument();

    await selectMonth(user, 'August 2026');
    expect(texts(footprintCards('Carbon footprint'))).toEqual([
      'Carbon footprint', '4,036.50 kgCO₂e',
      'Manufacturing', '1,234.50 kgCO₂e',
      'Electricity', '2,345.25 kgCO₂e',
      'Operations', '456.75 kgCO₂e',
    ]);
  });
});
