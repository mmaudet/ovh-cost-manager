import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { severalAccounts } from './fixtures/accounts.js';
import { api } from './support/api.js';
import {
  cardRowOf, openTab, renderDashboard, selectAccount, selectLanguage, selectMonth, texts,
} from './support/render.jsx';

// The cards of the month's carbon footprint: its total, with its market-based total, then its
// emission sources
const footprintCards = (firstLabel = 'Empreinte carbone') => cardRowOf(firstLabel);

// What says what separates the market-based total from the other (#152)
const MARKET_BASED = "Le total market-based tient compte des contrats d'énergie bas carbone "
  + "d'OVHcloud, au lieu du mix électrique local de chaque datacenter.";

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
    expect(texts(footprintCards())).toEqual([
      'Empreinte carbone', '4 036,50 kgCO₂e', 'Market-based : 3 012,25 kgCO₂e',
      'Fabrication', '1 234,50 kgCO₂e',
      'Électricité', '2 345,25 kgCO₂e',
      'Opérations', '456,75 kgCO₂e',
    ]);
    expect(screen.getByText(MARKET_BASED)).toBeInTheDocument();
  });

  // OVHcloud never gives the current month's footprint, nor the previous one's until it has
  // computed it, and the page opens on the current month (#152)
  it('shows the latest month that has a carbon footprint when the month selected has none',
    async () => {
      const { user } = await renderDashboard();

      // September, the current month
      await openTab(user, 'Carbone');

      expect(screen.getByText("Septembre 2026 n'a pas encore d'empreinte carbone : OVHcloud "
        + 'la publie une fois le mois terminé.')).toBeInTheDocument();
      expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-08', null);
      expect(screen.getByRole('heading', { name: 'Août 2026 · dernier mois disponible' }))
        .toBeInTheDocument();
      expect(texts(footprintCards())).toEqual([
        'Empreinte carbone', '4 036,50 kgCO₂e', 'Market-based : 3 012,25 kgCO₂e',
        'Fabrication', '1 234,50 kgCO₂e',
        'Électricité', '2 345,25 kgCO₂e',
        'Opérations', '456,75 kgCO₂e',
      ]);
    });

  it('says so when there is no carbon footprint at all', async () => {
    const { user } = await renderDashboard(severalAccounts);
    await selectAccount(user, 'Lyon subsidiary');

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
      'Empreinte carbone', '2 600,00 kgCO₂e', 'Market-based : 2 000,00 kgCO₂e',
      'Fabrication', '800,00 kgCO₂e',
      'Électricité', '1 500,00 kgCO₂e',
      'Opérations', '300,00 kgCO₂e',
    ]);
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
      'Manufacturing', '1,234.50 kgCO₂e',
      'Electricity', '2,345.25 kgCO₂e',
      'Operations', '456.75 kgCO₂e',
    ]);
    expect(screen.getByText("The market-based total counts OVHcloud's low-carbon energy "
      + "contracts instead of each datacenter's local electricity mix.")).toBeInTheDocument();
  });
});
