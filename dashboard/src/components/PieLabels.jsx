import { Curve } from 'recharts';

// The share of its pie under which a slice gets no label (#226): the labels of thinner slices
// run into those of their neighbours, and the legend of every pie (PieLegend) names each slice
const MIN_LABELLED_SHARE = 0.03;

// Whether a slice gets a label, from what Recharts gives its label or line: its share of the pie
const isLabelled = ({ percent }) => percent >= MIN_LABELLED_SHARE;

/**
 * The labels of a pie's slices, for the label prop of Recharts' Pie: the text that text() gives
 * each slice, and none on a slice under 3 % of the pie. On a phone, where they would run out of
 * the chart, no label shows (index.css).
 * @param {function(object): string} text - The label of a slice, from what Recharts gives it: its
 *   name, value, percent and the fields of its data
 * @returns {function(object): ?string}
 */
const pieLabel = (text) => (slice) => (isLabelled(slice) ? text(slice) : null);

/**
 * The line from a pie's slice to its label, for the labelLine prop of Recharts' Pie, which
 * gives each slice's line the props of this element (labelLine={<PieLabelLine />}): the line
 * that Recharts draws by default, and none to a slice without a label (pieLabel()).
 * @param {object} props - What Recharts gives the line of a slice
 * @returns {?JSX.Element}
 */
const PieLabelLine = (props) => (isLabelled(props)
  ? <Curve {...props} type="linear" className="recharts-pie-label-line" />
  : null);

export { PieLabelLine, pieLabel };
