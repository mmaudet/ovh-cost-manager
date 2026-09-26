import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { sinceJuly2025 } from './fixtures/trends.js';
import { api } from './support/api.js';
import {
  cardOf,
  dropdown,
  openTab,
  optionsOf,
  renderDashboard,
  selectLanguage,
  selectMonth,
  settle,
  swatchOf,
  texts,
} from './support/render.jsx';

// The period selector, next to the tab bar, always offers the shortest period
const periodSelector = (shortest = '3 mois') => dropdown(shortest);
// The legend of the cost trend by resource type: one button per resource type
const legendItem = (resourceType) =>
  within(cardOf('Évolution par catégorie')).getByRole('button', { name: resourceType });
// The grey that the dot of a hidden resource type turns to
const hiddenSwatch = { backgroundColor: '#d1d5db' };

describe('Trends tab', () => {
  it('loads the trends when the page opens, and the GPU trend when the tab opens', async () => {
    const { user } = await renderDashboard();

    // Over the longest period the three billed months allow, up to the selected month
    expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09');
    expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-09');
    // Only the GPU costs of the selected month so far, for the Overview
    expect(api.fetchGpuSummary).not.toHaveBeenCalledWith('2026-07-01', '2026-09-30');

    await openTab(user, 'Tendances');

    // The same 3 months, from July to September
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-07-01', '2026-09-30');
    expect(periodSelector()).toHaveDisplayValue('3 mois');
    expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 3 mois' }))
      .toBeInTheDocument();
  });

  describe('period', () => {
    it('is offered next to the tab bar on the Trends tab only', async () => {
      const { user } = await renderDashboard();
      expect(screen.queryByText('Période:')).not.toBeInTheDocument();

      await openTab(user, 'Tendances');

      expect(periodSelector()).toBeInTheDocument();
    });

    it('goes no further than the billed months allow', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Tendances');

      // Three billed months: 3 months cover them all
      expect(optionsOf(periodSelector())).toEqual(['3 mois']);
      expect(periodSelector()).toHaveDisplayValue('3 mois');
      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 3 mois' }))
        .toBeInTheDocument();
    });

    it('goes up to the first period that covers the whole history', async () => {
      const { user } = await renderDashboard({ ...account, ...sinceJuly2025 });

      await openTab(user, 'Tendances');

      // 15 months of history: 2 years is the first period that covers them
      expect(optionsOf(periodSelector())).toEqual(['3 mois', '6 mois', '1 an', '2 ans']);
      expect(periodSelector()).toHaveDisplayValue('6 mois');
      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 6 mois' }))
        .toBeInTheDocument();
    });

    it('goes no further than the billed months up to the selected one allow', async () => {
      const { user } = await renderDashboard({ ...account, ...sinceJuly2025 });
      await openTab(user, 'Tendances');
      expect(periodSelector()).toHaveDisplayValue('6 mois');

      await selectMonth(user, 'Juillet 2025');

      // July 2025 is the first billed month: 3 months cover it
      expect(optionsOf(periodSelector())).toEqual(['3 mois']);
      expect(periodSelector()).toHaveDisplayValue('3 mois');
      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 3 mois' }))
        .toBeInTheDocument();
      expect(texts(cardOf('Mois le plus coûteux')))
        .toEqual(['Mois le plus coûteux', 'juil. 2025', '450,00€']);
    });

    it('keeps the period picked while an older month offers only shorter ones', async () => {
      const { user } = await renderDashboard({ ...account, ...sinceJuly2025 });
      await openTab(user, 'Tendances');
      await user.selectOptions(periodSelector(), '2 ans');
      await settle();

      await selectMonth(user, 'Juillet 2025');
      expect(periodSelector()).toHaveDisplayValue('3 mois');

      await selectMonth(user, 'Septembre 2026');

      expect(periodSelector()).toHaveDisplayValue('2 ans');
      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 2 ans' }))
        .toBeInTheDocument();
    });

    it('reloads the trends over the period the user picks', async () => {
      const { user } = await renderDashboard({ ...account, ...sinceJuly2025 });
      await openTab(user, 'Tendances');

      await user.selectOptions(periodSelector(), '2 ans');
      await settle();

      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 2 ans' }))
        .toBeInTheDocument();
      // From July 2025: (1 250.40 - 450) / 450
      expect(texts(cardOf('Croissance sur la période')))
        .toEqual(['Croissance sur la période', '+177.9%', 'Sur 2 ans']);
    });
  });

  it('shows the period growth, the most expensive month and the annual projection', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Tendances');

    // (1 250.40 - 980) / 980
    expect(texts(cardOf('Croissance sur la période')))
      .toEqual(['Croissance sur la période', '+27.6%', 'Sur 3 mois']);
    expect(texts(cardOf('Mois le plus coûteux')))
      .toEqual(['Mois le plus coûteux', 'sept. 2026', '1 250,40€']);
    // 12 times the last month
    expect(texts(cardOf('Projection annuelle')))
      .toEqual(['Projection annuelle', '~15 004,80€', 'Basé sur le dernier mois']);
  });

  // #65: a first month at 0 € or less leaves no growth to compute
  describe('growth over the period', () => {
    // The account with July, the first of the 3 months up to September, at that cost
    const julyAt = (cost) => {
      const [july, ...augustAndSeptember] = account.monthlyTrend['2026-09'][3];
      return {
        ...account,
        monthlyTrend: { '2026-09': { 3: [{ ...july, cost }, ...augustAndSeptember] } },
      };
    };
    const growthCard = () => cardOf('Croissance sur la période');

    // Its credits cancel its costs out: the growth would be infinite
    it('shows none from a first month at 0 €, and says why', async () => {
      const { user } = await renderDashboard(julyAt(0));

      await openTab(user, 'Tendances');

      expect(texts(growthCard())).toEqual(['Croissance sur la période', '—', 'Sur 3 mois']);
      expect(within(growthCard()).getByTitle('non calculable : premier mois à 0 €'))
        .toHaveTextContent('—');

      await selectLanguage(user, 'en');

      expect(within(cardOf('Growth over period'))
        .getByTitle('cannot be computed: first month at €0')).toHaveTextContent('—');
    });

    // Its credits exceed its costs: the growth would have the wrong sign
    it('shows none from a negative first month', async () => {
      const { user } = await renderDashboard(julyAt(-120.5));

      await openTab(user, 'Tendances');

      expect(texts(growthCard())).toEqual(['Croissance sur la période', '—', 'Sur 3 mois']);
      expect(within(growthCard()).getByTitle('non calculable : premier mois à 0 €'))
        .toHaveTextContent('—');
    });
  });

  it('ends on the month selected in the header', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Tendances');

    await selectMonth(user, 'Août 2026');

    // June to August
    expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-08');
    expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-08');
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-06-01', '2026-08-31');
    expect(periodSelector()).toHaveDisplayValue('3 mois');
    // The growth over the period is left unchecked: June, its first month, was not billed,
    // a case left to #65
    expect(texts(cardOf('Mois le plus coûteux')))
      .toEqual(['Mois le plus coûteux', 'août 2026', '1 042,00€']);
    expect(texts(cardOf('Projection annuelle')))
      .toEqual(['Projection annuelle', '~12 504,00€', 'Basé sur le dernier mois']);
    // No licence was billed before September
    expect(texts(cardOf('Évolution par catégorie'))).toEqual([
      'Évolution par catégorie',
      'Public Cloud', 'Dedicated Servers', 'Domains', 'Backup',
    ]);
    // Over those months, GPUs were billed in August alone: no trend to draw
    expect(screen.queryByText('Évolution des coûts GPU')).not.toBeInTheDocument();
  });

  describe('cost trend by resource type', () => {
    it('has a legend with every resource type, most expensive first', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Tendances');

      expect(texts(cardOf('Évolution par catégorie'))).toEqual([
        'Évolution par catégorie',
        'Public Cloud', 'Dedicated Servers', 'Backup', 'Domains', 'Licenses',
      ]);
    });

    // The chart drops the line of a hidden resource type, the legend greys it out
    it('greys out a resource type the user hides, until a second click', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Tendances');
      expect(swatchOf(legendItem('Dedicated Servers'))).toHaveStyle({ backgroundColor: '#ef4444' });

      await user.click(legendItem('Dedicated Servers'));

      expect(swatchOf(legendItem('Dedicated Servers'))).toHaveStyle(hiddenSwatch);
      expect(swatchOf(legendItem('Public Cloud'))).toHaveStyle({ backgroundColor: '#3b82f6' });

      await user.click(legendItem('Dedicated Servers'));

      expect(swatchOf(legendItem('Dedicated Servers'))).toHaveStyle({ backgroundColor: '#ef4444' });
    });

    it('keeps the period and the hidden resource types when the user comes back', async () => {
      const { user } = await renderDashboard({ ...account, ...sinceJuly2025 });
      await openTab(user, 'Tendances');
      await user.selectOptions(periodSelector(), '1 an');
      await settle();
      await user.click(legendItem('Dedicated Servers'));

      await openTab(user, "Vue d'ensemble");
      await openTab(user, 'Tendances');

      expect(periodSelector()).toHaveDisplayValue('1 an');
      expect(swatchOf(legendItem('Dedicated Servers'))).toHaveStyle(hiddenSwatch);
      expect(swatchOf(legendItem('Public Cloud'))).toHaveStyle({ backgroundColor: '#3b82f6' });
    });
  });

  describe('GPU trend', () => {
    it('shows the GPU costs over the period', async () => {
      const { user } = await renderDashboard();

      await openTab(user, 'Tendances');

      expect(texts(cardOf('Évolution des coûts GPU')))
        .toEqual(['Évolution des coûts GPU', 'Total: 730,50€']);
    });

    it('is left out when GPUs were billed in a single month of the period', async () => {
      const threeMonths = '2026-07/2026-09';
      const singleMonth = {
        ...account.gpuSummary[threeMonths],
        total: 420.5,
        monthlyTrend: [{ month: '2026-09', total: 420.5 }],
      };
      const { user } = await renderDashboard({
        ...account,
        gpuSummary: { [threeMonths]: singleMonth },
      });

      await openTab(user, 'Tendances');

      expect(screen.queryByText('Évolution des coûts GPU')).not.toBeInTheDocument();
    });
  });

  it('says there is no data when nothing was billed over the period', async () => {
    const { user } = await renderDashboard({
      ...account,
      monthlyTrend: {},
      monthlyTrendByCategory: {},
      gpuSummary: {},
    });

    await openTab(user, 'Tendances');

    expect(screen.getAllByText('Pas de données disponibles pour cette période')).toHaveLength(2);
    expect(texts(cardOf('Croissance sur la période')))
      .toEqual(['Croissance sur la période', 'N/A', 'Sur 3 mois']);
    expect(texts(cardOf('Mois le plus coûteux'))).toEqual(['Mois le plus coûteux', 'N/A']);
    expect(texts(cardOf('Projection annuelle')))
      .toEqual(['Projection annuelle', 'N/A', 'Basé sur le dernier mois']);
    expect(screen.queryByText('Évolution des coûts GPU')).not.toBeInTheDocument();
  });

  it('speaks English when the page does', async () => {
    const { user } = await renderDashboard();
    await selectLanguage(user, 'en');

    await openTab(user, 'Trends');

    expect(periodSelector('3 months')).toHaveDisplayValue('3 months');
    expect(screen.getByRole('heading', { name: 'Total cost evolution over 3 months' }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cost evolution by category' }))
      .toBeInTheDocument();
    expect(texts(cardOf('GPU cost evolution'))).toEqual(['GPU cost evolution', 'Total: 730.50€']);
    expect(texts(cardOf('Growth over period')))
      .toEqual(['Growth over period', '+27.6%', 'Over 3 months']);
    expect(texts(cardOf('Most expensive month')))
      .toEqual(['Most expensive month', 'Sep 2026', '1,250.40€']);
    expect(texts(cardOf('Annual projection')))
      .toEqual(['Annual projection', '~15,004.80€', 'Based on last month']);
  });
});
