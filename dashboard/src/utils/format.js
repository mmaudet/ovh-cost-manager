// Format currency based on language
const formatCurrency = (value, language = 'fr') => {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

// Format a 'YYYY-MM' string into a localized "short month + year" label.
// Localization belongs on the client; the API sends the raw yearMonth.
const formatYearMonth = (yearMonth, language = 'fr') => {
  if (!yearMonth) return '';
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return yearMonth;
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
};

// Human-readable byte size (decimal units, like the OVH manager)
const fmtBytes = (bytes) => {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / Math.pow(1000, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

export { formatCurrency, formatYearMonth, fmtBytes };
