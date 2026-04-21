#!/usr/bin/env bash
set -euo pipefail

# install-systemd.sh — Install a user-scoped systemd service so the Bun
# server auto-starts on Linux login and restarts on crash. Idempotent.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UNIT_NAME="codez.service"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_DEST="${UNIT_DIR}/${UNIT_NAME}"

if ! BUN_BIN="$(command -v bun)"; then
    echo "error: 'bun' not found in PATH. Install Bun (https://bun.sh) first." >&2
    exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
    echo "error: systemctl not available; skipping systemd install." >&2
    exit 1
fi

echo "PROJECT_ROOT: ${PROJECT_ROOT}"
echo "BUN_BIN:      ${BUN_BIN}"

mkdir -p "${UNIT_DIR}"
mkdir -p "${PROJECT_ROOT}/.logs"

cat > "${UNIT_DEST}" <<UNIT
[Unit]
Description=CodeZ / opzero-code server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${BUN_BIN} run ${PROJECT_ROOT}/server/index.ts
Restart=on-failure
RestartSec=3
StandardOutput=append:${PROJECT_ROOT}/.logs/server.out.log
StandardError=append:${PROJECT_ROOT}/.logs/server.err.log
Environment=PATH=${PATH}

[Install]
WantedBy=default.target
UNIT

echo "Wrote ${UNIT_DEST}"

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_NAME}"

echo
echo "Installed. Use 'systemctl --user status ${UNIT_NAME}' for status."
