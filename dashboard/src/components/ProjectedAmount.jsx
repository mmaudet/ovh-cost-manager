import { formatBilledAndProjected } from '../utils/format.js';

/**
 * An amount that includes a projected part (#217): in italics and marked « projeté », with a
 * tooltip that says what is billed and what is projected. The Trends tab's most expensive month
 * shows so the month in progress at its projected cost, as the Compare tab shows such amounts
 * (#218), which may give the mark a look of its own, such as a smaller one next to a headline
 * amount.
 * @param {object} props
 * @param {string} props.children - The amount, as the page writes it
 * @param {string} props.detail - What the tooltip says: the billed and the projected amounts
 * @param {function(string): string} props.t
 * @param {string} [props.markClassName] - The classes of the mark, none by default: it then reads
 *   as the text around it
 * @returns {JSX.Element}
 */
export function ProjectedAmount({ children, detail, t, markClassName }) {
  return (
    <span title={detail}>
      <span className="italic">{children}</span>
      {' '}
      <span className={markClassName}>{t('projected')}</span>
    </span>
  );
}

/**
 * An amount of a month in the comparisons of the Compare tab (#218): as the page writes it, or,
 * when it includes a projected part, as ProjectedAmount shows it, with what the month billed so
 * far and its projected cost in its tooltip. The month in progress, at its projected cost, shows
 * so its amounts that projected lines make, in part or in whole, as those of a service that it
 * has not billed yet; a complete month's never do.
 * @param {object} props
 * @param {number} props.amount - The amount, its projected part included
 * @param {?number} [props.projectedPart] - What projected lines make of it, as the routes give
 *   it: 0, or none, for none
 * @param {function(number): string} props.fmt - The amount format of the page
 * @param {function(string): string} props.t
 * @param {string} [props.markClassName] - The classes of the mark (ProjectedAmount)
 * @returns {JSX.Element|string}
 */
export function ComparedAmount({ amount, projectedPart = 0, fmt, t, markClassName }) {
  const written = `${fmt(amount)}€`;
  if (!projectedPart) return written;
  return (
    <ProjectedAmount
      detail={formatBilledAndProjected(amount, projectedPart, fmt, t)} t={t}
      markClassName={markClassName}
    >
      {written}
    </ProjectedAmount>
  );
}
