/**
 * The current month's consumption and its month-end forecast, which the consumption routes
 * answer (#116). An account's come from its latest consumption snapshot, which its import
 * records from what OVH tells of the month, or, when OVH tells no consumption, from what its
 * Public Cloud projects consumed in the month of its current consumption. Those of all
 * accounts add up the accounts', as they bill in one currency: each account's figure, as it
 * shows alone, in the current month. data/db.js's consumption.getCurrentByAccount() gives
 * what tells them.
 */

// A day, in milliseconds
const DAY = 1000 * 60 * 60 * 24;

// An amount to the cent, as the routes give them
const toCents = (amount) => Math.round(amount * 100) / 100;

const sumOf = (values) => values.reduce((sum, value) => sum + value, 0);

// The earliest and the latest of days or months, written YYYY-MM-DD or YYYY-MM, which compare
// as text: null when there is none
const earliestOf = (dates) => dates.filter(Boolean).sort()[0] ?? null;
const latestOf = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

// The instant of a time, as SQLite writes it, in UTC without a zone, or as toISOString()
// writes it: the time of a snapshot, or that of a figure computed as the route answers
const instantOf = (time) => Date.parse(time.includes('T') ? time : `${time.replace(' ', 'T')}Z`);

// The latest of those times, as it is written; null when there is none
function latestTimeOf(times) {
  const written = times.filter(Boolean);
  if (written.length === 0) return null;
  return written.reduce((latest, time) => (instantOf(time) > instantOf(latest) ? time : latest));
}

// The days that a consumption covers, from its period, at least one, and the days of its
// month, in the server's time zone: what the forecast extrapolates it over
function daysOf(periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  return {
    daysElapsed: Math.max(1, Math.ceil((end - start) / DAY)),
    daysInMonth: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
  };
}

// The current consumption of an account: `answer`, as the current route gives it for that
// account alone, and `total`, its amount before rounding. Null when neither its snapshot nor
// its projects tell any.
function currentOfAccount({ snapshot, cloud }, now) {
  const snapshotTotal = snapshot?.current_total || 0;
  // OVH tells no consumption: what the projects consumed tells it
  if (snapshotTotal === 0 && cloud && cloud.total > 0) {
    return {
      total: cloud.total,
      answer: {
        snapshot_date: snapshot?.snapshot_date || now.toISOString(),
        period_start: cloud.period_start,
        period_end: cloud.period_end,
        current_total: toCents(cloud.total),
        source: 'cloud_projects',
        project_count: cloud.project_count,
        currency: 'EUR',
      },
    };
  }
  if (!snapshot) return null;
  return {
    total: snapshotTotal,
    answer: {
      snapshot_date: snapshot.snapshot_date,
      period_start: snapshot.period_start,
      period_end: snapshot.period_end,
      current_total: toCents(snapshotTotal),
      currency: snapshot.currency,
      source: 'me_consumption',
      details: snapshot.raw_data ? JSON.parse(snapshot.raw_data) : null,
    },
  };
}

// The month-end forecast of an account: `answer`, as the forecast route gives it for that
// account alone, and `forecast` and `current`, its amounts before rounding. Null when neither
// its snapshot nor its projects tell any.
function forecastOfAccount({ snapshot, cloud }, now) {
  const snapshotForecast = snapshot?.forecast_total || 0;
  const snapshotCurrent = snapshot?.current_total || 0;
  // OVH tells neither: the consumption of the projects so far, over the days it covers,
  // extrapolated to the end of the month
  if (snapshotForecast === 0 && snapshotCurrent === 0 && cloud && cloud.total > 0) {
    const { daysElapsed, daysInMonth } = daysOf(cloud.period_start, cloud.period_end);
    const forecast = (cloud.total / daysElapsed) * daysInMonth;
    const forecastTotal = toCents(forecast);
    const currentTotal = toCents(cloud.total);
    return {
      forecast,
      current: cloud.total,
      answer: {
        snapshot_date: now.toISOString(),
        period_start: cloud.period_start,
        period_end: cloud.period_end,
        forecast_total: forecastTotal,
        current_total: currentTotal,
        currency: 'EUR',
        progress: Math.round((currentTotal / forecastTotal) * 100),
        source: 'cloud_projects',
        days_elapsed: daysElapsed,
        days_in_month: daysInMonth,
      },
    };
  }
  if (!snapshot) return null;
  return {
    forecast: snapshotForecast,
    current: snapshotCurrent,
    answer: {
      snapshot_date: snapshot.snapshot_date,
      period_start: snapshot.period_start,
      period_end: snapshot.period_end,
      forecast_total: toCents(snapshotForecast),
      current_total: toCents(snapshotCurrent),
      currency: snapshot.currency,
      progress: snapshotCurrent && snapshotForecast
        ? Math.round((snapshotCurrent / snapshotForecast) * 100)
        : 0,
    },
  };
}

// The figures of the current month: the latest month that they cover. An account whose last
// import covered an earlier month has none in it, such as an account no longer configured, or
// the Unknown account, whose last import was before the accounts.
function ofCurrentMonth(figures) {
  const monthOf = ({ answer }) => answer.period_start?.slice(0, 7) ?? null;
  const current = latestOf(figures.map(monthOf));
  return figures.filter((figure) => monthOf(figure) === current);
}

// What the figures added up have in common, when they all have it: where they come from, OVH
// or the projects, which the sum says, or else nothing
const sharedSourceOf = (answers) => (
  answers.every(({ source }) => source === answers[0].source) ? answers[0].source : undefined
);

// The latest of the times of figures, and the period that they cover together
function commonOf(answers) {
  return {
    snapshot_date: latestTimeOf(answers.map(({ snapshot_date: time }) => time)),
    period_start: earliestOf(answers.map(({ period_start: start }) => start)),
    period_end: latestOf(answers.map(({ period_end: end }) => end)),
  };
}

// The current consumption of several accounts, in the currency that they share, as the
// accounts bill in one. It says where it comes from when every account's comes from the same
// place: from the projects, with their number. The details that OVH gives of an account's are
// that account's alone.
function sumOfCurrent(figures) {
  const answers = figures.map(({ answer }) => answer);
  const source = sharedSourceOf(answers);
  return {
    ...commonOf(answers),
    current_total: toCents(sumOf(figures.map(({ total }) => total))),
    currency: answers[0].currency,
    ...(source && { source }),
    ...(source === 'cloud_projects' && {
      project_count: sumOf(answers.map(({ project_count: count }) => count)),
    }),
  };
}

// The month-end forecast of several accounts: the sum of each account's forecast, as it shows
// alone, extrapolated over its own days. When every account's is extrapolated from its
// projects, the sum says so, with the days from the earliest start to the latest end, as for
// the projects of one account.
function sumOfForecasts(figures) {
  const answers = figures.map(({ answer }) => answer);
  const common = commonOf(answers);
  const forecastTotal = toCents(sumOf(figures.map(({ forecast }) => forecast)));
  const currentTotal = toCents(sumOf(figures.map(({ current }) => current)));
  const extrapolated = sharedSourceOf(answers) === 'cloud_projects';
  const days = extrapolated && daysOf(common.period_start, common.period_end);
  return {
    ...common,
    forecast_total: forecastTotal,
    current_total: currentTotal,
    currency: answers[0].currency,
    progress: currentTotal && forecastTotal
      ? Math.round((currentTotal / forecastTotal) * 100)
      : 0,
    ...(extrapolated && {
      source: 'cloud_projects',
      days_elapsed: days.daysElapsed,
      days_in_month: days.daysInMonth,
    }),
  };
}

// The figure of the accounts: `empty` when none has one, the figure of the only one that has
// one as it shows alone, or else the sum of those of the current month
function ofAccounts(figures, empty, sum) {
  const counted = ofCurrentMonth(figures.filter(Boolean));
  if (counted.length === 0) return empty;
  if (counted.length === 1) return counted[0].answer;
  return sum(counted);
}

/**
 * The current month's consumption so far, of one account, or of all accounts added up
 * @param {{ snapshot: (object|undefined), cloud: object }[]} accounts - What tells each
 *   account's: its latest consumption snapshot, and what its projects consumed (see
 *   consumption.getCurrentByAccount() in data/db.js)
 * @param {Date} now - When the route answers, the time of a figure that it computes
 * @returns {object} What GET /api/consumption/current answers: `current_total`, and, unless
 *   no account has any, `snapshot_date`, `period_start`, `period_end` and `currency`; `source`,
 *   'me_consumption' or 'cloud_projects', with `details` or `project_count`, when the accounts
 *   share one
 */
function currentConsumption(accounts, now) {
  return ofAccounts(accounts.map((account) => currentOfAccount(account, now)),
    { current_total: 0, currency: 'EUR' }, sumOfCurrent);
}

/**
 * The current month's month-end forecast, of one account, or of all accounts added up: the sum
 * of each account's forecast, rather than the forecast of their summed consumption, which would
 * extrapolate an account that its projects tell over the days of another
 * @param {{ snapshot: (object|undefined), cloud: object }[]} accounts - As for
 *   currentConsumption()
 * @param {Date} now - When the route answers, the time of a forecast that it computes
 * @returns {object} What GET /api/consumption/forecast answers: `forecast_total`, and, unless
 *   no account has any, `snapshot_date`, `period_start`, `period_end`, `current_total`,
 *   `currency` and `progress`; with `source`, 'cloud_projects', `days_elapsed` and
 *   `days_in_month` when every account's is extrapolated from its projects
 */
function consumptionForecast(accounts, now) {
  return ofAccounts(accounts.map((account) => forecastOfAccount(account, now)),
    { forecast_total: 0, currency: 'EUR' }, sumOfForecasts);
}

module.exports = { currentConsumption, consumptionForecast };
