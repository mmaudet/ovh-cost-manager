# shellcheck shell=sh
# import-decision.sh — The import that cron-import.sh runs when the container starts
#
# Sourced by cron-import.sh, and by its test (tests/import-decision.test.js).

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
