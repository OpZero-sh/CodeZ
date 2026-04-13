#!/usr/bin/env bash
set -euo pipefail

# launch-opzero.sh — spawn `claude` with the opzero-channel MCP plugin loaded.
#
# Wires up the Channels research-preview so messages sent from the opzero-claude
# web UI are injected into this terminal's claude session.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}"
PLUGIN_PATH="${PROJECT_ROOT}/packages/opzero-channel/index.ts"

CWD="$(pwd)"
MODEL=""
SESSION_ID=""
PASSTHROUGH=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd)
      CWD="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --session-id)
      SESSION_ID="$2"
      shift 2
      ;;
    --)
      shift
      PASSTHROUGH=("$@")
      break
      ;;
    -h|--help)
      cat <<EOF
Usage: launch-opzero.sh [--cwd DIR] [--model MODEL] [--session-id UUID] [-- <extra claude args>]

Spawns the claude CLI with the opzero-channel MCP plugin loaded so the
opzero-claude web UI can inject messages into this session.

Options:
  --cwd DIR          working directory to run claude in (default: current)
  --model MODEL      model passed through to claude --model
  --session-id UUID  fixed session id (default: generated via uuidgen)
  --                 pass remaining args through to claude verbatim
EOF
      exit 0
      ;;
    *)
      PASSTHROUGH+=("$1")
      shift
      ;;
  esac
done

if [[ ! -f "${PLUGIN_PATH}" ]]; then
  echo "[opzero-claude] error: plugin not found at ${PLUGIN_PATH}" >&2
  echo "[opzero-claude] build packages/opzero-channel/index.ts first" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[opzero-claude] error: 'bun' not found in PATH" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "[opzero-claude] error: 'claude' not found in PATH" >&2
  exit 1
fi

if [[ -z "${SESSION_ID}" ]]; then
  if command -v uuidgen >/dev/null 2>&1; then
    SESSION_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  else
    SESSION_ID="$(bun -e 'process.stdout.write(crypto.randomUUID())')"
  fi
fi

MCP_JSON="{\"mcpServers\":{\"opzero-channel\":{\"command\":\"bun\",\"args\":[\"${PLUGIN_PATH}\"]}}}"

export OPZERO_CHANNEL_SESSION_ID="${SESSION_ID}"

if [[ ! -d "${CWD}" ]]; then
  echo "[opzero-claude] error: cwd does not exist: ${CWD}" >&2
  exit 1
fi
cd "${CWD}"

echo "[opzero-claude] launching claude with channel; session_id=${SESSION_ID} cwd=${CWD}" >&2

CLAUDE_ARGS=(
  --session-id "${SESSION_ID}"
  --mcp-config "${MCP_JSON}"
  --dangerously-load-development-channels "server:opzero-channel"
)

if [[ -n "${MODEL}" ]]; then
  CLAUDE_ARGS+=(--model "${MODEL}")
fi

if [[ ${#PASSTHROUGH[@]} -gt 0 ]]; then
  CLAUDE_ARGS+=("${PASSTHROUGH[@]}")
fi

exec claude "${CLAUDE_ARGS[@]}"
