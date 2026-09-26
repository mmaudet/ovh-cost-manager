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

// Human-readable byte size (decimal units, like the OVH manager), in the units and the
// number format of the language: 1,5 Go in French, 1.5 GB in English
const fmtBytes = (bytes, language = 'fr') => {
  if (bytes === null || bytes === undefined) return '-';
  const units = language === 'en' ? BYTE_UNITS.en : BYTE_UNITS.fr;
  if (bytes === 0) return `0 ${units[0]}`;
  let i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  // A size that rounds to 1000 of a unit reads in the next one: 999,999 bytes are 1.0 MB,
  // not 1000 KB
  if (i < units.length - 1 && Math.round(bytes / Math.pow(1000, i)) >= 1000) i += 1;
  const value = bytes / Math.pow(1000, i);
  const decimals = value < 10 && i > 0 ? 1 : 0;
  const number = new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${number} ${units[i]}`;
};

export { formatCurrency, formatPercent, formatYearMonth, fmtBytes };
