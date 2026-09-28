// The carbon footprint of the synthetic account per month (#147), as /api/carbon/footprint
// answers: location-based, by emission source and in total, in kg CO2eq. OVHcloud never gives
// the current month's, September's.
export const carbon = {
  carbonFootprint: {
    '2026-08': {
      month: '2026-08',
      footprint: { manufacturing: 1234.5, electricity: 2345.25, operations: 456.75, total: 4036.5 },
    },
    '2026-07': {
      month: '2026-07',
      footprint: { manufacturing: 1200, electricity: 2300, operations: 450, total: 3950 },
    },
  },
};
