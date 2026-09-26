#!/bin/sh
# cron-import.sh — Periodic differential import for OVH Cost Manager
#
# Runs a differential import every IMPORT_INTERVAL seconds (default: 86400 = 24h).
# On first run, if the database has no bills, performs a full import instead.
# A full import clears the database, so it never runs when the bills cannot be
# counted: a differential import runs instead.
#
# Environment variables:
#   IMPORT_INTERVAL  — Seconds between imports (default: 86400)
#   IMPORT_FLAGS     — Extra flags passed to import.js (default: --all)
#   IMPORT_ENABLED   — Set to "false" to disable automatic imports

set -e

INTERVAL="${IMPORT_INTERVAL:-86400}"
FLAGS="${IMPORT_FLAGS:---all}"
ENABLED="${IMPORT_ENABLED:-true}"

log() {
  echo "[cron-import] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"
}

# Run import.js in the given mode (--full or --diff) with IMPORT_FLAGS
run_import() {
  # IMPORT_FLAGS may hold several flags: split it on purpose
  # shellcheck disable=SC2086
  node /app/data/import.js "$1" $FLAGS 2>&1 | while read -r line; do log "$line"; done
}

# Print the number of bills, read from the database itself: the API needs a
# login once authentication is on. Fail on anything but a number.
count_bills() {
  count=$(node /app/data/count-bills.js) || return 1
  case "$count" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo "$count"
}

# The import at start: full on a database without bills, none when it has
# some. When the count fails, differential: it deletes nothing, and on an
# empty database it imports every bill all the same.
first_import() {
  if ! BILL_COUNT=$(count_bills); then
    log "Could not count the bills in the database — running differential import"
    run_import --diff
    log "Differential import completed"
  elif [ "$BILL_COUNT" -eq 0 ]; then
    log "No existing data found — running full import"
    run_import --full
    log "Full import completed"
  else
    log "Existing data found ($BILL_COUNT bills) — skipping initial import"
  fi
}

# The tests source this file for its functions only
if [ "${CRON_IMPORT_SOURCED:-}" = 1 ]; then
  return 0
fi

if [ "$ENABLED" = "false" ]; then
  log "Automatic imports disabled (IMPORT_ENABLED=false)"
  exit 0
fi

log "Starting periodic import (interval: ${INTERVAL}s, flags: ${FLAGS})"

# Wait for the server to be ready before first import (/api/health needs no
# login, with or without authentication)
log "Waiting for server to be ready..."
until wget -q --spider http://localhost:3001/api/health 2>/dev/null; do
  sleep 5
done
log "Server is ready"

first_import

# Periodic differential imports
while true; do
  log "Next import in ${INTERVAL}s"
  sleep "$INTERVAL"

  log "Starting differential import"
  run_import --diff
  log "Differential import completed"
done
