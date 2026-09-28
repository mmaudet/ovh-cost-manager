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
  // The 12 months that end on August (#154), by the month they end on: nothing before
  // December, and nothing in July either
  carbonTrend: {
    '2026-08': [
      ['2025-09', null], ['2025-10', null], ['2025-11', null],
      ['2025-12', [1100, 2100, 400]],
      ['2026-01', [1150, 2200, 420]],
      ['2026-02', [1150, 2150, 410]],
      ['2026-03', [1175, 2250, 430]],
      ['2026-04', [1200, 2300, 440]],
      ['2026-05', [1200, 2275, 435]],
      ['2026-06', [1225, 2325, 450]],
      ['2026-07', null],
      ['2026-08', [1234.5, 2345.25, 456.75]],
    ].map(([month, sources]) => ({
      month,
      footprint: sources && {
        manufacturing: sources[0], electricity: sources[1], operations: sources[2],
        total: sources[0] + sources[1] + sources[2],
      },
    })),
  },
};
