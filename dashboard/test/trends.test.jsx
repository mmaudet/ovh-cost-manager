import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { account, logsDataPlatformBilled, septemberInProgress } from './fixtures/account.js';
import {
  lyonAccount, lyonBilledLate, removedAccount, severalAccounts, severalAccountsWithAiEndpoints,
  unnamedAccount,
} from './fixtures/accounts.js';
import { aiEndpoints } from './fixtures/public-cloud.js';
import { septemberBilledLate, sinceJuly2025 } from './fixtures/trends.js';
import { api } from './support/api.js';
import {
  cardOf,
  dropdown,
  inItalics,
  openTab,
  optionsOf,
  projectionCheckbox,
  renderDashboard,
  reopenDashboard,
  selectAccount,
  selectLanguage,
  selectMonth,
  settle,
  swatchOf,
  texts,
  toggleProjection,
  toneOf,
} from './support/render.jsx';

// The period selector, next to the tab bar, always offers the shortest period
const periodSelector = (shortest = '3 mois') => dropdown(shortest);
// The legend of the cost trend by resource type: one button per resource type
const legendItem = (resourceType) =>
  within(cardOf('Évolution par catégorie')).getByRole('button', { name: resourceType });
// The grey that the dot of a hidden resource type turns to
const hiddenSwatch = { backgroundColor: '#d1d5db' };
// The account the page asks for the trends of by default: none, for all accounts (#120)
const allAccounts = null;

describe('Trends tab', () => {
  it('loads the trends when the page opens, and the GPU trend when the tab opens', async () => {
    const { user } = await renderDashboard();

    // Over the longest period the three billed months allow, up to the selected month
    expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', allAccounts);
    expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-09', allAccounts);
    // Only the GPU costs of the selected month so far, for the Overview
    expect(api.fetchGpuSummary)
      .not.toHaveBeenCalledWith('2026-07-01', '2026-09-30', allAccounts);

    await openTab(user, 'Tendances');

    // The same 3 months, from July to September
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-07-01', '2026-09-30', allAccounts);
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

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(24, '2026-09', allAccounts);
      expect(screen.getByRole('heading', { name: 'Évolution des coûts (total) sur 2 ans' }))
        .toBeInTheDocument();
      // From October 2024, before the first bill: a first month at 0 € (#65)
      expect(texts(cardOf('Croissance sur la période')))
        .toEqual(['Croissance sur la période', '—', 'Sur 2 ans']);
    });
  });

  it('shows the period growth, the most expensive month and the annual projection', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Tendances');

    // (1 250.40 - 980) / 980
    expect(texts(cardOf('Croissance sur la période')))
      .toEqual(['Croissance sur la période', '+27,6 %', 'Sur 3 mois']);
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
      expect(within(growthCard()).getByTitle('non calculable : premier mois à 0 € ou moins'))
        .toHaveTextContent('—');

      await selectLanguage(user, 'en');

      expect(within(cardOf('Growth over period'))
        .getByTitle('cannot be computed: first month at €0 or below')).toHaveTextContent('—');
    });

    it('shows an increase in red, and a decrease in green (#87)', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Tendances');

      expect(toneOf(within(growthCard()).getByText('+27,6 %'))).toBe('increase');
    });

    it('shows a decrease with its minus, in green (#87)', async () => {
      const { user } = await renderDashboard(julyAt(1300));

      await openTab(user, 'Tendances');

      // (1 250.40 - 1 300) / 1 300
      expect(texts(growthCard())).toEqual(['Croissance sur la période', '-3,8 %', 'Sur 3 mois']);
      expect(toneOf(within(growthCard()).getByText('-3,8 %'))).toBe('decrease');
    });

    // "+0,0 %" in red read as an increase that does not show (#87)
    it.each([
      ['an increase', 1250],
      ['a decrease', 1250.8],
    ])('shows %s that rounds to 0 unsigned and neutral (#87)', async (_, julyCost) => {
      const { user } = await renderDashboard(julyAt(julyCost));

      await openTab(user, 'Tendances');

      // (1 250.40 - 1 250) / 1 250 is 0.03 %, (1 250.40 - 1 250.80) / 1 250.80 -0.03 %
      expect(texts(growthCard())).toEqual(['Croissance sur la période', '0,0 %', 'Sur 3 mois']);
      expect(toneOf(within(growthCard()).getByText('0,0 %'))).toBe('neutral');

      await selectLanguage(user, 'en');

      const card = cardOf('Growth over period');
      expect(texts(card)).toEqual(['Growth over period', '0.0%', 'Over 3 months']);
      expect(toneOf(within(card).getByText('0.0%'))).toBe('neutral');
    });

    // Its credits exceed its costs: the growth would have the wrong sign
    it('shows none from a negative first month', async () => {
      const { user } = await renderDashboard(julyAt(-120.5));

      await openTab(user, 'Tendances');

      expect(texts(growthCard())).toEqual(['Croissance sur la période', '—', 'Sur 3 mois']);
      expect(within(growthCard()).getByTitle('non calculable : premier mois à 0 € ou moins'))
        .toHaveTextContent('—');
    });
  });

  it('ends on the month selected in the header', async () => {
    const { user } = await renderDashboard();
    await openTab(user, 'Tendances');

    await selectMonth(user, 'Août 2026');

    // June to August
    expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-08', allAccounts);
    expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-08', allAccounts);
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-06-01', '2026-08-31', allAccounts);
    expect(periodSelector()).toHaveDisplayValue('3 mois');
    // June, not billed, comes at 0 €: no growth to compute from it (#65)
    expect(texts(cardOf('Croissance sur la période')))
      .toEqual(['Croissance sur la période', '—', 'Sur 3 mois']);
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

    // A line of its own, as the server names it in both languages, in its own colour, apart from
    // the storage that counted it before #246, which the user hides as any other
    it('gives Logs Data Platform a line of its own (#246)', async () => {
      const { user } = await renderDashboard({ ...account, ...logsDataPlatformBilled });
      await openTab(user, 'Tendances');

      // By what they cost over the period, as the server orders them
      expect(texts(cardOf('Évolution par catégorie'))).toEqual([
        'Évolution par catégorie',
        'Public Cloud', 'Dedicated Servers', 'Backup', 'Storage', 'Logs Data Platform', 'Domains',
        'Licenses',
      ]);
      expect(swatchOf(legendItem('Logs Data Platform')))
        .toHaveStyle({ backgroundColor: '#65a30d' });

      await user.click(legendItem('Logs Data Platform'));

      expect(swatchOf(legendItem('Logs Data Platform'))).toHaveStyle(hiddenSwatch);
      expect(swatchOf(legendItem('Storage'))).toHaveStyle({ backgroundColor: '#10b981' });
    });

    it('names Logs Data Platform alike in English (#246)', async () => {
      const { user } = await renderDashboard({ ...account, ...logsDataPlatformBilled });
      await selectLanguage(user, 'en');

      await openTab(user, 'Trends');

      expect(texts(cardOf('Cost evolution by category'))).toEqual([
        'Cost evolution by category',
        'Public Cloud', 'Dedicated Servers', 'Backup', 'Storage', 'Logs Data Platform', 'Domains',
        'Licenses',
      ]);
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

  // The cost of each AI Endpoints model month by month (#196), over the months of the GPU
  // trend: see fixtures/public-cloud.js, whose account called models in August and September
  describe('AI Endpoints trend', () => {
    // The synthetic account, whose projects called AI Endpoints models
    const withAiEndpoints = { ...account, aiEndpoints };
    const AI_ENDPOINTS_TREND =
      /^(Évolution des coûts AI Endpoints par modèle|AI Endpoints cost evolution by model)$/;
    // The card of the chart: its heading, then its legend, one item per model
    const aiEndpointsTrend = () =>
      cardOf(screen.getByRole('heading', { name: AI_ENDPOINTS_TREND }));
    const legendOf = (card) => within(card).getAllByRole('listitem');

    it('asks for the models of the period once the tab opens', async () => {
      const { user } = await renderDashboard(withAiEndpoints);
      // Nor does the Public Cloud tab ask for them until it opens
      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();

      await openTab(user, 'Tendances');

      // The 3 months of the GPU trend, July to September
      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-07-01', '2026-09-30', allAccounts);
    });

    // What shows around the chart, which draws nothing in the tests (see setup.js)
    it('is headed by its title, and names each model in its legend', async () => {
      const { user } = await renderDashboard(withAiEndpoints);

      await openTab(user, 'Tendances');

      // The most expensive over the period first
      expect(texts(aiEndpointsTrend())).toEqual([
        'Évolution des coûts AI Endpoints par modèle',
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'whisper-large-v3', 'Mistral-7B-Instruct-v0.3',
        'stable-diffusion-xl-base-v10',
      ]);
      expect(legendOf(aiEndpointsTrend())).toHaveLength(6);
    });

    // Rather than a color by its rank, which the models of another period, month or account
    // would change
    it('gives each model its color whatever the account shown', async () => {
      const { user } = await renderDashboard(severalAccountsWithAiEndpoints);
      await openTab(user, 'Tendances');
      // The color of a model's swatch in the legend
      const colorOf = (model) =>
        swatchOf(within(aiEndpointsTrend()).getByText(model)).style.backgroundColor;
      const colors = ['gpt-oss-120b', 'bge-m3', 'Mistral-7B-Instruct-v0.3'].map(colorOf);

      await selectAccount(user, 'Lyon subsidiary');

      // Mistral-7B-Instruct-v0.3 comes 4th of Lyon's models rather than 5th
      expect(['gpt-oss-120b', 'bge-m3', 'Mistral-7B-Instruct-v0.3'].map(colorOf)).toEqual(colors);
    });

    // As the GPU trend: a single bar is no trend
    it('is left out when the models were billed in a single month of the period', async () => {
      const { user } = await renderDashboard({
        ...account,
        aiEndpoints: { '2026-07/2026-09': aiEndpoints['2026-09'] },
      });

      await openTab(user, 'Tendances');

      expect(screen.queryByRole('heading', { name: AI_ENDPOINTS_TREND })).not.toBeInTheDocument();
    });

    it('follows the period the user picks', async () => {
      const { user } = await renderDashboard({ ...withAiEndpoints, ...sinceJuly2025 });
      await openTab(user, 'Tendances');
      // The 6 months that this history offers by default (see fixtures/trends.js)
      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-04-01', '2026-09-30', allAccounts);

      await user.selectOptions(periodSelector(), '2 ans');
      await settle();

      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2024-10-01', '2026-09-30', allAccounts);
      expect(texts(aiEndpointsTrend())[0]).toBe('Évolution des coûts AI Endpoints par modèle');
    });

    it('follows the month selected in the header', async () => {
      const { user } = await renderDashboard(withAiEndpoints);
      await openTab(user, 'Tendances');

      await selectMonth(user, 'Août 2026');

      // June to August, when the models were billed in August alone: no trend to draw
      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-06-01', '2026-08-31', allAccounts);
      expect(screen.queryByRole('heading', { name: AI_ENDPOINTS_TREND })).not.toBeInTheDocument();
    });

    // See fixtures/accounts.js
    it('follows the account selected', async () => {
      const { user } = await renderDashboard(severalAccountsWithAiEndpoints);
      await openTab(user, 'Tendances');

      await selectAccount(user, 'Lyon subsidiary');

      expect(api.fetchAiEndpoints)
        .toHaveBeenCalledWith('2026-07-01', '2026-09-30', lyonAccount.id);
      expect(texts(aiEndpointsTrend())).toEqual([
        'Évolution des coûts AI Endpoints par modèle',
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'Mistral-7B-Instruct-v0.3',
      ]);

      // Whose models were billed in September alone
      await selectAccount(user, 'yy2222-ovh');

      expect(screen.queryByRole('heading', { name: AI_ENDPOINTS_TREND })).not.toBeInTheDocument();
    });

    it('speaks English when the page does', async () => {
      const { user } = await renderDashboard(withAiEndpoints);
      await selectLanguage(user, 'en');

      await openTab(user, 'Trends');

      expect(texts(aiEndpointsTrend())).toEqual([
        'AI Endpoints cost evolution by model',
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'whisper-large-v3', 'Mistral-7B-Instruct-v0.3',
        'stable-diffusion-xl-base-v10',
      ]);
    });
  });

  // The trend routes then answer no months, rather than months at 0 € (#65)
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

  // The account selected in the header (#115): the tab shows its trends, or those of all
  // accounts, over the periods that its months offer (#120)
  describe('account selected', () => {
    // What the tab shows, as the user reads it: its figures, the resource types of the trend
    // by resource type, and the GPU trend, null when it is left out
    const trendsShown = () => ({
      heading: screen.getByRole('heading', { name: /^Évolution des coûts \(total\)/ })
        .textContent,
      growth: texts(cardOf('Croissance sur la période')),
      costliestMonth: texts(cardOf('Mois le plus coûteux')),
      projection: texts(cardOf('Projection annuelle')),
      resourceTypes: texts(cardOf('Évolution par catégorie')),
      gpu: screen.queryByText('Évolution des coûts GPU')
        && texts(cardOf('Évolution des coûts GPU')),
    });
    const growth = (value) => ['Croissance sur la période', value, 'Sur 3 mois'];
    const costliestMonth = (month, cost) => ['Mois le plus coûteux', month, cost];
    const projection = (value) => ['Projection annuelle', value, 'Basé sur le dernier mois'];
    const resourceTypes = (...labels) => ['Évolution par catégorie', ...labels];
    const threeMonths = 'Évolution des coûts (total) sur 3 mois';

    // July to September, as for the account of the other tests
    const allAccountsTrends = {
      heading: threeMonths,
      growth: growth('+27,6 %'),
      costliestMonth: costliestMonth('sept. 2026', '1 250,40€'),
      projection: projection('~15 004,80€'),
      resourceTypes: resourceTypes(
        'Public Cloud', 'Dedicated Servers', 'Backup', 'Domains', 'Licenses',
      ),
      gpu: ['Évolution des coûts GPU', 'Total: 730,50€'],
    };

    it('show the trends of all accounts by default', async () => {
      const { user } = await renderDashboard(severalAccounts);

      await openTab(user, 'Tendances');

      expect(trendsShown()).toEqual(allAccountsTrends);
    });

    it('show the trends of the account selected, and of all accounts again', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Tendances');

      await selectAccount(user, 'Lyon subsidiary');

      // July to September, billed to Lyon: (890.40 - 680) / 680
      expect(trendsShown()).toEqual({
        heading: threeMonths,
        growth: growth('+30,9 %'),
        costliestMonth: costliestMonth('sept. 2026', '890,40€'),
        projection: projection('~10 684,80€'),
        resourceTypes: resourceTypes('Public Cloud', 'Dedicated Servers', 'Domains', 'Licenses'),
        // Its Production project has all the GPU costs
        gpu: ['Évolution des coûts GPU', 'Total: 730,50€'],
      });

      await selectAccount(user, 'Tous les comptes');

      expect(trendsShown()).toEqual(allAccountsTrends);
    });

    // None of them was billed for GPUs, nor in the first month of its period: no GPU trend,
    // and no growth to compute (#65)
    it.each([
      ['an account billed since August', 'yy2222-ovh', {
        heading: threeMonths,
        growth: growth('—'),
        costliestMonth: costliestMonth('sept. 2026', '360,00€'),
        projection: projection('~4 320,00€'),
        resourceTypes: resourceTypes('Public Cloud', 'Backup', 'Domains', 'Licenses'),
        gpu: null,
      }],
      // Up to August, its latest month, which the header selects
      ['an account no longer configured', 'zz3333-ovh (non configuré)', {
        heading: threeMonths,
        growth: growth('—'),
        costliestMonth: costliestMonth('août 2026', '200,00€'),
        projection: projection('~2 400,00€'),
        resourceTypes: resourceTypes('Dedicated Servers'),
        gpu: null,
      }],
      // Up to July, its only month
      ['the Unknown account', 'Compte inconnu', {
        heading: threeMonths,
        growth: growth('—'),
        costliestMonth: costliestMonth('juil. 2026', '120,00€'),
        projection: projection('~1 440,00€'),
        resourceTypes: resourceTypes('Dedicated Servers', 'Domains'),
        gpu: null,
      }],
    ])('show the trends of %s', async (_, label, trends) => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Tendances');

      await selectAccount(user, label);

      expect(trendsShown()).toEqual(trends);
    });

    // The periods offered go up to the first one that covers the months of the account
    // selected: the trends shown cover the same months
    it('cover the months of the periods offered, those of the account selected', async () => {
      // All accounts, billed since July 2025, offer up to 2 years
      const { user } = await renderDashboard({ ...severalAccounts, ...sinceJuly2025 });
      await openTab(user, 'Tendances');
      expect(periodSelector()).toHaveDisplayValue('6 mois');

      await selectAccount(user, 'Lyon subsidiary');

      // Three months billed to Lyon: 3 months, and its trends over them
      expect(optionsOf(periodSelector())).toEqual(['3 mois']);
      expect(trendsShown()).toMatchObject({
        heading: threeMonths,
        growth: growth('+30,9 %'),
        costliestMonth: costliestMonth('sept. 2026', '890,40€'),
      });

      await selectAccount(user, 'Tous les comptes');

      // The 6 months of the default again
      expect(optionsOf(periodSelector())).toEqual(['3 mois', '6 mois', '1 an', '2 ans']);
      expect(periodSelector()).toHaveDisplayValue('6 mois');
      expect(trendsShown().heading).toBe('Évolution des coûts (total) sur 6 mois');
    });

    it('ask for the trends of the account selected', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Tendances');

      await selectAccount(user, 'Lyon subsidiary');

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', lyonAccount.id);
      expect(api.fetchMonthlyTrendByCategory)
        .toHaveBeenCalledWith(3, '2026-09', lyonAccount.id);
      expect(api.fetchGpuSummary)
        .toHaveBeenCalledWith('2026-07-01', '2026-09-30', lyonAccount.id);
    });

    // The month selected stays until the months list of the account loads, and says it lacks
    // it: the header then selects the account's latest month, August (#115)
    it('ask for no trend up to a month that the account selected lacks', async () => {
      const { user } = await renderDashboard(severalAccounts);
      await openTab(user, 'Tendances');

      await selectAccount(user, 'zz3333-ovh (non configuré)');

      expect(api.fetchMonthlyTrend).not.toHaveBeenCalledWith(3, '2026-09', removedAccount.id);
      expect(api.fetchMonthlyTrendByCategory)
        .not.toHaveBeenCalledWith(3, '2026-09', removedAccount.id);
      expect(api.fetchGpuSummary)
        .not.toHaveBeenCalledWith('2026-07-01', '2026-09-30', removedAccount.id);
      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-08', removedAccount.id);
    });
  });

  // The month in progress (#216), which the page may project (#217): see fixtures/trends.js,
  // where September has not billed the dedicated servers yet
  describe('month in progress', () => {
    const billedLate = { ...account, ...septemberInProgress, ...septemberBilledLate };

    // Next to the period selector; the Compare tab offers it too, next to its months (#218)
    it('offers to project it on the Trends tab, off by default', async () => {
      const { user } = await renderDashboard();
      expect(projectionCheckbox()).not.toBeInTheDocument();

      await openTab(user, 'Tendances');

      expect(projectionCheckbox()).toHaveAccessibleName('Projeter le mois en cours');
      expect(projectionCheckbox()).not.toBeChecked();

      await selectLanguage(user, 'en');

      expect(projectionCheckbox()).toHaveAccessibleName('Project the month in progress');
    });

    it('asks for the trends projected once ticked, over a period that covers it only',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Tendances');

        await toggleProjection(user);

        expect(api.fetchMonthlyTrend)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });
        expect(api.fetchMonthlyTrendByCategory)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });

        // June to August, complete months
        await selectMonth(user, 'Août 2026');

        expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(3, '2026-08', allAccounts);
        expect(api.fetchMonthlyTrendByCategory).toHaveBeenLastCalledWith(3, '2026-08', allAccounts);
      });

    // The trends load when the page opens, whatever the tab
    it('asks for the trends projected from the start when ticked on an earlier visit',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Tendances');
        await toggleProjection(user);
        api.fetchMonthlyTrend.mockClear();

        await reopenDashboard(billedLate);

        expect(api.fetchMonthlyTrend).toHaveBeenCalledOnce();
        expect(api.fetchMonthlyTrend)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });
      });

    // Rather than compare September, partial, with a complete month, or project a year from it
    // Visibly, as a tooltip shows on no touch screen, and in the tooltip, why
    it('says that the month is in progress in the growth and the annual projection', async () => {
      const { user } = await renderDashboard(billedLate);

      await openTab(user, 'Tendances');

      expect(texts(cardOf('Croissance sur la période')))
        .toEqual(['Croissance sur la période', '—', 'mois en cours', 'Sur 3 mois']);
      expect(within(cardOf('Croissance sur la période'))
        .getByTitle('non calculable : mois en cours')).toHaveTextContent('—');
      expect(texts(cardOf('Projection annuelle')))
        .toEqual(['Projection annuelle', '—', 'mois en cours', 'Basé sur le dernier mois']);
      expect(within(cardOf('Projection annuelle'))
        .getByTitle('non calculable : dernier mois en cours')).toHaveTextContent('—');
      // September as billed so far, without its dedicated servers
      expect(texts(cardOf('Mois le plus coûteux')))
        .toEqual(['Mois le plus coûteux', 'août 2026', '1 042,00€']);

      await selectLanguage(user, 'en');

      expect(texts(cardOf('Growth over period')))
        .toEqual(['Growth over period', '—', 'month in progress', 'Over 3 months']);
      expect(within(cardOf('Growth over period'))
        .getByTitle('cannot be computed: month in progress')).toHaveTextContent('—');
      expect(texts(cardOf('Annual projection')))
        .toEqual(['Annual projection', '—', 'month in progress', 'Based on last month']);
      expect(within(cardOf('Annual projection'))
        .getByTitle('cannot be computed: last month in progress')).toHaveTextContent('—');
    });

    it('computes the growth and the annual projection on the projected cost once ticked',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Tendances');

        await toggleProjection(user);

        // (1 250.40 - 980) / 980, and 12 times September's projected cost
        expect(texts(cardOf('Croissance sur la période')))
          .toEqual(['Croissance sur la période', '+27,6 %', 'Sur 3 mois']);
        expect(texts(cardOf('Projection annuelle')))
          .toEqual(['Projection annuelle', '~15 004,80€', 'Basé sur le dernier mois']);

        await selectLanguage(user, 'en');

        expect(texts(cardOf('Growth over period')))
          .toEqual(['Growth over period', '+27.6%', 'Over 3 months']);
        expect(texts(cardOf('Annual projection')))
          .toEqual(['Annual projection', '~15,004.80€', 'Based on last month']);
      });

    // Its cost is partly projected: in italics, and marked so, as the Compare tab marks such
    // amounts, with what September billed so far and its projected cost in a tooltip
    it('marks the most expensive month projected when it is the month in progress, once ticked',
      async () => {
        const { user } = await renderDashboard(billedLate);
        await openTab(user, 'Tendances');

        await toggleProjection(user);

        const card = cardOf('Mois le plus coûteux');
        expect(texts(card))
          .toEqual(['Mois le plus coûteux', 'sept. 2026', '1 250,40€', 'projeté']);
        expect(inItalics(within(card).getByText('1 250,40€'))).toBe(true);
        expect(within(card).getByTitle('facturé 980,40€, projeté 1 250,40€'))
          .toHaveTextContent('1 250,40€ projeté');

        await selectLanguage(user, 'en');

        const englishCard = cardOf('Most expensive month');
        expect(texts(englishCard))
          .toEqual(['Most expensive month', 'Sep 2026', '1,250.40€', 'projected']);
        expect(within(englishCard).getByTitle('billed 980.40€, projected 1,250.40€'))
          .toHaveTextContent('1,250.40€ projected');
      });

    // June to August, complete: June, not billed, at 0 € leaves no growth to compute (#65)
    it('computes the cards as before over a period that ends before it', async () => {
      const { user } = await renderDashboard(billedLate);
      await openTab(user, 'Tendances');
      await toggleProjection(user);

      await selectMonth(user, 'Août 2026');

      expect(within(cardOf('Croissance sur la période'))
        .getByTitle('non calculable : premier mois à 0 € ou moins')).toHaveTextContent('—');
      expect(texts(cardOf('Projection annuelle')))
        .toEqual(['Projection annuelle', '~12 504,00€', 'Basé sur le dernier mois']);
    });

    // As the months list of the account shown marks it (#216): see fixtures/accounts.js
    it('asks for the trends projected of the account shown while its month is in progress',
      async () => {
        const { user } = await renderDashboard(lyonBilledLate);
        await openTab(user, 'Tendances');
        await toggleProjection(user);

        expect(api.fetchMonthlyTrend)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });

        await selectAccount(user, 'Lyon subsidiary');

        expect(api.fetchMonthlyTrend)
          .toHaveBeenCalledWith(3, '2026-09', lyonAccount.id, { projected: true });
        expect(api.fetchMonthlyTrendByCategory)
          .toHaveBeenCalledWith(3, '2026-09', lyonAccount.id, { projected: true });

        // Whose bills of September came in
        await selectAccount(user, 'yy2222-ovh');

        expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(3, '2026-09', unnamedAccount.id);
        expect(api.fetchMonthlyTrendByCategory)
          .toHaveBeenLastCalledWith(3, '2026-09', unnamedAccount.id);
      });

    it('shows the cards of the account selected, projected while its month is in progress',
      async () => {
        const { user } = await renderDashboard(lyonBilledLate);
        await openTab(user, 'Tendances');
        const cards = () => [
          texts(cardOf('Croissance sur la période'))[1], texts(cardOf('Projection annuelle'))[1],
        ];
        expect(cards()).toEqual(['—', '—']);

        await toggleProjection(user);

        // Lyon's dedicated servers at their cost of August, 70 €: (1 050.40 - 980) / 980
        expect(cards()).toEqual(['+7,2 %', '~12 604,80€']);

        await selectAccount(user, 'Lyon subsidiary');

        // (690.40 - 680) / 680
        expect(cards()).toEqual(['+1,5 %', '~8 284,80€']);

        // Whose bills of September came in: July, before its first bill, at 0 € (#65)
        await selectAccount(user, 'yy2222-ovh');

        expect(cards()).toEqual(['—', '~4 320,00€']);
        expect(within(cardOf('Croissance sur la période'))
          .getByTitle('non calculable : premier mois à 0 € ou moins')).toHaveTextContent('—');
      });

    it('asks for the trends as before while no month is in progress', async () => {
      const { user } = await renderDashboard();
      await openTab(user, 'Tendances');

      await toggleProjection(user);

      expect(api.fetchMonthlyTrend)
        .not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
          projected: true,
        });
    });
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
