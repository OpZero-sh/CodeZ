#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME:-/root}/.config/opzero-claude"

# First boot: run codez setup without starting the server or installing autostart.
if [ -z "$(ls -A "${CONFIG_DIR}" 2>/dev/null || true)" ]; then
    echo "[docker-entry] first boot: running codez setup --no-start --skip-autostart"
    bun run /app/bin/cli.ts setup --no-start --skip-autostart || {
        echo "[docker-entry] setup failed; continuing to server start" >&2
    }
fi

exec bun run /app/server/index.ts
