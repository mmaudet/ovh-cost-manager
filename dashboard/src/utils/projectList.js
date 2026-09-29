// The rows of the list of projects of the Public Cloud tab (#180): each project of the account
// shown, in the order of the list, with what the bills of the month selected charged it, which
// the list gives next to what it consumed since the 1st of the current month, not billed yet.
// The bills' projects are those of the Overview's breakdown by project, whose amounts add up to
// the month's cloud total. So that the list adds up to it too, each project billed in the month
// that the list lacks gets a row of its own, after those of the list, in the order of the bills'
// projects: the list gives the projects of the inventory, which may lack one.
//
// With all accounts shown, the list names the account of each project (#121), and the bills'
// projects come once for each account that billed them, with that account (#118), as the
// Overview's breakdown lists them then: a project billed to an account that the list does not
// give it, such as one that moved from an account to another, has a row of its own for that
// account.

// Whether a project of the bills is one of the list: the same id, and the same account when the
// bills' projects name theirs
const sameProject = (project, billedProject) => billedProject.projectId === project.id
  && (!('account' in billedProject) || billedProject.account === project.account);

/**
 * The rows of the list of projects of the Public Cloud tab (see above).
 * @param {object[]} projects - The projects of the account shown, as /api/projects/enriched
 *   lists them
 * @param {object[]} billedProjects - The projects that the bills of the month charged, as
 *   /api/analysis/by-project lists them: each with its id, projectId, its name, projectName,
 *   and its amount, total; once each, or once for each account that billed them, with that
 *   account, `account`
 * @returns {object[]} Each project of the list, with `billed`, what the month billed it, null
 *   when no bill line of the month names it, and `listed`, true. Then each project billed that
 *   the list lacks, with its `id`, its `name`, its `account` when the bills' projects name it,
 *   what the month billed it, and `listed`, false.
 */
const projectListRows = (projects, billedProjects) => [
  ...projects.map((project) => ({
    ...project,
    billed: billedProjects.find((billed) => sameProject(project, billed))?.total ?? null,
    listed: true,
  })),
  ...billedProjects
    .filter((billed) => !projects.some((project) => sameProject(project, billed)))
    .map((billed) => ({
      id: billed.projectId,
      name: billed.projectName,
      ...('account' in billed ? { account: billed.account } : {}),
      billed: billed.total,
      listed: false,
    })),
];

export { projectListRows };
