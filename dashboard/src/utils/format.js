// The locale the page writes numbers and dates in, for its language
const localeOf = (language) => (language === 'en' ? 'en-US' : 'fr-FR');

// Format currency based on language
const formatCurrency = (value, language = 'fr') => {
  const locale = localeOf(language);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

// Format a share (0.092) as a percentage, based on language: 9,2 % in French, 9.2% in
// English. With one decimal unless told otherwise, and signed on request, as a variation is:
// an increase reads +20,0 %, a decrease -16,7 % either way. A share of 0 out of a negative
// total, which is -0, reads 0,0 % as any 0 does.
const formatPercent = (share, language = 'fr', { decimals = 1, signed = false } = {}) => {
  const locale = localeOf(language);
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed && share > 0 ? 'always' : 'auto',
  }).format(share === 0 ? 0 : share);
};

// A 'YYYY-MM' month and its year in the language, the month by its short or long name as
// Intl writes it, capitalised on request: '' without a month, and what is not one left as
// it is. Localization belongs on the client; the API sends the raw yearMonth.
const formatMonth = (yearMonth, language, { name, capitalised = false }) => {
  if (!yearMonth) return '';
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return yearMonth;
  const label = new Date(year, month - 1, 1)
    .toLocaleDateString(localeOf(language), { month: name, year: 'numeric' });
  return capitalised ? label.charAt(0).toUpperCase() + label.slice(1) : label;
};

// The short name of a 'YYYY-MM' month and its year, as the Trends and Web Cloud tabs show
// it: sept. 2026 in French, Sep 2026 in English
const formatYearMonth = (yearMonth, language = 'fr') => (
  formatMonth(yearMonth, language, { name: 'short' })
);

// The long name of a 'YYYY-MM' month and its year, capitalised as in the label of
// /api/months, which is always in French (#33): Septembre 2026 in French, September 2026
// in English, as the month selectors and the report show it
const formatMonthLabel = (yearMonth, language = 'fr') => (
  formatMonth(yearMonth, language, { name: 'long', capitalised: true })
);

// The month of a date as YYYY-MM, as the month formats above read it: in local time, as
// they write it
const yearMonthOf = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
);

const BYTE_UNITS = {
  fr: ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'],
  en: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
};

// A number rounded as Intl.NumberFormat writes it, half up on its decimal digits: 9.95 to
// one decimal is 10, where toFixed(1), which reads its binary value, gives 9.9
const roundAsWritten = (value, decimals) => Number(new Intl.NumberFormat('en-US', {
  maximumFractionDigits: decimals,
  useGrouping: false,
}).format(value));

// A size in the unit of the given rank, rounded as it reads: to one decimal below 10 of a
// unit, and to none from 10, or in bytes. The decimals follow the rounded size: 9.96 KB,
// which round to 10.0 KB, read 10 KB as 10 KB do.
const roundSize = (value, rank) => {
  const tenths = roundAsWritten(value, 1);
  return rank > 0 && tenths < 10
    ? { value: tenths, decimals: 1 }
    : { value: roundAsWritten(value, 0), decimals: 0 };
};

// Human-readable byte size (decimal units, like the OVH manager), in the units and the
// number format of the language: 1,5 Go in French, 1.5 GB in English
const fmtBytes = (bytes, language = 'fr') => {
  if (bytes === null || bytes === undefined) return '-';
  const units = language === 'en' ? BYTE_UNITS.en : BYTE_UNITS.fr;
  let rank = Math.min(Math.max(Math.floor(Math.log10(bytes) / 3), 0), units.length - 1);
  let size = roundSize(bytes / Math.pow(1000, rank), rank);
  // A size that rounds to 1000 of a unit reads in the next one: 999,999 bytes are 1.0 MB,
  // not 1000 KB
  if (size.value >= 1000 && rank < units.length - 1) {
    rank += 1;
    size = roundSize(bytes / Math.pow(1000, rank), rank);
  }
  const number = new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: size.decimals,
    maximumFractionDigits: size.decimals,
  }).format(size.value);
  return `${number} ${units[rank]}`;
};

// Whether a count takes the singular in the language, as its plural rules say: 0 and 1 in
// French (0 jour, 1 jour, 2 jours), 1 only in English (0 days, 1 day, 2 days)
const takesSingular = (count, language = 'fr') =>
  new Intl.PluralRules(localeOf(language)).select(count) === 'one';

export {
  localeOf, formatCurrency, formatPercent, formatYearMonth, formatMonthLabel, yearMonthOf,
  fmtBytes, takesSingular,
};
