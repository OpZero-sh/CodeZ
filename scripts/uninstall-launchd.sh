#!/usr/bin/env bash
set -euo pipefail

# uninstall-launchd.sh — Remove the opzero-claude LaunchAgent.

LABEL="sh.opzero.claude"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
SERVICE_TARGET="gui/${UID_NUM}/${LABEL}"

# Bootout the agent (ignore error if it's not currently loaded).
launchctl bootout "${SERVICE_TARGET}" 2>/dev/null || true

# Remove the plist from disk.
rm -f "${PLIST_DEST}"

echo "Uninstalled."
