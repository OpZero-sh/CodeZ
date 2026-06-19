#!/usr/bin/env bash
set -euo pipefail

# uninstall-launchd.sh — Remove the opzero-claude LaunchAgent.

UID_NUM="$(id -u)"

LABELS=("sh.opzero.claude" "sh.opzero.claude.mcp")

for LABEL in "${LABELS[@]}"; do
    PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
    SERVICE_TARGET="gui/${UID_NUM}/${LABEL}"

    launchctl bootout "${SERVICE_TARGET}" 2>/dev/null || true
    rm -f "${PLIST_DEST}"
    echo "Uninstalled ${LABEL}"
done
