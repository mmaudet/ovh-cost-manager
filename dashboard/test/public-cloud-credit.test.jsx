import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { account } from './fixtures/account.js';
import { severalAccounts, lyonAccount } from './fixtures/accounts.js';
import {
  cardOf, cardRowOf, cloudProjectsTable, openTab, renderDashboard, rowsOf, selectAccount, texts,
} from './support/render.jsx';

// The credit that remains on the Public Cloud projects: what their credits still available and
// still valid today add up to, as /api/consumption/credit answers, which a KPI card shows next to
// the current consumption and the month-end forecast, before the resource count. Today is
// 15 September 2026.

const CREDIT = 'Crédit Public Cloud restant';

// Two credits of the account's projects, the first of which ends on 31 December
const withCredit = {
  ...account,
  publicCloudCredit: {
    available_total: 1250.5, currency: 'EUR', credit_count: 2, project_count: 1,
    expires_at: '2026-12-31T23:59:59+01:00',
  },
};

// The labels of the KPI cards of the row that holds the credit card, in order
const kpiTitles = () => [...cardRowOf(CREDIT).children]
  .map((card) => texts(card)[0]);

describe('the Public Cloud credit card', () => {
  it('shows what remains of the credits, how many they are, and when the first one ends',
    async () => {
      await renderDashboard(withCredit);

      expect(texts(cardOf(CREDIT))).toEqual([
        CREDIT, '15 septembre 2026', '1 250,50€', 'Public Cloud · 2 crédits · jusqu\'au 31 déc. 2026',
      ]);
    });

  // The current consumption is 402,35 €, which the card of the consumption circles in green
  it('is circled in red while the credit is below the current consumption, and says why',
    async () => {
      await renderDashboard({
        ...withCredit,
        publicCloudCredit: { ...withCredit.publicCloudCredit, available_total: 300 },
      });

      expect(cardOf(CREDIT)).toHaveClass('border-red-500');
      expect(cardOf(CREDIT)).toHaveAttribute(
        'title', 'Le crédit restant est inférieur à la consommation en cours',
      );
    });

  it('is not circled in red while the credit covers the current consumption', async () => {
    await renderDashboard(withCredit);

    expect(cardOf(CREDIT)).not.toHaveClass('border-red-500');
    expect(cardOf(CREDIT)).not.toHaveAttribute('title');
  });

  it('shows after the forecast, the resource count after it', async () => {
    await renderDashboard(withCredit);

    expect(kpiTitles()).toEqual([
      'Consommation en cours', 'Prévision fin de mois', CREDIT, 'Total ressources',
    ]);
  });

  it('names a single credit, and no end for a credit without one', async () => {
    await renderDashboard({
      ...account,
      publicCloudCredit: {
        available_total: 80, currency: 'EUR', credit_count: 1, project_count: 1,
        expires_at: null,
      },
    });

    expect(texts(cardOf(CREDIT))).toEqual([
      CREDIT, '15 septembre 2026', '80,00€', 'Public Cloud · 1 crédit',
    ]);
  });

  // As before the card: the three cards of the row
  it('does not show while no credit counts', async () => {
    await renderDashboard();

    expect(screen.queryByText(CREDIT)).not.toBeInTheDocument();
    expect(texts(cardOf('Total ressources'))[0]).toBe('Total ressources');
  });

  it('follows the account selected', async () => {
    const { user } = await renderDashboard({
      ...severalAccounts,
      publicCloudCredit: { ...withCredit.publicCloudCredit, available_total: 1500 },
      ofAccount: {
        ...severalAccounts.ofAccount,
        [lyonAccount.id]: {
          ...severalAccounts.ofAccount[lyonAccount.id],
          publicCloudCredit: {
            available_total: 300, currency: 'EUR', credit_count: 1, project_count: 1,
            expires_at: null,
          },
        },
      },
    });
    expect(texts(cardOf(CREDIT))[2]).toBe('1 500,00€');

    await selectAccount(user, 'Lyon subsidiary');

    expect(texts(cardOf(CREDIT))[2]).toBe('300,00€');
  });
});

describe('the credit of each Public Cloud project', () => {
  // The first project of the list with a credit that remains, as /api/projects/enriched gives it
  const withProjectCredit = {
    ...withCredit,
    projectsEnriched: account.projectsEnriched.map((project, index) => (
      index === 0 ? { ...project, remaining_credit: 312.4 } : { ...project, remaining_credit: 0 }
    )),
  };

  // The place of the column whose header starts with a text, in the list of projects
  const columnOf = (start) => rowsOf(cloudProjectsTable())[0]
    .findIndex((cell) => cell.startsWith(start));

  it('shows in the list after the current consumption, before the amount of the month',
    async () => {
      const { user } = await renderDashboard(withProjectCredit);

      await openTab(user, 'Public Cloud');

      const credit = columnOf('Crédit restant');
      expect(credit).toBe(columnOf('Consommation en cours') + 1);
      expect(columnOf('Facturé en septembre 2026')).toBe(credit + 1);
      // The credit of the first project, none for the others
      expect(rowsOf(cloudProjectsTable()).slice(1, 4).map((row) => row[credit]))
        .toEqual(['312,40€', '-', '-']);
    });

  // The cells of the credit column of the list's projects, in the order shown
  const creditCells = () => {
    const credit = columnOf('Crédit restant');
    return [...cloudProjectsTable().tBodies[0].rows].slice(0, 3).map((row) => row.cells[credit]);
  };

  it('gives in red a credit below what its project consumed so far, in green another',
    async () => {
      const { user } = await renderDashboard({
        ...withCredit,
        projectsEnriched: account.projectsEnriched.map((project, index) => ({
          ...project,
          consumption_total: 100,
          // Below the project's consumption, then above it
          remaining_credit: [40, 250, 0][index],
        })),
      });

      await openTab(user, 'Public Cloud');

      const [below, above, none] = creditCells();
      expect(below).toHaveTextContent('40,00€');
      expect(below).toHaveClass('text-red-600');
      expect(below).toHaveAttribute(
        'title', 'Le crédit restant est inférieur à la consommation en cours',
      );
      expect(above).toHaveTextContent('250,00€');
      expect(above).toHaveClass('text-emerald-700');
      expect(above).not.toHaveAttribute('title');
      // No credit: nothing to compare
      expect(none).toHaveTextContent('-');
      expect(none).not.toHaveClass('text-red-600');
    });

  // As before the credits
  it('does not show while no project has a credit that remains', async () => {
    const { user } = await renderDashboard();

    await openTab(user, 'Public Cloud');

    expect(columnOf('Crédit restant')).toBe(-1);
  });
});
