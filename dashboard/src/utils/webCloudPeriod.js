// Web Cloud is billed on yearly renewals, so a single month only ever shows an
// arbitrary slice of it: the tab reads the 12 months ending on the selected one.
const WEB_CLOUD_MONTHS = 12;

const shiftMonths = (isoDate, months) => {
  if (!isoDate) return isoDate;
  const [year, month] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

export { WEB_CLOUD_MONTHS, shiftMonths };
