import { describe, it, expect } from 'vitest';
import { accountsOf, budgetOf } from '../../src/utils/accounts.js';
import {
  lyonAccount, removedAccount, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';

// The budget that the page compares the figures it shows with (#117), and whether the user
// may change it: the dashboard budget for all accounts, which the user may change on the
// page, whatever the accounts' own, or else the budget of the account shown, which config.json
// sets, as the accounts route gives it with the account. None for an account without one.

// The accounts of the instance, as the page reads them from the accounts route: the Lyon
// subsidiary with a budget of its own, and an account no longer configured, which keeps the
// one that its last import recorded
const accounts = accountsOf([
  lyonAccount, unnamedAccount, { ...removedAccount, budget: 400 }, unknownAccount,
]);

describe('budgetOf', () => {
  it('is the dashboard budget for all accounts, whatever the budgets of the accounts', () => {
    expect(budgetOf(accounts, null, 50000)).toEqual({ amount: 50000, editable: true });
    // As the user changed it for the visit
    expect(budgetOf(accounts, null, 800)).toEqual({ amount: 800, editable: true });
    // And while the accounts load
    expect(budgetOf(undefined, null, 50000)).toEqual({ amount: 50000, editable: true });
  });

  it('is the budget of the account shown, whatever the dashboard budget, read-only', () => {
    expect(budgetOf(accounts, lyonAccount.id, 50000)).toEqual({ amount: 1000, editable: false });
    expect(budgetOf(accounts, lyonAccount.id, 800)).toEqual({ amount: 1000, editable: false });
    expect(budgetOf(accounts, removedAccount.id, 50000))
      .toEqual({ amount: 400, editable: false });
  });

  it.each([
    ['an account without a budget of its own', unnamedAccount.id],
    ['the Unknown account, which config.json does not configure', unknownAccount.id],
  ])('is none for %s', (_, account) => {
    expect(budgetOf(accounts, account, 50000)).toBeNull();
  });

  // Before #117, the route gave no budget
  it('is none for an account that the route lists without a budget', () => {
    const { budget, ...withoutBudget } = lyonAccount;

    expect(budget).toBe(1000);
    expect(budgetOf(accountsOf([withoutBudget, unnamedAccount]), lyonAccount.id, 50000))
      .toBeNull();
  });
});
