// The months a period covers, counted back from the month it ends on: the Web Cloud tab
// reads the 12 months that end on the selected one, the Trends tab those of its period.

// The first day of the month that many months after a date's, before it when negative
const shiftMonths = (isoDate, months) => {
  if (!isoDate) return isoDate;
  const [year, month] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

// The first and last day of the `count` months that end on a month as /api/months lists
// it, that month included, as the server counts the months of the cost trends: 3 months
// that end on September run from July to September. Null before a month is selected.
const monthWindowEndingOn = (month, count) => (month ? {
  from: shiftMonths(month.from, -(count - 1)),
  to: month.to,
} : null);

export { shiftMonths, monthWindowEndingOn };
