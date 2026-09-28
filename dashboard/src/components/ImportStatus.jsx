// How the page shows how an import ended, or that it runs: the import history's status of
// each run, and the footer's last import of an account that failed (#124)

// The translation key and the colour of each status of the import log and of the accounts
// route. A partial run, one that some accounts failed and the others imported (#113), is a
// warning.
const IMPORT_STATUSES = {
  running: { key: 'importStatusRunning', tone: 'text-blue-600' },
  success: { key: 'importStatusSuccess', tone: 'text-green-600' },
  partial: { key: 'importStatusPartial', tone: 'text-amber-600' },
  failed: { key: 'importStatusFailed', tone: 'text-red-600' },
};
// A status that the page does not know shows as it is, as an error
const importStatusOf = (status) =>
  IMPORT_STATUSES[status] || { key: status, tone: IMPORT_STATUSES.failed.tone };

/**
 * The name of the status of an import, as the import history shows it, and sorts it by (#146).
 * @param {string} status - How the import ended, or 'running'
 * @param {function(string): string} t
 * @returns {string}
 */
export function importStatusName(status, t) {
  return t(importStatusOf(status).key);
}

/**
 * The status of an import in its colour, with why it failed or ended partial over it, which
 * names the accounts that failed (#113).
 * @param {object} props
 * @param {string} props.status - How the import ended, or 'running'
 * @param {?string} [props.error] - Why it failed or ended partial
 * @param {function(string): string} props.t
 * @param {React.ReactNode} [props.children] - What it says: the name of the status unless
 *   given, such as when the footer says when an account's last import failed (#124)
 * @returns {JSX.Element}
 */
export function ImportStatus({ status, error, t, children }) {
  const { tone } = importStatusOf(status);
  return (
    <span className={tone} title={error || undefined}>
      {children ?? importStatusName(status, t)}
    </span>
  );
}
