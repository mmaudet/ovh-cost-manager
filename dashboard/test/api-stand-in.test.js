import { describe, it, expect, vi } from 'vitest';
import { severalAccounts } from './fixtures/accounts.js';
import { api, serve } from './support/api.js';

// setup.js replaces src/services/api.js with support/api.js in every test file
describe('API stand-in', () => {
  it('replaces every function of the API service module', async () => {
    const apiModule = await vi.importActual('../src/services/api.js');
    const functions = Object.keys(apiModule).filter((name) => name !== 'default');

    expect(Object.keys(api).sort()).toEqual(functions.sort());
  });

  // As the server does (server/account-parameter.js), and as axios rejects its answer: a page
  // that asks for an account it should not gets no answer, rather than an empty one (#115)
  it('refuses an account that the accounts route does not list', async () => {
    serve(severalAccounts);
    const refusal = {
      response: {
        status: 400,
        data: {
          error: "Invalid 'account' parameter: expected the NIC handle of an account, or unknown",
        },
      },
    };

    await expect(api.fetchMonths('ww4444-ovh')).rejects.toMatchObject(refusal);
    await expect(api.fetchSummary('2026-09-01', '2026-09-30', 'ww4444-ovh'))
      .rejects.toMatchObject(refusal);
  });

  it('answers for all accounts, an account listed, and the Unknown account', async () => {
    // A single account listed: the server accepts the Unknown account whether the accounts
    // route lists it or not
    serve({ ...severalAccounts, accounts: severalAccounts.accounts.slice(0, 1) });

    await expect(api.fetchMonths(null)).resolves.toEqual(severalAccounts.months);
    await expect(api.fetchMonths('xx1111-ovh'))
      .resolves.toEqual(severalAccounts.ofAccount['xx1111-ovh'].months);
    await expect(api.fetchMonths('unknown'))
      .resolves.toEqual(severalAccounts.ofAccount.unknown.months);
  });
});
