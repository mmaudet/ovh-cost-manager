import { describe, it, expect } from 'vitest';
import { sortProjects } from '../../src/utils/projectSort.js';

// The project breakdown of the Overview, sorted as the user sorts it: by name, or by amount.
// The projects are as /api/analysis/by-project lists them, most expensive first; a credit
// note can leave one below zero.
const production = {
  projectId: 'project-production', projectName: 'Production', total: 610.4, detailsCount: 30,
};
const staging = {
  projectId: 'project-staging', projectName: 'Staging', total: 220, detailsCount: 11,
};
const sandbox = {
  projectId: 'project-sandbox', projectName: 'sandbox', total: 120, detailsCount: 6,
};
const archive = {
  projectId: 'project-archive', projectName: 'Archive', total: -15, detailsCount: 1,
};
const projects = [production, staging, sandbox, archive];

// The projects in the order sorted, by name or by id
const names = (sorted) => sorted.map(({ projectName }) => projectName);
const ids = (sorted) => sorted.map(({ projectId }) => projectId);

describe('sortProjects', () => {
  it('sorts by amount, most expensive first or last', () => {
    expect(names(sortProjects(projects, { column: 'total', direction: 'desc' })))
      .toEqual(['Production', 'Staging', 'sandbox', 'Archive']);
    expect(names(sortProjects(projects, { column: 'total', direction: 'asc' })))
      .toEqual(['Archive', 'sandbox', 'Staging', 'Production']);
  });

  it('sorts by name whatever the case, from Z to A or from A to Z', () => {
    expect(names(sortProjects(projects, { column: 'name', direction: 'desc' })))
      .toEqual(['Staging', 'sandbox', 'Production', 'Archive']);
    expect(names(sortProjects(projects, { column: 'name', direction: 'asc' })))
      .toEqual(['Archive', 'Production', 'sandbox', 'Staging']);
  });

  it('sorts by amount on any column but the name', () => {
    expect(names(sortProjects(projects, { column: 'diff', direction: 'desc' })))
      .toEqual(['Production', 'Staging', 'sandbox', 'Archive']);
  });

  it('keeps projects of the same amount or name in the order they came in', () => {
    const twin = { ...staging, projectId: 'project-staging-2', projectName: 'STAGING' };

    expect(ids(sortProjects([staging, twin, production], { column: 'total', direction: 'desc' })))
      .toEqual(['project-production', 'project-staging', 'project-staging-2']);
    expect(ids(sortProjects([staging, twin, production], { column: 'name', direction: 'asc' })))
      .toEqual(['project-production', 'project-staging', 'project-staging-2']);
  });

  // The server names every project, "Unknown" when it cannot, and gives each an amount
  it('reads a missing name as empty and a missing amount as 0', () => {
    const unnamed = { projectId: 'project-unnamed', projectName: null, total: null };
    const byAmount = { column: 'total', direction: 'desc' };

    expect(ids(sortProjects([archive, unnamed, production], byAmount)))
      .toEqual(['project-production', 'project-unnamed', 'project-archive']);
    expect(ids(sortProjects([production, unnamed], { column: 'name', direction: 'asc' })))
      .toEqual(['project-unnamed', 'project-production']);
  });

  it('returns a new list and leaves the one it sorts as it was', () => {
    const sorted = sortProjects(projects, { column: 'name', direction: 'asc' });

    expect(sorted).not.toBe(projects);
    expect(names(projects)).toEqual(['Production', 'Staging', 'sandbox', 'Archive']);
  });

  it('returns no project for no list', () => {
    expect(sortProjects(undefined, { column: 'total', direction: 'desc' })).toEqual([]);
    expect(sortProjects(null, { column: 'name', direction: 'asc' })).toEqual([]);
  });
});
