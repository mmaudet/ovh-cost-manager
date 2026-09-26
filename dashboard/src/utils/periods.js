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

// Number of months from a 'YYYY-MM' up to the current month, inclusive.
const monthsSince = (yearMonth) => {
  if (!yearMonth) return 0;
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return 0;
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) + 1;
};

// Web Cloud is billed on yearly renewals, so a single month only ever shows an
// arbitrary slice of it: the tab reads the 12 months ending on the selected one.
const WEB_CLOUD_MONTHS = 12;

const shiftMonths = (isoDate, months) => {
  if (!isoDate) return isoDate;
  const [year, month] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

export { PERIOD_OPTIONS, monthsSince, WEB_CLOUD_MONTHS, shiftMonths };
