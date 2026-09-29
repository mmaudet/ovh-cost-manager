import { describe, it, expect } from 'vitest';
import { projectListRows } from '../../src/utils/projectList.js';

// The rows of the list of projects of the Public Cloud tab (#180): the projects of the account
// shown, as /api/projects/enriched lists them, most consuming first, with what the bills of the
// month selected charged each, from its projects as /api/analysis/by-project lists them, most
// expensive first.
const listed = (id, name, fields = {}) => ({
  id, name, description: null, status: 'ok', account: 'xx1111-ovh', instance_count: 0,
  consumption_total: 0, period_start: null, period_end: null, ...fields,
});
const production = listed('project-production', 'Production', {
  instance_count: 5, consumption_total: 350,
});
const staging = listed('project-staging', 'Staging', { consumption_total: 52.35 });
const sandbox = listed('project-sandbox', 'Sandbox');
const billed = (projectId, projectName, total) => ({
  projectId, projectName, total, detailsCount: 1,
});

// Each row as [id, name, billed]
const rows = (projects, billedProjects) => projectListRows(projects, billedProjects)
  .map(({ id, name, billed: amount }) => [id, name, amount]);

describe('projectListRows', () => {
  it('gives each project of the list what the month billed it, in the order of the list', () => {
    expect(projectListRows(
      [production, staging],
      [billed('project-staging', 'Staging', 220), billed('project-production', 'Production', 610.4)],
    )).toEqual([
      { ...production, billed: 610.4, listed: true },
      { ...staging, billed: 220, listed: true },
    ]);
  });

  // The list shows "-" for it, as for a project that consumed nothing
  it('gives no amount to a project that no bill line of the month names', () => {
    expect(rows([production, sandbox], [billed('project-production', 'Production', 610.4)]))
      .toEqual([
        ['project-production', 'Production', 610.4],
        ['project-sandbox', 'Sandbox', null],
      ]);
    expect(rows([sandbox], [])).toEqual([['project-sandbox', 'Sandbox', null]]);
  });

  // Bill lines whose credits make up for their costs: the project has bill lines
  it('gives their amount to the projects billed 0 € or less', () => {
    expect(rows(
      [production, staging],
      [billed('project-production', 'Production', 0), billed('project-staging', 'Staging', -5)],
    )).toEqual([
      ['project-production', 'Production', 0],
      ['project-staging', 'Staging', -5],
    ]);
  });

  it('gives no row when the list has no project and the month billed none', () => {
    expect(projectListRows([], [])).toEqual([]);
  });
});
