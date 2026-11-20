import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { api } from './support/api.js';
import {
  cardOf, dropdown, openTab, optionsOf, renderDashboard, texts,
} from './support/render.jsx';

// The trend of a Public Cloud project, which the Trends tab shows for the project selected next
// to its period: what the project cost each month, and by Public Cloud product, as
// /api/projects/:id/monthly-trend answers, in place of the trends of the whole account.

// The projects of the account, as the Public Cloud tab lists them
const [production] = account.projectsEnriched;
const projectName = production.name || production.id;

// A product of the trend, as the server keys and colours it, the page naming it
const product = (key, color) => ({ key, label: key, color });

// What Production cost from July to September, its instances and its buckets, a credit
// lowering September
const withProjectTrend = {
  ...account,
  projectTrend: {
    [production.id]: {
      '2026-09': {
        3: {
          monthlyTrend: [
            { yearMonth: '2026-07', cost: 300 },
            { yearMonth: '2026-08', cost: 400 },
            { yearMonth: '2026-09', cost: 480 },
          ],
          byProduct: {
            categories: [
              product('instances', '#3b82f6'), product('objectStorage', '#10b981'),
              product('credits', '#64748b'),
            ],
            data: [
              { yearMonth: '2026-07', instances: 250, objectStorage: 50, credits: 0 },
              { yearMonth: '2026-08', instances: 330, objectStorage: 70, credits: 0 },
              { yearMonth: '2026-09', instances: 420, objectStorage: 80, credits: -20 },
            ],
          },
        },
      },
    },
  },
};

// The project selector, which always offers all of them
const projectSelector = () => dropdown('Tous les projets');

describe('the trend of a Public Cloud project', () => {
  it('offers every project of the account, all of them by default', async () => {
    const { user } = await renderDashboard(withProjectTrend);

    await openTab(user, 'Tendances');

    expect(projectSelector()).toHaveDisplayValue('Tous les projets');
    const names = account.projectsEnriched.map((project) => project.name || project.id)
      .sort((a, b) => a.localeCompare(b));
    expect(optionsOf(projectSelector())).toEqual(['Tous les projets', ...names]);
    expect(api.fetchProjectMonthlyTrend).not.toHaveBeenCalled();
  });

  it('shows the trend of the project selected, by product, and its cards', async () => {
    const { user } = await renderDashboard(withProjectTrend);
    await openTab(user, 'Tendances');

    await user.selectOptions(projectSelector(), projectName);

    // Over the period of the tab, of every account's bills
    expect(api.fetchProjectMonthlyTrend).toHaveBeenCalledWith(production.id, 3, '2026-09', null);
    expect(await screen.findByRole('heading', {
      name: `Évolution des coûts (total) sur 3 mois · ${projectName}`,
    })).toBeInTheDocument();
    // Its products, named in the page's language, the credit it used included
    expect(texts(cardOf('Évolution par produit'))).toEqual([
      'Évolution par produit', 'Instances', 'Stockage objet', 'Crédit Public Cloud utilisé',
    ]);
    expect(texts(cardOf('Mois le plus coûteux')))
      .toEqual(['Mois le plus coûteux', 'sept. 2026', '480,00€']);
    expect(texts(cardOf('Croissance sur la période')))
      .toEqual(['Croissance sur la période', '+60,0 %', 'Sur 3 mois']);
    // The GPU trend is the account's
    expect(screen.queryByText('Évolution des coûts GPU')).not.toBeInTheDocument();
  });

  it('shows the trends of the whole account again with all projects', async () => {
    const { user } = await renderDashboard(withProjectTrend);
    await openTab(user, 'Tendances');
    await user.selectOptions(projectSelector(), projectName);

    await user.selectOptions(projectSelector(), 'Tous les projets');

    expect(await screen.findByRole('heading', { name: 'Évolution des coûts (total) sur 3 mois' }))
      .toBeInTheDocument();
    expect(texts(cardOf('Évolution par catégorie'))[0]).toBe('Évolution par catégorie');
  });

  it('says that a project not billed over the period has no data', async () => {
    const { user } = await renderDashboard(withProjectTrend);
    await openTab(user, 'Tendances');
    const [, other] = account.projectsEnriched;

    await user.selectOptions(projectSelector(), other.name || other.id);

    expect(await screen.findByRole('heading', {
      name: `Évolution des coûts (total) sur 3 mois · ${other.name || other.id}`,
    })).toBeInTheDocument();
    expect(texts(cardOf('Mois le plus coûteux'))).toEqual(['Mois le plus coûteux', 'N/A']);
  });
});
