// The rows of the list of projects of the Public Cloud tab (#180): each project of the account
// shown, in the order of the list, with what the bills of the month selected charged it, which
// the list gives next to what it consumed since the 1st of the current month, not billed yet.
// The bills' projects are those of the Overview's breakdown by project, whose amounts add up to
// the month's cloud total.

/**
 * The rows of the list of projects of the Public Cloud tab (see above).
 * @param {object[]} projects - The projects of the account shown, as /api/projects/enriched
 *   lists them
 * @param {object[]} billedProjects - The projects that the bills of the month charged, as
 *   /api/analysis/by-project lists them: each with its id, projectId, and its amount, total
 * @returns {object[]} Each project of the list, with `billed`, what the month billed it, null
 *   when no bill line of the month names it, and `listed`, true
 */
const projectListRows = (projects, billedProjects) => projects.map((project) => ({
  ...project,
  billed: billedProjects.find(({ projectId }) => projectId === project.id)?.total ?? null,
  listed: true,
}));

export { projectListRows };
