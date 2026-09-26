// The rows of the project comparison of the Compare tab, from the projects of months A and B
// as /api/analysis/by-project lists them: every project billed in either month (#55), with
// its cost in month A (totalA) and in month B (totalB), 0 € in a month it was not billed in,
// and its variation from A to B in percent (diff). The variation is null from 0 € in month
// A, which leaves none to compute: it would be infinite.
//
// A project of month A and one of month B are the same when they have the same id, or when
// either has none, the same name: a project renamed between the two months stays one row,
// under its name in month A, and projects of the same name, like those the server cannot
// name, all "Unknown", stay apart. The projects of month A come first, in their order, then
// those billed in month B only, in theirs.

const hasId = (project) => project.projectId != null;

const sameId = (a, b) => hasId(a) && hasId(b) && a.projectId === b.projectId;

const sameNameWithoutId = (a, b) => !(hasId(a) && hasId(b)) && a.projectName === b.projectName;

const row = (projectA, projectB) => {
  const totalA = projectA?.total ?? 0;
  const totalB = projectB?.total ?? 0;
  return {
    projectId: projectA?.projectId ?? projectB?.projectId,
    projectName: projectA?.projectName ?? projectB?.projectName,
    totalA,
    totalB,
    diff: totalA ? ((totalB - totalA) / totalA) * 100 : null,
  };
};

const compareProjects = (projectsA, projectsB) => {
  const pairs = new Map();
  const unpairedB = new Set(projectsB);
  const pair = (projectA, same) => {
    const projectB = [...unpairedB].find((candidate) => same(projectA, candidate));
    if (projectB) {
      pairs.set(projectA, projectB);
      unpairedB.delete(projectB);
    }
  };
  // By id first, so that a project without an id only pairs with one left over
  projectsA.forEach((projectA) => pair(projectA, sameId));
  projectsA
    .filter((projectA) => !pairs.has(projectA))
    .forEach((projectA) => pair(projectA, sameNameWithoutId));
  return [
    ...projectsA.map((projectA) => row(projectA, pairs.get(projectA))),
    ...[...unpairedB].map((projectB) => row(undefined, projectB)),
  ];
};

export { compareProjects };
