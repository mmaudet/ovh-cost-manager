import { describe, it, expect } from 'vitest';
import { projectListRows } from '../../src/utils/projectList.js';

// The rows of the list of projects of the Public Cloud tab (#180): the projects of the account
// shown, as /api/projects/enriched lists them, most consuming first, with what the bills of the
// month selected charged each, from its projects as /api/analysis/by-project lists them, most
// expensive first.
const inInventory = (id, name, fields = {}) => ({
  id, name, description: null, status: 'ok', account: 'xx1111-ovh', instance_count: 0,
  consumption_total: 0, period_start: null, period_end: null, ...fields,
});
const production = inInventory('project-production', 'Production', {
  instance_count: 5, consumption_total: 350,
});
const staging = inInventory('project-staging', 'Staging', { consumption_total: 52.35 });
const sandbox = inInventory('project-sandbox', 'Sandbox');
const billed = (projectId, projectName, total) => ({
  projectId, projectName, total, detailsCount: 1,
});

// Each row as [id, name, what the month billed it]
const rows = (projects, billedProjects) => projectListRows(projects, billedProjects)
  .map(({ id, name, billed: amount }) => [id, name, amount]);

describe('projectListRows', () => {
  it('gives each project of the list what the month billed it, in the order of the list', () => {
    expect(projectListRows(
      [production, staging],
      [
        billed('project-staging', 'Staging', 220),
        billed('project-production', 'Production', 610.4),
      ],
    )).toEqual([
      { ...production, billed: 610.4, inInventory: true },
      { ...staging, billed: 220, inInventory: true },
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

  // So that the amounts add up to the month's cloud total: a project billed in the month that the
  // list lacks gets a row of its own, after the projects of the list, in the order of the bills'
  // projects. The server names a project that the projects table lacks "Unknown".
  it('gives the projects billed in the month that the list lacks after those of the list', () => {
    expect(projectListRows(
      [production, sandbox],
      [
        billed('project-production', 'Production', 610.4),
        billed('project-legacy', 'Legacy', 220),
        billed('project-gone', 'Unknown', 45),
      ],
    )).toEqual([
      { ...production, billed: 610.4, inInventory: true },
      { ...sandbox, billed: null, inInventory: true },
      { id: 'project-legacy', name: 'Legacy', billed: 220, inInventory: false },
      { id: 'project-gone', name: 'Unknown', billed: 45, inInventory: false },
    ]);
  });

  it('gives the projects billed in the month when the list has none', () => {
    expect(rows([], [billed('project-legacy', 'Legacy', 220)]))
      .toEqual([['project-legacy', 'Legacy', 220]]);
  });

  // With all accounts shown, the list names the account of each project, and the bills' projects
  // come once for each account that billed them, with that account, null for the Unknown account
  // (#118): a project of the bills is one of the list when it has its id and its account
  describe('by account', () => {
    const ofAccount = (project, account) => ({ ...project, account });
    const lyonProduction = ofAccount(production, 'xx1111-ovh');
    const unnamedStaging = ofAccount(staging, 'yy2222-ovh');
    const unknownSandbox = ofAccount(sandbox, null);

    it('gives each project of the list what the bills of its account charged it', () => {
      expect(projectListRows(
        [lyonProduction, unnamedStaging, unknownSandbox],
        [
          ofAccount(billed('project-production', 'Production', 610.4), 'xx1111-ovh'),
          ofAccount(billed('project-staging', 'Staging', 220), 'yy2222-ovh'),
        ],
      )).toEqual([
        { ...lyonProduction, billed: 610.4, inInventory: true },
        { ...unnamedStaging, billed: 220, inInventory: true },
        { ...unknownSandbox, billed: null, inInventory: true },
      ]);
    });

    // Such as a project that moved from an account to another: what its former account was
    // billed for it is not in the list, which gives it the other
    it('gives a project billed to an account that the list does not give it a row of its own',
      () => {
        expect(projectListRows(
          [lyonProduction, unnamedStaging],
          [
            ofAccount(billed('project-production', 'Production', 610.4), 'xx1111-ovh'),
            ofAccount(billed('project-staging', 'Staging', 220), 'yy2222-ovh'),
            ofAccount(billed('project-staging', 'Staging', 30), 'xx1111-ovh'),
            ofAccount(billed('project-gone', 'Unknown', 12), null),
          ],
        )).toEqual([
          { ...lyonProduction, billed: 610.4, inInventory: true },
          { ...unnamedStaging, billed: 220, inInventory: true },
          {
            id: 'project-staging', name: 'Staging', account: 'xx1111-ovh', billed: 30,
            inInventory: false,
          },
          { id: 'project-gone', name: 'Unknown', account: null, billed: 12, inInventory: false },
        ]);
      });
  });
});
