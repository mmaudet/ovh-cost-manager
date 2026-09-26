import { monthWindowEndingOn } from './monthWindow.js';

// Web Cloud is billed on yearly renewals, so a single month only ever shows an
// arbitrary slice of it: the tab reads the 12 months ending on the selected one.
const WEB_CLOUD_MONTHS = 12;

// Domains, hosting and mail renew yearly, so the Web Cloud tab reads the 12
// months ending on the selected one rather than that single month.
const webCloudPeriodEndingOn = (selectedMonth) =>
  monthWindowEndingOn(selectedMonth, WEB_CLOUD_MONTHS);

export { webCloudPeriodEndingOn };
