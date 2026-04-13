#!/usr/bin/env bash
set -euo pipefail

# install-launchd.sh — Install the opzero-claude LaunchAgent so the Bun
# server auto-starts on macOS login and restarts on crash.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/sh.opzero.claude.plist.template"
LABEL="sh.opzero.claude"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN_TARGET="gui/${UID_NUM}"
SERVICE_TARGET="${DOMAIN_TARGET}/${LABEL}"

# 1. Sanity-check the template exists
if [[ ! -f "${TEMPLATE}" ]]; then
    echo "error: template not found at ${TEMPLATE}" >&2
    exit 1
fi

# 2. Locate bun
if ! BUN_BIN="$(command -v bun)"; then
    echo "error: 'bun' not found in PATH. Install Bun (https://bun.sh) and" >&2
    echo "       ensure it is on your PATH before running this script." >&2
    exit 1
fi

echo "PROJECT_ROOT: ${PROJECT_ROOT}"
echo "BUN_BIN:      ${BUN_BIN}"

# 3. Ensure log directory exists
mkdir -p "${PROJECT_ROOT}/.logs"

# 4. Ensure LaunchAgents directory exists
mkdir -p "${HOME}/Library/LaunchAgents"

# 5. Substitute placeholders and write the plist
#    Use '|' as sed delimiter because paths contain '/'.
sed \
    -e "s|{{PROJECT_ROOT}}|${PROJECT_ROOT}|g" \
    -e "s|{{BUN_BIN}}|${BUN_BIN}|g" \
    "${TEMPLATE}" > "${PLIST_DEST}"

echo "Wrote ${PLIST_DEST}"

# 6. If it's already loaded, bootout first so bootstrap picks up changes
if launchctl print "${SERVICE_TARGET}" >/dev/null 2>&1; then
    echo "Service already loaded; booting out first..."
    launchctl bootout "${SERVICE_TARGET}" 2>/dev/null || true
fi

# 7. Bootstrap the agent into the user's gui domain
launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_DEST}"

# 8. Force-start it now
launchctl kickstart -k "${SERVICE_TARGET}"

echo
echo "Installed. Server will auto-start on login. Use ./scripts/uninstall-launchd.sh to remove."
echo
echo "Current status:"
launchctl print "${SERVICE_TARGET}" 2>/dev/null | head -20 || true
