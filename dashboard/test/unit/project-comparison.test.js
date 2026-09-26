import { describe, it, expect } from 'vitest';
import { projectComparisonRows } from '../../src/utils/projectComparison.js';

// The rows of the project comparison of the Compare tab, from the projects of months A and B
// as /api/analysis/by-project lists them: most expensive first, each with its id, its name,
// "Unknown" when the server cannot name it, and its cost (#55). The server gives every
// project its id, those it cannot name included.
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

  // The projects the server cannot name, all "Unknown", each with the id of its bill lines:
  // 40 € and 15 € are not one project down 62.5 %
  it('keeps apart the projects the server cannot name, by their ids', () => {
    expect(rows(
      [project('project-gone-1', 'Unknown', 40), project('project-gone-2', 'Unknown', 30)],
      [project('project-gone-3', 'Unknown', 15), project('project-gone-2', 'Unknown', 45)],
    )).toEqual([
      ['project-gone-1', 'Unknown', 40, 0, -100],
      ['project-gone-2', 'Unknown', 30, 45, 50],
      ['project-gone-3', 'Unknown', 0, 15, null],
    ]);
  });

  // As the server listed them before it gave every project its id
  it('pairs the projects by name when none has an id', () => {
    const named = (projectName, total) => project(null, projectName, total);

    expect(rows(
      [named('Production', 400), named('Staging', 200)],
      [named('Sandbox', 120), named('Production', 500)],
    )).toEqual([
      [null, 'Production', 400, 500, 25],
      [null, 'Staging', 200, 0, -100],
      [null, 'Sandbox', 0, 120, null],
    ]);
  });

  it('leaves the lists it compares as they were', () => {
    const monthA = [production(400)];
    const monthB = [production(500), sandbox(120)];

    projectComparisonRows(monthA, monthB);

    expect(monthA).toEqual([production(400)]);
    expect(monthB).toEqual([production(500), sandbox(120)]);
  });
});
