// The carbon footprint of the synthetic account per month (#147), as /api/carbon/footprint
// answers: location-based, by emission source and in total, with the market-based total
// (#152), in kg CO2eq, and the latest month that has one, which each answer repeats, as the
// route gives it, and for all accounts, the configured accounts without one that month
// (#153), none here. OVHcloud never gives the current month's, September's: August is the
// latest. It gave none for July either, a month the account had nothing it covers.
export const carbon = {
  carbonFootprint: {
    '2026-09': {
      month: '2026-09', footprint: null, latestMonth: '2026-08', accountsWithoutFootprint: [],
    },
    '2026-08': {
      month: '2026-08',
      footprint: {
        manufacturing: 1234.5, electricity: 2345.25, operations: 456.75, total: 4036.5,
        marketBasedTotal: 3012.25,
      },
      latestMonth: '2026-08',
      accountsWithoutFootprint: [],
    },
    '2026-07': {
      month: '2026-07', footprint: null, latestMonth: '2026-08', accountsWithoutFootprint: [],
    },
  },
};
