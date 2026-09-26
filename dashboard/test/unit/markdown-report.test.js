import { describe, it, expect } from 'vitest';
import { generateMarkdownReport } from '../../src/utils/markdownReport.js';

// French amounts separate thousands with a narrow no-break space
const NNBSP = '\u202f';

// A month as /api/months lists it: labels always in French (#33)
const january = { value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31' };
const summary = {
  total: 3000,
  cloudTotal: 1800,
  nonCloudTotal: 1200,
  dailyAverage: 96.77,
  projectsCount: 3,
};
const byService = [
  { name: 'Compute', value: 2000 },
  { name: 'Storage', value: 666.67 },
  { name: 'Network', value: 333.33 },
];
const byProject = [
  { projectName: 'Production', total: 2100.5 },
  { projectName: 'Staging', total: 650 },
  { projectName: 'Sandbox', total: 249.5 },
];

// What the server answers for a month without any bill
const august = { value: '2026-08', label: 'Août 2026', from: '2026-08-01', to: '2026-08-31' };
const emptySummary = {
  total: 0,
  cloudTotal: 0,
  nonCloudTotal: 0,
  dailyAverage: 0,
  billsCount: 0,
  projectsCount: 0,
  topProjects: [],
};

// "Today" is 15 September 2026, noon in Paris (see setup.js): the report
// ends with the time it was generated.
describe('Markdown report', () => {
  it('sums up a month, its service types and its projects', () => {
    expect(generateMarkdownReport(summary, byService, byProject, january, 'fr')).toBe([
      '# OVH Cost Report - Janvier 2026',
      '',
      '**Période:** 2026-01-01 to 2026-01-31',
      '',
      '## Résumé',
      '',
      '| Métrique | Valeur |',
      '|--------|-------|',
      `| Coût Total | 3${NNBSP}000,00€ |`,
      `| Cloud Total | 1${NNBSP}800,00€ |`,
      `| Non-Cloud Total | 1${NNBSP}200,00€ |`,
      '| Moyenne Journalière | 96,77€ |',
      '| Projets Actifs | 3 |',
      '',
      '## Par Type de Service',
      '',
      '| Service | Coût | % |',
      '|---------|------|---|',
      `| Compute | 2${NNBSP}000,00€ | 66.7% |`,
      '| Storage | 666,67€ | 22.2% |',
      '| Network | 333,33€ | 11.1% |',
      '',
      '## Top Projets',
      '',
      '| Projet | Coût |',
      '|---------|------|',
      `| Production | 2${NNBSP}100,50€ |`,
      '| Staging | 650,00€ |',
      '| Sandbox | 249,50€ |',
      '',
      '---',
      '*Généré le 15/09/2026 12:00:00*',
      '',
    ].join('\n'));
  });

  it('writes a month without any bill with zeros and empty tables', () => {
    expect(generateMarkdownReport(emptySummary, [], [], august, 'fr')).toBe([
      '# OVH Cost Report - Août 2026',
      '',
      '**Période:** 2026-08-01 to 2026-08-31',
      '',
      '## Résumé',
      '',
      '| Métrique | Valeur |',
      '|--------|-------|',
      '| Coût Total | 0,00€ |',
      '| Cloud Total | 0,00€ |',
      '| Non-Cloud Total | 0,00€ |',
      '| Moyenne Journalière | 0,00€ |',
      '| Projets Actifs | 0 |',
      '',
      '## Par Type de Service',
      '',
      '| Service | Coût | % |',
      '|---------|------|---|',
      '',
      '## Top Projets',
      '',
      '| Projet | Coût |',
      '|---------|------|',
      '',
      '---',
      '*Généré le 15/09/2026 12:00:00*',
      '',
    ].join('\n'));
  });

  it('lists the first ten projects only', () => {
    const elevenProjects = [
      'Production', 'Staging', 'Sandbox', 'Data', 'AI', 'Web', 'Mail', 'Backup', 'CI', 'Demo',
      'Archive',
    ].map((projectName, i) => ({ projectName, total: 110 - 10 * i }));

    const report = generateMarkdownReport(summary, byService, elevenProjects, january, 'fr');

    expect(report.split('\n').slice(-14)).toEqual([
      '| Production | 110,00€ |',
      '| Staging | 100,00€ |',
      '| Sandbox | 90,00€ |',
      '| Data | 80,00€ |',
      '| AI | 70,00€ |',
      '| Web | 60,00€ |',
      '| Mail | 50,00€ |',
      '| Backup | 40,00€ |',
      '| CI | 30,00€ |',
      '| Demo | 20,00€ |',
      '',
      '---',
      '*Généré le 15/09/2026 12:00:00*',
      '',
    ]);
  });

  it('speaks English when the page does', () => {
    expect(generateMarkdownReport(summary, byService, byProject, january, 'en')).toBe([
      '# OVH Cost Report - Janvier 2026',
      '',
      '**Period:** 2026-01-01 to 2026-01-31',
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      '| Total Cost | 3,000.00€ |',
      '| Cloud Total | 1,800.00€ |',
      '| Non-Cloud Total | 1,200.00€ |',
      '| Daily Average | 96.77€ |',
      '| Active Projects | 3 |',
      '',
      '## By Service Type',
      '',
      '| Service | Cost | % |',
      '|---------|------|---|',
      '| Compute | 2,000.00€ | 66.7% |',
      '| Storage | 666.67€ | 22.2% |',
      '| Network | 333.33€ | 11.1% |',
      '',
      '## Top Projects',
      '',
      '| Project | Cost |',
      '|---------|------|',
      '| Production | 2,100.50€ |',
      '| Staging | 650.00€ |',
      '| Sandbox | 249.50€ |',
      '',
      '---',
      '*Generated on 9/15/2026, 12:00:00 PM*',
      '',
    ].join('\n'));
  });
});
