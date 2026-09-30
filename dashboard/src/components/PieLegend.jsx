/**
 * The legend of a pie, a line per slice, in the order of the slices: its colour, its name and
 * its amount. Around a pie, the labels leave out the thinnest slices, and show none on a phone
 * (PieLabels.jsx): its legend names every slice (#226).
 * @param {object} props
 * @param {object[]} props.data - The pie's data, each slice with its colour (color)
 * @param {string} [props.nameKey] - The field of a slice's name, as the pie's nameKey
 * @param {string} [props.dataKey] - The field of a slice's amount, as the pie's dataKey
 * @param {function(number): string} props.fmt - The page's amount format
 * @param {string} [props.label] - What screen readers name the legend: its chart's heading
 * @param {string} [props.className] - The layout of the lines, one under the other by default
 * @param {boolean} [props.truncate] - Whether a long name is cut short rather than wrapped, as
 *   in a legend of two columns
 * @returns {JSX.Element}
 */
export function PieLegend({
  data, nameKey = 'name', dataKey = 'value', fmt, label, className = 'space-y-1',
  truncate = false,
}) {
  return (
    <ul aria-label={label} className={className}>
      {data.map((slice) => (
        <li key={slice[nameKey]} className="flex items-center gap-2 text-sm">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: slice.color }}
          />
          <span className={truncate ? 'text-gray-600 truncate' : 'text-gray-600'}>
            {slice[nameKey]}
          </span>
          <span className="ml-auto font-medium">{fmt(slice[dataKey])}€</span>
        </li>
      ))}
    </ul>
  );
}
