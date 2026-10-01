import { useQuery } from '@tanstack/react-query';
import { DETAIL_PADDING } from './UnfoldingRow.jsx';

/**
 * The answers of months A and B to the query of a comparison of the Compare tab, which the
 * comparison runs once it shows, from the options that the tab's hook gives (#181, #192).
 * @param {function(?object): object} queryOf - The options of the query of a month, for
 *   useQuery
 * @param {?object} monthA
 * @param {?object} monthB
 * @returns {{ status: ('loading'|'failed'|'answered'), dataA: *, dataB: * }} 'loading' until
 *   both months' answers arrive, 'failed' when one failed, 'answered' once both arrived; and
 *   what each month answered
 */
const useMonthAnswers = (queryOf, monthA, monthB) => {
  const answerA = useQuery(queryOf(monthA));
  const answerB = useQuery(queryOf(monthB));
  let status = 'answered';
  if (answerA.isLoading || answerB.isLoading) status = 'loading';
  else if (answerA.isError || answerB.isError) status = 'failed';
  return { status, dataA: answerA.data, dataB: answerB.data };
};

/**
 * What a comparison says in place of the answers of months A and B until both arrived, rather
 * than show a month at 0 € (#181): that they load, or that they could not load when one
 * failed, as the comparison words it. The comparison lays it out, in place of its table or of
 * its rows.
 * @param {object} props
 * @param {'loading'|'failed'} props.status - As useMonthAnswers() gives it
 * @param {string} props.failed - What the comparison says when a month's answer failed
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
const MonthAnswersMessage = ({ status, failed, t }) => (status === 'failed'
  ? <span className="text-red-500">{failed}</span>
  : <span className="text-gray-500">{t('loading')}</span>);

/**
 * The row that an unfolded row of a comparison shows under it in place of its services or charges
 * until the answers of months A and B arrived (#192, #248): what MonthAnswersMessage says, across
 * the comparison's columns, indented under the row's label, in line with them.
 * @param {object} props
 * @param {'loading'|'failed'} props.status - As useMonthAnswers() gives it
 * @param {string} props.failed - What the row says when a month's answer failed
 * @param {number} props.columnCount - The comparison's number of columns
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
const MonthAnswersRow = ({ status, failed, columnCount, t }) => (
  <tr className="border-b">
    <td colSpan={columnCount} className={`${DETAIL_PADDING} text-sm`}>
      <MonthAnswersMessage status={status} failed={failed} t={t} />
    </td>
  </tr>
);

export { MonthAnswersMessage, MonthAnswersRow, useMonthAnswers };
