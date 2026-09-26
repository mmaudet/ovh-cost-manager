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

export { formatCurrency, formatYearMonth };
