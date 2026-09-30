import { formatCurrency, formatMonthLabel, formatPercent, localeOf } from './format.js';

/**
 * The Markdown report of a month, in the language of the page: its summary, its costs by
 * service type and its ten most expensive projects, as the page shows them.
 * @param {object} summary - The month's summary (/api/summary)
 * @param {object[]} byService - Its costs by service type (/api/analysis/by-service)
 * @param {object[]} byProject - Its costs by project, each project once
 *   (/api/analysis/by-project)
 * @param {object|undefined} selectedMonth - The month, as /api/months lists it: N/A without one
 * @param {string} [language] - 'fr' or 'en'
 * @param {object} [options]
 * @param {?string} [options.scope] - What the figures cover, as the page names it: all
 *   accounts, or the account selected (scopeLabel()), which the title names after the month
 *   (#124). None for a single-account installation, whose title names the month alone.
 * @param {?string} [options.inProgress] - What the page calls the month in progress, « en
 *   cours », when the month is the month in progress (#216): the title names it in brackets
 *   after the month, as the month selectors do, so that the report says that its figures are
 *   partial. None for any other month.
 * @returns {string}
 */
const generateMarkdownReport = (
  summary, byService, byProject, selectedMonth, language = 'fr',
  { scope = null, inProgress = null } = {},
) => {
  const locale = localeOf(language);
  const fmt = (v) => formatCurrency(v, language);
  // The month and its period, N/A without them: the page exports the report of a selected
  // month only, which always has its period
  const monthName = formatMonthLabel(selectedMonth?.value, language) || 'N/A';
  const month = inProgress ? `${monthName} (${inProgress})` : monthName;
  const { from, to } = selectedMonth ?? {};
  let period = 'N/A';
  if (from && to) period = language === 'en' ? `${from} to ${to}` : `du ${from} au ${to}`;

  const title = language === 'en' ? 'OVH Cost Report' : 'Rapport de coûts OVH';
  let md = `# ${title} - ${month}${scope ? ` - ${scope}` : ''}\n\n`;
  md += `**${language === 'en' ? 'Period:' : 'Période :'}** ${period}\n\n`;
  md += `## ${language === 'en' ? 'Summary' : 'Résumé'}\n\n`;
  md += `| ${language === 'en' ? 'Metric' : 'Métrique'} | ${language === 'en' ? 'Value' : 'Valeur'} |\n|--------|-------|\n`;
  md += `| ${language === 'en' ? 'Total Cost' : 'Coût Total'} | ${fmt(summary?.total || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Cloud Total' : 'Total Cloud'}`
    + ` | ${fmt(summary?.cloudTotal || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Non-Cloud Total' : 'Total hors Cloud'}`
    + ` | ${fmt(summary?.nonCloudTotal || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Daily Average' : 'Moyenne Journalière'} | ${fmt(summary?.dailyAverage || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Active Projects' : 'Projets Actifs'} | ${summary?.projectsCount || 0} |\n\n`;

  md += `## ${language === 'en' ? 'By Service Type' : 'Par Type de Service'}\n\n`;
  md += `| Service | ${language === 'en' ? 'Cost' : 'Coût'} | % |\n|---------|------|---|\n`;
  const totalService = byService.reduce((sum, s) => sum + s.value, 0);
  byService.forEach(s => {
    // In the number format of the language, as the amounts are, and 0 % of service types
    // that sum to 0 € (#60). A type at 0 € weighs 0 %, not -0 %, when they sum below 0 €
    const share = totalService ? (s.value / totalService) || 0 : 0;
    md += `| ${s.name} | ${fmt(s.value)}€ | ${formatPercent(share, language)} |\n`;
  });

  md += `\n## ${language === 'en' ? 'Top Projects' : 'Top Projets'}\n\n`;
  md += `| ${language === 'en' ? 'Project' : 'Projet'} | ${language === 'en' ? 'Cost' : 'Coût'} |\n|---------|------|\n`;
  byProject.slice(0, 10).forEach(p => {
    md += `| ${p.projectName} | ${fmt(p.total)}€ |\n`;
  });

  md += `\n---\n*${language === 'en' ? 'Generated on' : 'Généré le'} ${new Date().toLocaleString(locale)}*\n`;
  return md;
};

/**
 * The name of the file that the page downloads the report of a month in: the month, and the
 * account shown when one is selected (#124), by its id, which any file system takes, unlike
 * the names that config.json gives.
 * @param {string} month - The month, as 'YYYY-MM'
 * @param {?string} account - The id of the account shown, a NIC handle or the value of the
 *   Unknown account: null for all accounts, as on a single-account page
 * @returns {string}
 */
const reportFileName = (month, account) => {
  const accountSuffix = account === null ? '' : `-${account}`;
  return `ovh-report-${month}${accountSuffix}.md`;
};

export { generateMarkdownReport, reportFileName };
