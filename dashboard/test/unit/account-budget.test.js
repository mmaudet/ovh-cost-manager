import { describe, it, expect } from 'vitest';
import { budgetOf } from '../../src/utils/accounts.js';
import {
  lyonAccount, removedAccount, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';

// The budget that the page compares the figures it shows with (#117): the dashboard budget
// for all accounts, which the user may change on the page, whatever the accounts' own, or
// else the budget of the account shown, as the configuration route gives those of the
// accounts that have one, by id. None for an account without one.

// The budgets of the accounts' own: the Lyon subsidiary's, and that of an account no longer
// configured, which keeps the one its last import recorded
const accountBudgets = { [lyonAccount.id]: 1000, [removedAccount.id]: 400 };

describe('budgetOf', () => {
  it('is the dashboard budget for all accounts, whatever the budgets of the accounts', () => {
    expect(budgetOf(null, 50000, accountBudgets)).toBe(50000);
    // As the user changed it for the visit
    expect(budgetOf(null, 800, accountBudgets)).toBe(800);
    // And while the configuration loads, as the page's default
    expect(budgetOf(null, 50000, undefined)).toBe(50000);
  });

  it('is the budget of the account shown, whatever the dashboard budget', () => {
    expect(budgetOf(lyonAccount.id, 50000, accountBudgets)).toBe(1000);
    expect(budgetOf(lyonAccount.id, 800, accountBudgets)).toBe(1000);
    expect(budgetOf(removedAccount.id, 50000, accountBudgets)).toBe(400);
  });

  it.each([
    ['an account without a budget of its own', unnamedAccount.id, accountBudgets],
    ['the Unknown account, which config.json does not configure', unknownAccount.id,
      accountBudgets],
    ['an account while the configuration loads', lyonAccount.id, undefined],
  ])('is none for %s', (_, account, budgets) => {
    expect(budgetOf(account, 50000, budgets)).toBeNull();
  });
});
