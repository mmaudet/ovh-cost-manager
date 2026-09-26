import { describe, it, expect } from 'vitest';
import { projectComparisonRows } from '../../src/utils/projectComparison.js';

// The rows of the project comparison of the Compare tab, from the projects of months A and B
// as /api/analysis/by-project lists them: most expensive first, each with its id, its name,
// "Unknown" when the server cannot name it, and its cost (#55)
const project = (projectId, projectName, total) => ({
  projectId, projectName, total, detailsCount: 1,
});
const production = (total) => project('project-production', 'Production', total);
const staging = (total) => project('project-staging', 'Staging', total);
const sandbox = (total) => project('project-sandbox', 'Sandbox', total);

// The rows for the projects of months A and B, each as
// [id, name, cost in month A, cost in month B, variation]
const rows = (monthA, monthB) => projectComparisonRows(monthA, monthB)
  .map(({ projectId, projectName, totalA, totalB, variation }) => (
    [projectId, projectName, totalA, totalB, variation]
  ));

describe('projectComparisonRows', () => {
  it('pairs the projects billed in both months, with their variation from A to B', () => {
    expect(projectComparisonRows(
      [production(400), staging(200)],
      [production(500), staging(150)],
    )).toEqual([
      {
        projectId: 'project-production', projectName: 'Production',
        totalA: 400, totalB: 500, variation: 25,
      },
      {
        projectId: 'project-staging', projectName: 'Staging',
        totalA: 200, totalB: 150, variation: -25,
      },
    ]);
  });

  it('gives a project billed in month A only 0 € in month B, down 100 %', () => {
    expect(rows([production(400), staging(200)], [production(500)])).toEqual([
      ['project-production', 'Production', 400, 500, 25],
      ['project-staging', 'Staging', 200, 0, -100],
    ]);
  });

  // Its variation from 0 € would be infinite
  it('gives a project billed in month B only 0 € in month A, and no variation', () => {
    expect(rows([production(400)], [production(500), sandbox(120)])).toEqual([
      ['project-production', 'Production', 400, 500, 25],
      ['project-sandbox', 'Sandbox', 0, 120, null],
    ]);
  });

  it('gives the projects of month B when month A has none', () => {
    expect(rows([], [production(500), staging(150)])).toEqual([
      ['project-production', 'Production', 0, 500, null],
      ['project-staging', 'Staging', 0, 150, null],
    ]);
  });

  it('gives no project when neither month has any', () => {
    expect(projectComparisonRows([], [])).toEqual([]);
  });

  it('gives no variation to a project billed 0 € in month A', () => {
    expect(rows([production(0)], [production(120)]))
      .toEqual([['project-production', 'Production', 0, 120, null]]);
    expect(rows([production(0)], [production(0)]))
      .toEqual([['project-production', 'Production', 0, 0, null]]);
  });

  // It would have the wrong sign, -766.7 % from -15 € to 100 € (#65)
  it('gives no variation to a project whose credits exceed its costs in month A', () => {
    expect(rows([production(-15)], [production(100)]))
      .toEqual([['project-production', 'Production', -15, 100, null]]);
  });

  it('keeps the projects of month A in their order, then those of month B only in theirs', () => {
    const archive = project('project-archive', 'Archive', 50);

    expect(rows([staging(200), production(100)], [sandbox(300), production(500), archive])
      .map(([projectId]) => projectId)).toEqual([
      'project-staging', 'project-production', 'project-sandbox', 'project-archive',
    ]);
  });

  it('pairs a project renamed between the two months by its id, under its name in A', () => {
    expect(rows(
      [project('project-staging', 'Staging', 200)],
      [project('project-staging', 'Recette', 250)],
    )).toEqual([['project-staging', 'Staging', 200, 250, 25]]);
  });

  // As the projects the server cannot name, all "Unknown"
  it('keeps apart the projects of the same name with different ids', () => {
    expect(rows(
      [project('project-deleted-1', 'Unknown', 50), project('project-deleted-2', 'Unknown', 30)],
      [project('project-deleted-2', 'Unknown', 45), project('project-deleted-3', 'Unknown', 10)],
    )).toEqual([
      ['project-deleted-1', 'Unknown', 50, 0, -100],
      ['project-deleted-2', 'Unknown', 30, 45, 50],
      ['project-deleted-3', 'Unknown', 0, 10, null],
    ]);
  });

  describe('a project without an id', () => {
    const legacy = (total) => ({ projectName: 'Legacy', total });

    it('pairs by name, in either month, and takes the id of the other one if it has one', () => {
      expect(rows([legacy(100)], [project('project-legacy', 'Legacy', 150)]))
        .toEqual([['project-legacy', 'Legacy', 100, 150, 50]]);
      expect(rows([project('project-legacy', 'Legacy', 100)], [legacy(150)]))
        .toEqual([['project-legacy', 'Legacy', 100, 150, 50]]);
      expect(rows([legacy(100)], [legacy(150)]))
        .toEqual([[undefined, 'Legacy', 100, 150, 50]]);
    });

    // The pairs by id come first: a project without an id only pairs with one left over
    it('leaves the projects that pair by id to each other', () => {
      expect(rows(
        [legacy(100), project('project-legacy', 'Legacy', 200)],
        [project('project-legacy', 'Legacy', 300)],
      )).toEqual([
        [undefined, 'Legacy', 100, 0, -100],
        ['project-legacy', 'Legacy', 200, 300, 50],
      ]);
    });
  });

  it('leaves the lists it compares as they were', () => {
    const monthA = [production(400)];
    const monthB = [production(500), sandbox(120)];

    projectComparisonRows(monthA, monthB);

    expect(monthA).toEqual([production(400)]);
    expect(monthB).toEqual([production(500), sandbox(120)]);
  });
});
