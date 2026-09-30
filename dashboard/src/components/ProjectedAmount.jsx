/**
 * An amount that includes a projected part (#217): in italics and marked « projeté », with a
 * tooltip that says what is billed and what is projected. The Trends tab's most expensive month
 * shows so the month in progress at its projected cost, as the Compare tab shows such amounts
 * (#218).
 * @param {object} props
 * @param {string} props.children - The amount, as the page writes it
 * @param {string} props.detail - What the tooltip says: the billed and the projected amounts
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
export function ProjectedAmount({ children, detail, t }) {
  return (
    <span title={detail}>
      <span className="italic">{children}</span> {t('projected')}
    </span>
  );
}
