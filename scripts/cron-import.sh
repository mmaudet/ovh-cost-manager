#!/bin/sh
# cron-import.sh — Periodic differential import for OVH Cost Manager
#
# Runs a differential import every IMPORT_INTERVAL seconds (default: 86400 = 24h).
# On first run, if the database has no bills, performs a full import instead.
# A full import clears the imported data, so it never runs when the bills
# cannot be counted: a differential import runs instead.
#
# Environment variables:
#   IMPORT_INTERVAL  — Seconds between imports (default: 86400)
#   IMPORT_FLAGS     — Extra flags passed to import.js (default: --all)
#   IMPORT_ENABLED   — Set to "false", in any case, to disable automatic imports

set -e

# Whether to import, and the choice of the first import, shared with their test
# shellcheck source-path=SCRIPTDIR source=import-decision.sh disable=SC1091
. /app/scripts/import-decision.sh

INTERVAL="${IMPORT_INTERVAL:-86400}"
FLAGS="${IMPORT_FLAGS:---all}"

log() {
  echo "[cron-import] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"
}

# Run import.js in the given mode (--full or --diff) with IMPORT_FLAGS
run_import() {
  # IMPORT_FLAGS may hold several flags: split it on purpose
  # shellcheck disable=SC2086
  node /app/data/import.js "$1" $FLAGS 2>&1 | while read -r line; do log "$line"; done
}

if ! ENABLED=$(imports_enabled "$IMPORT_ENABLED"); then
  log "IMPORT_ENABLED must be true or false, not \"$IMPORT_ENABLED\": no automatic import"
  exit 1
fi
if [ "$ENABLED" = "false" ]; then
  log "Automatic imports disabled (IMPORT_ENABLED=$IMPORT_ENABLED)"
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

# Count the bills in the database itself: the API needs a login once
# authentication is on. import-decision.sh picks the first import from it.
# The errors of the count come with its output, to go through log; Node's
# warnings are silenced, as they would mix with the count.
COUNT_STATUS=0
COUNT_OUTPUT=$(node --no-warnings /app/data/count-bills.js 2>&1) || COUNT_STATUS=$?

case "$(first_import_mode "$COUNT_STATUS" "$COUNT_OUTPUT")" in
  full)
    log "No existing data found — running full import"
    run_import --full
    log "Full import completed"
    ;;
  none)
    log "Existing data found ($COUNT_OUTPUT bills) — skipping initial import"
    ;;
  *)
    if [ -n "$COUNT_OUTPUT" ]; then
      printf '%s\n' "$COUNT_OUTPUT" | while read -r line; do log "$line"; done
    fi
    log "Could not count the bills in the database (exit status $COUNT_STATUS)" \
      "— running differential import"
    run_import --diff
    log "Differential import completed"
    ;;
esac

# Periodic differential imports
while true; do
  log "Next import in ${INTERVAL}s"
  sleep "$INTERVAL"

  log "Starting differential import"
  run_import --diff
  log "Differential import completed"
done
