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

// The share of the month-end forecast that the consumption so far reaches, in percent: 0
// without either
const progressOf = (current, forecast) => (
  current && forecast ? Math.round((current / forecast) * 100) : 0
);

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
  // extrapolated to the end of the month, but for what OVH gives for the whole month, such as
  // the monthly plans, which counts once (#145)
  if (snapshotForecast === 0 && snapshotCurrent === 0 && cloud && cloud.total > 0) {
    const { daysElapsed, daysInMonth } = daysOf(cloud.period_start, cloud.period_end);
    const monthly = cloud.monthly_total || 0;
    const forecast = monthly + ((cloud.total - monthly) / daysElapsed) * daysInMonth;
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
        progress: progressOf(currentTotal, forecastTotal),
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
      progress: progressOf(snapshotCurrent, snapshotForecast),
    },
  };
}

// The month of a figure, YYYY-MM, that of the start of its period: null without one
const monthOf = ({ answer }) => answer.period_start?.slice(0, 7) ?? null;

// What the figures added up have in common, when they all have it: where they come from, OVH
// or the projects, which the sum says, or else nothing
const sharedSourceOf = (answers) => (
  answers.every(({ source }) => source === answers[0].source) ? answers[0].source : undefined
);

// The dates of a sum of figures: the latest of their times, and the period that they cover
// together
function datesOfSum(answers) {
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
    ...datesOfSum(answers),
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
  const dates = datesOfSum(answers);
  const forecastTotal = toCents(sumOf(figures.map(({ forecast }) => forecast)));
  const currentTotal = toCents(sumOf(figures.map(({ current }) => current)));
  const extrapolated = sharedSourceOf(answers) === 'cloud_projects';
  const days = extrapolated && daysOf(dates.period_start, dates.period_end);
  return {
    ...dates,
    forecast_total: forecastTotal,
    current_total: currentTotal,
    currency: answers[0].currency,
    progress: progressOf(currentTotal, forecastTotal),
    ...(extrapolated && {
      source: 'cloud_projects',
      days_elapsed: days.daysElapsed,
      days_in_month: days.daysInMonth,
    }),
  };
}

// Adds up the figures of the accounts asked for in the current month, the latest that the
// figures of every account cover, as a consumption route answers them: `none` when none of
// them has one in it, the only one as its account shows alone, or else their `sum`. An
// account whose latest figure is of an earlier month has none in it, such as an account no
// longer configured, or the Unknown account, whose last import was before the accounts. So do
// the accounts whose last imports are of the month before, when another's is of a new one,
// until they are imported again.
function addUpCurrentMonth({ asked, every }, figureOf, { none, sum }) {
  const current = latestOf(every.map(figureOf).filter(Boolean).map(monthOf));
  const counted = asked.map(figureOf)
    .filter((figure) => figure && monthOf(figure) === current);
  if (counted.length === 0) return none;
  if (counted.length === 1) return counted[0].answer;
  return sum(counted);
}

/**
 * The current month's consumption so far, of one account, or of all accounts added up, in the
 * current month (see addUpCurrentMonth())
 * @param {object} accounts
 * @param {{ snapshot: (object|undefined), cloud: object }[]} accounts.asked - What tells the
 *   consumption of each account asked for, one or all of them: its latest consumption
 *   snapshot, and what its projects consumed (see consumption.getCurrentByAccount() in
 *   data/db.js)
 * @param {{ snapshot: (object|undefined), cloud: object }[]} accounts.every - The same for
 *   every account, whose latest month is the current one
 * @param {Date} now - When the route answers, the time of a figure that it computes
 * @returns {object} What GET /api/consumption/current answers: `{ current_total: 0,
 *   currency: 'EUR' }` when no account asked for has one in the current month. One
 *   account's: `snapshot_date`, `period_start`, `period_end`, `current_total`, `currency`
 *   and `source`, with `details`, what OVH tells, for 'me_consumption', or `project_count`
 *   for 'cloud_projects'. Several accounts': the same but `details`, which stay one
 *   account's, and with `source` only when they share one.
 */
function currentConsumption(accounts, now) {
  return addUpCurrentMonth(accounts, (account) => currentOfAccount(account, now),
    { none: { current_total: 0, currency: 'EUR' }, sum: sumOfCurrent });
}

/**
 * The current month's month-end forecast, of one account, or of all accounts added up: the sum
 * of each account's forecast, rather than the forecast of their summed consumption, which would
 * extrapolate an account that its projects tell over the days of another
 * @param {object} accounts - The accounts asked for, and every account, as for
 *   currentConsumption()
 * @param {Date} now - When the route answers, the time of a forecast that it computes
 * @returns {object} What GET /api/consumption/forecast answers: `{ forecast_total: 0,
 *   currency: 'EUR' }` when no account asked for has one in the current month; else
 *   `snapshot_date`, `period_start`, `period_end`, `forecast_total`, `current_total`,
 *   `currency` and `progress`, with `source`, 'cloud_projects', `days_elapsed` and
 *   `days_in_month` when every account's is extrapolated from its projects
 */
function consumptionForecast(accounts, now) {
  return addUpCurrentMonth(accounts, (account) => forecastOfAccount(account, now),
    { none: { forecast_total: 0, currency: 'EUR' }, sum: sumOfForecasts });
}

module.exports = { currentConsumption, consumptionForecast };
