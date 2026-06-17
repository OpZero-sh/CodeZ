#!/usr/bin/env bash
set -euo pipefail

# sync-from-codezero.sh — One-way deterministic export of the private source
# repo (CodeZero) into this public distribution repo (CodeZ).
#
# CodeZero is the SOURCE OF TRUTH. CodeZ is a DISTRIBUTION surface. Development
# happens in CodeZero; this script lands those changes into CodeZ so the two
# stop drifting and never need another manual force-sync.
#
# The export is git-driven: it copies only files git tracks in the source,
# applies an explicit exclude list (private/source-only paths), preserves a
# protected set of distro-only files, and renames the agent doc. It writes the
# distribution-pinned package.json instead of the source's file:-linked one.
#
# Idempotent: re-running with no upstream change produces no diff. It edits the
# working tree only — it does NOT commit, push, or publish. Review with
# `git -C <CodeZ> diff` and commit yourself.
#
# Usage:
#   scripts/sync-from-codezero.sh [--source <path>] [--check]
#
#   --source <path>   Path to the CodeZero checkout.
#                     Default: $CODEZERO_SOURCE, else ../CodeZero relative to
#                     this repo root.
#   --check           Dry run: report what would change and exit non-zero if
#                     the working tree would be modified. Used by CI.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISTRO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_ROOT="${CODEZERO_SOURCE:-}"
CHECK_ONLY=0

while [ $# -gt 0 ]; do
    case "$1" in
        --source)
            SOURCE_ROOT="$2"
            shift 2
            ;;
        --check)
            CHECK_ONLY=1
            shift
            ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "error: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [ -z "${SOURCE_ROOT}" ]; then
    SOURCE_ROOT="$(cd "${DISTRO_ROOT}/../CodeZero" 2>/dev/null && pwd || true)"
fi

if [ -z "${SOURCE_ROOT}" ] || [ ! -d "${SOURCE_ROOT}/.git" ]; then
    echo "error: CodeZero source not found. Pass --source <path> or set" >&2
    echo "       CODEZERO_SOURCE. (looked for ../CodeZero next to ${DISTRO_ROOT})" >&2
    exit 1
fi

SOURCE_ROOT="$(cd "${SOURCE_ROOT}" && pwd)"

if [ "${SOURCE_ROOT}" = "${DISTRO_ROOT}" ]; then
    echo "error: source and distro are the same directory; refusing to run." >&2
    exit 1
fi

echo "source (CodeZero): ${SOURCE_ROOT}"
echo "distro (CodeZ):    ${DISTRO_ROOT}"

# --- Export rules ---------------------------------------------------------
#
# EXCLUDE: private or source-only paths that must never reach the public
# distro. Matched against the source's git-tracked paths (prefix or glob).
# Keep this list in sync with what the manual "sync from CodeZero" commits
# historically left out.
EXCLUDES=(
    ".env"                              # local secrets (distro ships .env.example)
    "RUNBOOK.md"                        # private operator runbook
    "docs/research/"                    # internal research notes
    "docs/superpowers/"                 # internal design specs
    "docs/channel-e2e-report.md"        # internal QA report
    "docs/plan-"                        # internal planning docs (docs/plan-*.md)
    ".agent-log/"                       # agent transcripts
    ".claude/agents/codezero.md"        # renamed below to codez.md
)

# PROTECT: distro-only files that live in CodeZ but not in CodeZero. The export
# must never delete or overwrite these.
PROTECTED=(
    "LICENSE"
    ".env.example"
    ".gitignore"                        # distro variant ignores .logs/.agent-log
    "package.json"                      # distro name + registry-pinned hub client
    "bun.lock"                          # regenerated from the distro package.json
    ".claude/agents/codez.md"           # renamed target of codezero.md
)
# -------------------------------------------------------------------------

is_protected() {
    local path="$1"
    for p in "${PROTECTED[@]}"; do
        [ "${path}" = "${p}" ] && return 0
    done
    return 1
}

is_excluded() {
    local path="$1"
    for e in "${EXCLUDES[@]}"; do
        case "${e}" in
            */) [ "${path}" = "${e%/}" ] || case "${path}" in "${e}"*) return 0;; esac ;;
            *)  [ "${path}" = "${e}" ] && return 0 ;;
        esac
    done
    return 1
}

# Stage the export in a temp dir, then move into place atomically per-file so a
# mid-run failure can't leave the distro half-written.
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

copied=0
skipped=0

# git ls-files (NUL-delimited) is the deterministic source manifest: only
# tracked files, no node_modules / web/dist / .DS_Store, stable ordering.
while IFS= read -r -d '' rel; do
    if is_excluded "${rel}"; then
        skipped=$((skipped + 1))
        continue
    fi
    if is_protected "${rel}"; then
        # never let the source overwrite a distro-owned file
        skipped=$((skipped + 1))
        continue
    fi
    mkdir -p "${STAGE}/$(dirname "${rel}")"
    cp -p "${SOURCE_ROOT}/${rel}" "${STAGE}/${rel}"
    copied=$((copied + 1))
done < <(git -C "${SOURCE_ROOT}" ls-files -z)

# Rename: the source ships .claude/agents/codezero.md; the distro ships it as
# codez.md (product-name rebrand, one-time and stable).
if [ -f "${SOURCE_ROOT}/.claude/agents/codezero.md" ]; then
    mkdir -p "${STAGE}/.claude/agents"
    cp -p "${SOURCE_ROOT}/.claude/agents/codezero.md" "${STAGE}/.claude/agents/codez.md"
    copied=$((copied + 1))
fi

echo "staged ${copied} file(s); skipped ${skipped} excluded/protected"

# Build the distribution package.json from the source's, overriding only the
# package name and the hub-client dependency (file: link -> registry pin).
# Requires node, which is always present alongside bun in this toolchain.
PKG_VERSION="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1]+"/codez-hub/packages/client/package.json","utf8")||"{}");process.stdout.write(p.version||"0.1.0")' "$(cd "${SOURCE_ROOT}/.." && pwd)" 2>/dev/null || echo "0.1.0")"

node - "${SOURCE_ROOT}/package.json" "${DISTRO_ROOT}/package.json" "${STAGE}/package.json" "${PKG_VERSION}" <<'NODE'
const fs = require("fs");
const [, , srcPath, distroPath, outPath, hubVersion] = process.argv;
const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const distro = JSON.parse(fs.readFileSync(distroPath, "utf8"));

// Carry the source's scripts/deps/config forward, but keep the distribution
// identity: public package name and a registry-pinned hub client instead of
// the monorepo file: link.
const out = { ...src };
out.name = distro.name;            // opzero-claude (public identity, unchanged)
out.bin = distro.bin ?? src.bin;

out.dependencies = { ...(src.dependencies || {}) };
if (out.dependencies["@opzero/codez-hub-client"]) {
  out.dependencies["@opzero/codez-hub-client"] = `^${hubVersion}`;
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
NODE

# Apply the staged tree onto the distro working tree.
if [ "${CHECK_ONLY}" -eq 1 ]; then
    changed=0
    while IFS= read -r -d '' f; do
        rel="${f#"${STAGE}/"}"
        if ! cmp -s "${f}" "${DISTRO_ROOT}/${rel}" 2>/dev/null; then
            echo "would update: ${rel}"
            changed=$((changed + 1))
        fi
    done < <(find "${STAGE}" -type f -print0)
    if [ "${changed}" -gt 0 ]; then
        echo "check: ${changed} file(s) would change — distro is behind source." >&2
        exit 1
    fi
    echo "check: distro is in sync with source."
    exit 0
fi

applied=0
while IFS= read -r -d '' f; do
    rel="${f#"${STAGE}/"}"
    dest="${DISTRO_ROOT}/${rel}"
    if cmp -s "${f}" "${dest}" 2>/dev/null; then
        continue
    fi
    mkdir -p "$(dirname "${dest}")"
    cp -p "${f}" "${dest}"
    applied=$((applied + 1))
done < <(find "${STAGE}" -type f -print0)

echo
echo "applied ${applied} change(s) to ${DISTRO_ROOT}"
echo "next:"
echo "  git -C \"${DISTRO_ROOT}\" status"
echo "  git -C \"${DISTRO_ROOT}\" diff"
echo "  # then 'bun install' to refresh bun.lock for the pinned hub client,"
echo "  # review, and commit. This script never commits or pushes."
