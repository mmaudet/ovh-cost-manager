import { describe, it, expect } from 'vitest';
import { generateMarkdownReport } from '../../src/utils/markdownReport.js';
import { NBSP, NNBSP } from '../support/amounts.js';

// A month as /api/months lists it, with a label always in French: the report names the
// month in its own language instead (#33)
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
    // All in French: the title, the period, the totals and the percentages (#60)
    expect(generateMarkdownReport(summary, byService, byProject, january, 'fr')).toBe([
      '# Rapport de coûts OVH - Janvier 2026',
      '',
      '**Période:** du 2026-01-01 au 2026-01-31',
      '',
      '## Résumé',
      '',
      '| Métrique | Valeur |',
      '|--------|-------|',
      `| Coût Total | 3${NNBSP}000,00€ |`,
      `| Total Cloud | 1${NNBSP}800,00€ |`,
      `| Total hors Cloud | 1${NNBSP}200,00€ |`,
      '| Moyenne Journalière | 96,77€ |',
      '| Projets Actifs | 3 |',
      '',
      '## Par Type de Service',
      '',
      '| Service | Coût | % |',
      '|---------|------|---|',
      `| Compute | 2${NNBSP}000,00€ | 66,7${NBSP}% |`,
      `| Storage | 666,67€ | 22,2${NBSP}% |`,
      `| Network | 333,33€ | 11,1${NBSP}% |`,
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
    // In French (#60)
    expect(generateMarkdownReport(emptySummary, [], [], august, 'fr')).toBe([
      '# Rapport de coûts OVH - Août 2026',
      '',
      '**Période:** du 2026-08-01 au 2026-08-31',
      '',
      '## Résumé',
      '',
      '| Métrique | Valeur |',
      '|--------|-------|',
      '| Coût Total | 0,00€ |',
      '| Total Cloud | 0,00€ |',
      '| Total hors Cloud | 0,00€ |',
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

  it('writes N/A for the month when none is selected', () => {
    const report = generateMarkdownReport(summary, byService, byProject, undefined, 'fr');

    // The page offers the export only once a month is selected. In French (#60)
    expect(report.split('\n').slice(0, 3)).toEqual([
      '# Rapport de coûts OVH - N/A',
      '',
      '**Période:** du undefined au undefined',
    ]);
  });

  // Credit notes can bring the service types of a month to 0 € in total: each of them then
  // weighs 0 %, written as the other percentages are, with one decimal (#60)
  it('writes a share of 0 % for each service type when they sum to 0 €', () => {
    const cancelledOut = [{ name: 'Compute', value: 120 }, { name: 'Other', value: -120 }];

    const report = generateMarkdownReport(summary, cancelledOut, byProject, january, 'fr');
    expect(report.split('\n').slice(16, 20)).toEqual([
      '| Service | Coût | % |',
      '|---------|------|---|',
      `| Compute | 120,00€ | 0,0${NBSP}% |`,
      `| Other | -120,00€ | 0,0${NBSP}% |`,
    ]);
    const english = generateMarkdownReport(summary, cancelledOut, byProject, january, 'en');
    expect(english.split('\n').slice(16, 20)).toEqual([
      '| Service | Cost | % |',
      '|---------|------|---|',
      '| Compute | 120.00€ | 0.0% |',
      '| Other | -120.00€ | 0.0% |',
    ]);
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

  it('speaks English when the page does, the month included (#33)', () => {
    expect(generateMarkdownReport(summary, byService, byProject, january, 'en')).toBe([
      '# OVH Cost Report - January 2026',
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
