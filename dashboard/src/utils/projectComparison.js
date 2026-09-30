import { amountsOf, byNameAndAccount } from './monthComparison.js';
import { variationPercent } from './variation.js';

// The rows of the project comparison of the Compare tab, from the projects of months A and B
// as /api/analysis/by-project lists them: every project billed in either month (#55), with
// its cost in month A (totalA) and in month B (totalB), 0 € in a month it was not billed in,
// and its variation from A to B in percent (variation): null from 0 € or less in month A,
// which leaves none to compute (#65). And what projected lines make of each cost (projectedA,
// projectedB), 0 for none: those of the month in progress at its projected cost, while the page
// projects it, whose projects give their projected parts (#219).
//
// A project of month A and one of month B are the same when they have the same id: a
// project renamed between the two months stays one row, under its name in month A, and the
// projects the server cannot name, all "Unknown", stay apart. The server gives every project
// its id; a project without one is known by its name. The projects of month A come first, in
// their order, then those billed in month B only, in theirs.
//
// With all accounts shown, the comparison names the account of each project (#119): the
// server then lists each project once for each account that billed it, with that account's
// NIC handle, null for the Unknown account (#118). Two such projects are the same when they
// have the same account too, and each row keeps that account: a project moved from an
// account to another has a row for each. Projects that name no account pair by id alone.

// What makes two rows the same project: its id, or its name without one
const projectOf = ({ projectId, projectName }) => (
  projectId != null ? `id ${projectId}` : `name ${projectName}`
);

// What makes a project of month A and one of month B the same: the same project, and the same
// account when they name one, as the other comparisons of the tab pair their rows
const identity = byNameAndAccount(projectOf);

// The row of a project, as month A lists it, or as month B does when month A does not, with its
// amounts in each month, as every comparison of the tab reads them (amountsOf())
const row = (projectA, projectB) => {
  const project = projectA ?? projectB;
  const { projectId, projectName } = project;
  const { total: totalA, projected: projectedA } = amountsOf(projectA);
  const { total: totalB, projected: projectedB } = amountsOf(projectB);
  return {
    projectId,
    projectName,
    ...('account' in project ? { account: project.account } : {}),
    totalA,
    totalB,
    projectedA,
    projectedB,
    variation: variationPercent(totalA, totalB),
  };
};

/**
 * The rows of the project comparison of the Compare tab (see above).
 * @param {object[]} projectsA - The projects of month A, as /api/analysis/by-project lists
 *   them: once each, or once for each account that billed them, with that account; and with
 *   their projected parts, for the month in progress at its projected cost (#219)
 * @param {object[]} projectsB - Those of month B, listed the same way
 * @returns {{ projectId: ?string, projectName: string, account: (?string|undefined),
 *   totalA: number, totalB: number, projectedA: number, projectedB: number,
 *   variation: ?number }[]} A row for each project, and account when the projects name theirs
 */
const projectComparisonRows = (projectsA, projectsB) => {
  const unpairedB = [...projectsB];
  const rowsOfMonthA = projectsA.map((projectA) => {
    const index = unpairedB.findIndex((projectB) => identity(projectB) === identity(projectA));
    const [projectB] = index === -1 ? [] : unpairedB.splice(index, 1);
    return row(projectA, projectB);
  });
  return [...rowsOfMonthA, ...unpairedB.map((projectB) => row(undefined, projectB))];
};

/**
 * The first row of each project among rows of the project comparison, in their order: the
 * projects whose products the Compare tab compares, once each (#181). In the Account column, a
 * project billed to several accounts has a row for each (#119), but its products, with all
 * accounts shown, are those of every account's bills. Rows that name no account have a project
 * each already.
 * @param {object[]} rows - Rows that projectComparisonRows() gives, in any order
 * @returns {object[]} The first row of each project, in the order of the rows
 */
const firstRowOfEachProject = (rows) => rows.filter((row, index) => (
  rows.findIndex((other) => projectOf(other) === projectOf(row)) === index
));

export { firstRowOfEachProject, projectComparisonRows };
