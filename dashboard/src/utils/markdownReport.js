import { formatCurrency, formatMonthLabel, formatPercent, localeOf } from './format.js';

// Generate markdown report
const generateMarkdownReport = (summary, byService, byProject, selectedMonth, language = 'fr') => {
  const locale = localeOf(language);
  const fmt = (v) => formatCurrency(v, language);
  // The month and its period, N/A without them: the page exports the report of a selected
  // month only, which always has its period
  const month = formatMonthLabel(selectedMonth?.value, language) || 'N/A';
  const { from, to } = selectedMonth ?? {};
  let period = 'N/A';
  if (from && to) period = language === 'en' ? `${from} to ${to}` : `du ${from} au ${to}`;

  let md = `# ${language === 'en' ? 'OVH Cost Report' : 'Rapport de coûts OVH'} - ${month}\n\n`;
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

export { generateMarkdownReport };
