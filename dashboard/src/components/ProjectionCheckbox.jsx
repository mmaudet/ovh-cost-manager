/**
 * The checkbox « Projeter le mois en cours » (#214): whether the page counts the month in
 * progress at its projected cost, each recurring service that it has not billed yet at its cost
 * of the month before. One setting for the whole page (useMonthInProgressProjection()), which the
 * Trends tab shows next to its period selector (#217).
 * @param {object} props
 * @param {boolean} props.projectsMonthInProgress - Whether the page projects it
 * @param {function(boolean): void} props.setProjectsMonthInProgress - Turns the projection on or
 *   off
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
export function ProjectionCheckbox({ projectsMonthInProgress, setProjectsMonthInProgress, t }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
      <input
        type="checkbox"
        checked={projectsMonthInProgress}
        onChange={(e) => setProjectsMonthInProgress(e.target.checked)}
        className="w-4 h-4 cursor-pointer"
      />
      {t('projectMonthInProgress')}
    </label>
  );
}
