# shellcheck shell=sh
# import-decision.sh — Whether cron-import.sh imports, and the import it runs when the
# container starts
#
# Sourced by cron-import.sh, and by its test (tests/import-decision.test.js).

# Print whether the periodic imports run, from IMPORT_ENABLED ($1), as the server reads
# it (server/imports.js): true or false, in any case, and true when empty. Fail on any
# other value, which stops the server too.
imports_enabled() {
  case "${1:-true}" in
    [Tt][Rr][Uu][Ee]) echo true ;;
    [Ff][Aa][Ll][Ss][Ee]) echo false ;;
    *) return 1 ;;
  esac
}

# Print the import to run at start, from the exit status ($1) and the output
# ($2) of data/count-bills.js, which counts the bills in the database:
#   full — the count succeeded and printed 0: the database has no bill
#   none — the count succeeded and printed another number
#   diff — anything else. A full import clears the imported data, so it never
#          follows a count that failed. A differential import does not clear
#          the database, and on an empty one it imports every bill all the
#          same. With --all, it still refreshes the current month's
#          consumption and the cloud tables, as every periodic run does.
first_import_mode() {
  if [ "$1" != 0 ]; then
    echo diff
    return
  fi
  case "$2" in
    0) echo full ;;
    '' | *[!0-9]*) echo diff ;;
    *) echo none ;;
  esac
}
