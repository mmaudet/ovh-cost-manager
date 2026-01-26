#!/bin/sh
# cron-import.sh — Periodic differential import for OVH Cost Manager
#
# Runs a differential import every IMPORT_INTERVAL seconds (default: 86400 = 24h).
# On first run, if the database has no bills, performs a full import instead.
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

if [ "$ENABLED" = "false" ]; then
  log "Automatic imports disabled (IMPORT_ENABLED=false)"
  exit 0
fi

log "Starting periodic import (interval: ${INTERVAL}s, flags: ${FLAGS})"

# Wait for the server to be ready before first import
log "Waiting for server to be ready..."
until wget -q --spider http://localhost:3001/api/health 2>/dev/null; do
  sleep 5
done
log "Server is ready"

# Check if this is a fresh database (no bills yet)
BILL_COUNT=$(wget -qO- http://localhost:3001/api/months 2>/dev/null | grep -c '"value"' 2>/dev/null || echo "0")

if [ "$BILL_COUNT" -eq 0 ]; then
  log "No existing data found — running full import"
  node /app/data/import.js --full $FLAGS 2>&1 | while read -r line; do log "$line"; done
  log "Full import completed"
else
  log "Existing data found ($BILL_COUNT months) — skipping initial import"
fi

# Periodic differential imports
while true; do
  log "Next import in ${INTERVAL}s"
  sleep "$INTERVAL"

  log "Starting differential import"
  node /app/data/import.js --diff $FLAGS 2>&1 | while read -r line; do log "$line"; done
  log "Differential import completed"
done
