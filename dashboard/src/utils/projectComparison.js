import { variationPercent } from './variation.js';

// The rows of the project comparison of the Compare tab, from the projects of months A and B
// as /api/analysis/by-project lists them: every project billed in either month (#55), with
// its cost in month A (totalA) and in month B (totalB), 0 € in a month it was not billed in,
// and its variation from A to B in percent (variation): null from 0 € or less in month A,
// which leaves none to compute (#65).
//
// A project of month A and one of month B are the same when they have the same id: a
// project renamed between the two months stays one row, under its name in month A, and the
// projects the server cannot name, all "Unknown", stay apart. The server gives every project
// its id; a project without one is known by its name. The projects of month A come first, in
// their order, then those billed in month B only, in theirs.

// What makes a project of month A and one of month B the same: its id, or its name without one
const identity = ({ projectId, projectName }) => (
  projectId != null ? `id ${projectId}` : `name ${projectName}`
);

// The row of a project, as month A lists it, or as month B does when month A does not
const row = (projectA, projectB) => {
  const { projectId, projectName } = projectA ?? projectB;
  const totalA = projectA?.total ?? 0;
  const totalB = projectB?.total ?? 0;
  return { projectId, projectName, totalA, totalB, variation: variationPercent(totalA, totalB) };
};

const projectComparisonRows = (projectsA, projectsB) => {
  const unpairedB = [...projectsB];
  const rowsOfMonthA = projectsA.map((projectA) => {
    const index = unpairedB.findIndex((projectB) => identity(projectB) === identity(projectA));
    const [projectB] = index === -1 ? [] : unpairedB.splice(index, 1);
    return row(projectA, projectB);
  });
  return [...rowsOfMonthA, ...unpairedB.map((projectB) => row(undefined, projectB))];
};

export { projectComparisonRows };
