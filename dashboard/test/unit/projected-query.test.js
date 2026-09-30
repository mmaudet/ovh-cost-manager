import { describe, it, expect, vi } from 'vitest';
import { projectedQuery } from '../../src/utils/accounts.js';
import { lyonAccount } from '../fixtures/accounts.js';

// The query of an answer that may count the month in progress at its projected cost (#217): as
// accountQuery() asks for it, and while it projects, with a key and a request that name the flag.
// The hooks run the options it gives: the Trends tab's trends, and the Compare tab's figures of
// the month in progress (#218). Their tests pin the keys that the page shares
// (shell-queries.test.jsx).

// The trend over 3 months up to September, as the Trends tab asks for it: its request gives what
// it was called with
const trendUpToSeptember = (projected) => ({
  key: ['monthlyTrend', 3, '2026-09'],
  fetch: vi.fn((account, ...options) => Promise.resolve([account, ...options])),
  projected,
});

describe('projectedQuery', () => {
  it('names the flag in its key and in its request while it projects', async () => {
    const query = projectedQuery(null, trendUpToSeptember(true));

    expect(query.queryKey).toEqual(['monthlyTrend', 3, '2026-09', 'projected']);
    await expect(query.queryFn()).resolves.toEqual([null, { projected: true }]);
  });

  // The account last, as accountQuery() names it (ADR 0001)
  it('names the flag before the account shown', async () => {
    const query = projectedQuery(lyonAccount.id, trendUpToSeptember(true));

    expect(query.queryKey).toEqual(['monthlyTrend', 3, '2026-09', 'projected', lyonAccount.id]);
    await expect(query.queryFn()).resolves.toEqual([lyonAccount.id, { projected: true }]);
  });

  // So that a single-account installation keeps its keys and requests while the setting is off
  it('names no flag while it does not project, as accountQuery()', async () => {
    const trend = trendUpToSeptember(false);

    const query = projectedQuery(null, trend);

    expect(query.queryKey).toEqual(['monthlyTrend', 3, '2026-09']);
    await query.queryFn();
    expect(trend.fetch).toHaveBeenCalledWith(null);
  });

  it('waits as accountQuery() does', () => {
    expect(projectedQuery(null, trendUpToSeptember(true)).enabled).toBe(true);
    expect(projectedQuery(null, { ...trendUpToSeptember(true), enabled: false }).enabled)
      .toBe(false);
    // While the page does not know the account shown yet
    expect(projectedQuery(undefined, trendUpToSeptember(true)).enabled).toBe(false);
  });
});
