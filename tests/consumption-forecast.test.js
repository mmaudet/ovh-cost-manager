/**
 * The month-end forecast that the projects' consumption tells, when OVH tells none: what OVH
 * gives for the whole month counts once, and the rest is extrapolated (#145).
 */

const { consumptionForecast } = require('../server/consumption');

// An account whose projects consumed `total` from the 1st to the 15th of September, of which
// `monthly` for the whole month, and of which OVH tells nothing
const accountOf = (total, monthly) => ({
  snapshot: undefined,
  cloud: {
    period_start: '2026-09-01', period_end: '2026-09-15', total, monthly_total: monthly,
    project_count: 1,
  },
});
const forecastOf = (account) => consumptionForecast(
  { asked: [account], every: [account] }, new Date('2026-09-15T12:00:00Z'),
);

describe('the forecast of the projects\' consumption', () => {
  test('extrapolates what is used by the hour over the days of the month', () => {
    expect(forecastOf(accountOf(12.25, 0)))
      .toMatchObject({ forecast_total: 26.25, current_total: 12.25, progress: 47 });
  });

  test('counts once what OVH gives for the whole month, such as a monthly plan', () => {
    expect(forecastOf(accountOf(32.25, 20)))
      .toMatchObject({ forecast_total: 46.25, current_total: 32.25, progress: 70 });
  });
});
