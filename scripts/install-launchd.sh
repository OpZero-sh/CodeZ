#!/usr/bin/env bash
set -euo pipefail

# install-launchd.sh — Install the opzero-claude LaunchAgent so the Bun
# server auto-starts on macOS login and restarts on crash.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN_TARGET="gui/${UID_NUM}"

SERVICES=(
    "sh.opzero.claude:sh.opzero.claude.plist.template"
    "sh.opzero.claude.mcp:sh.opzero.claude.mcp.plist.template"
)

# 1. Locate bun
if ! BUN_BIN="$(command -v bun)"; then
    echo "error: 'bun' not found in PATH. Install Bun (https://bun.sh) and" >&2
    echo "       ensure it is on your PATH before running this script." >&2
    exit 1
fi

echo "PROJECT_ROOT: ${PROJECT_ROOT}"
echo "BUN_BIN:      ${BUN_BIN}"
echo "HOME:         ${HOME}"

# 2. Ensure directories exist
mkdir -p "${PROJECT_ROOT}/.logs"
mkdir -p "${HOME}/Library/LaunchAgents"

# 3. Install each service
for entry in "${SERVICES[@]}"; do
    LABEL="${entry%%:*}"
    TEMPLATE_NAME="${entry##*:}"
    TEMPLATE="${SCRIPT_DIR}/${TEMPLATE_NAME}"
    PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
    SERVICE_TARGET="${DOMAIN_TARGET}/${LABEL}"

    if [[ ! -f "${TEMPLATE}" ]]; then
        echo "warning: template not found at ${TEMPLATE}, skipping ${LABEL}" >&2
        continue
    fi

    sed \
        -e "s|{{PROJECT_ROOT}}|${PROJECT_ROOT}|g" \
        -e "s|{{BUN_BIN}}|${BUN_BIN}|g" \
        -e "s|{{HOME}}|${HOME}|g" \
        "${TEMPLATE}" > "${PLIST_DEST}"

    echo "Wrote ${PLIST_DEST}"

    if launchctl print "${SERVICE_TARGET}" >/dev/null 2>&1; then
        echo "  ${LABEL} already loaded; booting out first..."
        launchctl bootout "${SERVICE_TARGET}" 2>/dev/null || true
    fi

    launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_DEST}"
    launchctl kickstart -k "${SERVICE_TARGET}"
    echo "  ${LABEL} started"
done

echo
echo "Installed. Services will auto-start on login. Use ./scripts/uninstall-launchd.sh to remove."
