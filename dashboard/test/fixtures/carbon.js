// The carbon footprint of the synthetic account per month (#147), as /api/carbon/footprint
// answers: location-based, by emission source and in total, with the market-based total
// (#152), in kg CO2eq, and the latest month that has one. OVHcloud never gives the current
// month's, September's: August is the latest.
export const carbon = {
  carbonFootprint: {
    '2026-09': { month: '2026-09', footprint: null, latestMonth: '2026-08' },
    '2026-08': {
      month: '2026-08',
      footprint: {
        manufacturing: 1234.5, electricity: 2345.25, operations: 456.75, total: 4036.5,
        marketBasedTotal: 3012.25,
      },
      latestMonth: '2026-08',
    },
    '2026-07': {
      month: '2026-07',
      footprint: {
        manufacturing: 1200, electricity: 2300, operations: 450, total: 3950,
        marketBasedTotal: 2900,
      },
      latestMonth: '2026-08',
    },
  },
};
