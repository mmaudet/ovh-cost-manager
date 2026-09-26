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

// Format a share (0.092) as a percentage with one decimal, based on language:
// 9,2 % in French, 9.2% in English
const formatPercent = (share, language = 'fr') => {
  const locale = localeOf(language);
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(share);
};

// Format a 'YYYY-MM' string into a localized "short month + year" label.
// Localization belongs on the client; the API sends the raw yearMonth.
const formatYearMonth = (yearMonth, language = 'fr') => {
  if (!yearMonth) return '';
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return yearMonth;
  const locale = localeOf(language);
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
};

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

export { formatCurrency, formatPercent, formatYearMonth, fmtBytes };
