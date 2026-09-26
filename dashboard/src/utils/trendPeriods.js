import { shiftMonths } from './webCloudPeriod.js';

// Trend period options, expressed in months. The largest offered option is
// derived from the oldest available month so users can never pick a range
// emptier than their data.
const PERIOD_OPTIONS = [
  { months: 3, key: 'period3m' },
  { months: 6, key: 'period6m' },
  { months: 12, key: 'period1y' },
  { months: 24, key: 'period2y' },
  { months: 36, key: 'period3y' },
  { months: 60, key: 'period5y' },
  { months: 120, key: 'period10y' },
  { months: 180, key: 'period15y' },
  { months: 240, key: 'period20y' }
];

// Number of months from a 'YYYY-MM' up to another, both included: the months of data up to
// the month the trend period ends on, the selected one (#66).
const monthsSince = (yearMonth, endMonth) => {
  if (!yearMonth || !endMonth) return 0;
  const [y, m] = yearMonth.split('-').map(Number);
  const [endY, endM] = endMonth.split('-').map(Number);
  if (!y || !m || !endY || !endM) return 0;
  return (endY - y) * 12 + (endM - m) + 1;
};

// Trend periods available given how far back the data goes. Offer every
// predefined step up to (and including) the first one that covers all data.
const availablePeriodsFor = (maxMonths) => {
  const out = [];
  for (const opt of PERIOD_OPTIONS) {
    out.push(opt);
    if (opt.months >= maxMonths) break;
  }
  return out;
};

// The first and last day of the trend period of that many months that ends on the selected
// month, that month included, as the server counts it for the cost trends (#66): 3 months
// that end on September run from July to September. Null before a month is selected.
const trendWindowEndingOn = (selectedMonth, months) => (selectedMonth ? {
  from: shiftMonths(selectedMonth.from, -(months - 1)),
  to: selectedMonth.to,
} : null);

export { PERIOD_OPTIONS, monthsSince, availablePeriodsFor, trendWindowEndingOn };
