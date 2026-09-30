/**
 * The current month's consumption and its month-end forecast, as the consumption routes answer
 * them (server/consumption.js). Whenever an account's Public Cloud projects consumed in the
 * month, they tell both, as OVH's Public Cloud page does (#224): the forecast is the sum of the
 * forecasts that OVH gives them, or, when it gives none, their consumption extrapolated, what
 * OVH gives for the whole month counted once (#145). Otherwise, the account's /me/consumption
 * snapshot tells them, as before.
 */

const { consumptionForecast, currentConsumption } = require('../server/consumption');

// When the routes answer: the 15th of September
const NOW = new Date('2026-09-15T12:00:00Z');

// What an account's projects tell of September, from the 1st to the 15th, as
// getConsumptionSummary() gives it: they consumed `total`, of which `monthly` for the whole
// month, and OVH forecasts them `forecast` by the end of the month, null when it forecasts
// none of them
const cloudOf = ({ total, monthly = 0, forecast = null, projects = 1 }) => ({
  period_start: '2026-09-01', period_end: '2026-09-15', total, monthly_total: monthly,
  project_count: projects, forecast_total: forecast,
});

// What the projects of an account that consumed nothing in the month tell
const NO_CLOUD = {
  period_start: null, period_end: null, total: null, monthly_total: null, project_count: 0,
  forecast_total: null,
};

// What OVH details of a snapshot's consumption
const DETAILS = { current: [{ price: { value: 87.5 } }], forecast: [{ price: { value: 192.25 } }] };

// The latest snapshot of an account's /me/consumption, taken on the 14th: what it tells of the
// month so far, and its forecast
const snapshotOf = ({ current, forecast }) => ({
  id: 1, snapshot_date: '2026-09-14 04:02:00', period_start: '2026-09-01',
  period_end: '2026-09-14', current_total: current, forecast_total: forecast, currency: 'EUR',
  raw_data: JSON.stringify(DETAILS), account: 'xx1111-ovh',
});

// What the consumption routes answer when every account is asked for: each account's
// snapshot, if any, and what its projects tell
const answersFor = (...accounts) => {
  const asked = { asked: accounts, every: accounts };
  return { current: currentConsumption(asked, NOW), forecast: consumptionForecast(asked, NOW) };
};

// The forecast that the forecast route answers for one account
const forecastOf = (account) => answersFor(account).forecast;

// A /me/consumption snapshot that stays on one transaction for days, whatever the projects
// consume since (#224)
const STUCK = snapshotOf({ current: 7.5, forecast: 7.5 });

describe('the forecast of the projects\' consumption, when OVH forecasts none of them', () => {
  test('extrapolates what is used by the hour over the days of the month', () => {
    expect(forecastOf({ cloud: cloudOf({ total: 12.25 }) }))
      .toMatchObject({ forecast_total: 26.25, current_total: 12.25, progress: 47 });
  });

  test('counts once what OVH gives for the whole month, such as a monthly plan', () => {
    expect(forecastOf({ cloud: cloudOf({ total: 32.25, monthly: 20 }) }))
      .toMatchObject({ forecast_total: 46.25, current_total: 32.25, progress: 70 });
  });
});

describe('an account whose snapshot tells a consumption, and whose projects consumed too',
  () => {
    test('has the consumption of its projects', () => {
      expect(answersFor({ snapshot: STUCK, cloud: cloudOf({ total: 12.25, forecast: 30 }) })
        .current).toEqual({
        snapshot_date: '2026-09-14 04:02:00',
        period_start: '2026-09-01',
        period_end: '2026-09-15',
        current_total: 12.25,
        source: 'cloud_projects',
        project_count: 1,
        currency: 'EUR',
      });
    });

    test('has the sum of the forecasts that OVH gives its projects', () => {
      expect(forecastOf({ snapshot: STUCK, cloud: cloudOf({ total: 12.25, forecast: 30 }) }))
        .toEqual({
          snapshot_date: '2026-09-14 04:02:00',
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          forecast_total: 30,
          current_total: 12.25,
          currency: 'EUR',
          progress: 41,
          source: 'cloud_projects',
        });
    });

    // 12.25 € over 14 days, for the 30 days of September
    test('has its projects\' consumption extrapolated when OVH forecasts none of them', () => {
      expect(forecastOf({ snapshot: STUCK, cloud: cloudOf({ total: 12.25 }) })).toEqual({
        snapshot_date: NOW.toISOString(),
        period_start: '2026-09-01',
        period_end: '2026-09-15',
        forecast_total: 26.25,
        current_total: 12.25,
        currency: 'EUR',
        progress: 47,
        source: 'cloud_projects',
        days_elapsed: 14,
        days_in_month: 30,
      });
    });
  });

describe('an account whose projects consumed nothing in the month', () => {
  test('has the figures of its snapshot, as before', () => {
    const snapshot = snapshotOf({ current: 87.5, forecast: 192.25 });

    expect(answersFor({ snapshot, cloud: NO_CLOUD })).toEqual({
      current: {
        snapshot_date: '2026-09-14 04:02:00',
        period_start: '2026-09-01',
        period_end: '2026-09-14',
        current_total: 87.5,
        currency: 'EUR',
        source: 'me_consumption',
        details: DETAILS,
      },
      forecast: {
        snapshot_date: '2026-09-14 04:02:00',
        period_start: '2026-09-01',
        period_end: '2026-09-14',
        forecast_total: 192.25,
        current_total: 87.5,
        currency: 'EUR',
        progress: 46,
      },
    });
  });
});

describe('the accounts added up', () => {
  test('add up the forecasts that OVH gives their projects', () => {
    const answers = answersFor(
      { cloud: cloudOf({ total: 12.25, forecast: 30 }) },
      { cloud: cloudOf({ total: 20, forecast: 45.5, projects: 2 }) },
    );

    expect(answers.forecast).toEqual({
      snapshot_date: NOW.toISOString(),
      period_start: '2026-09-01',
      period_end: '2026-09-15',
      forecast_total: 75.5,
      current_total: 32.25,
      currency: 'EUR',
      progress: 43,
      source: 'cloud_projects',
    });
    expect(answers.current).toMatchObject({
      current_total: 32.25, source: 'cloud_projects', project_count: 3,
    });
  });

  // The days of an extrapolation would tell nothing of OVH's forecast
  test('give no days when OVH forecasts the projects of one of them', () => {
    // 7 € over 14 days extrapolate to 15 €
    expect(answersFor(
      { cloud: cloudOf({ total: 12.25, forecast: 30 }) },
      { cloud: cloudOf({ total: 7 }) },
    ).forecast).toEqual({
      snapshot_date: NOW.toISOString(),
      period_start: '2026-09-01',
      period_end: '2026-09-15',
      forecast_total: 45,
      current_total: 19.25,
      currency: 'EUR',
      progress: 43,
      source: 'cloud_projects',
    });
  });
});
