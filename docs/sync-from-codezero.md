# Syncing from CodeZero

CodeZero is the **source of truth** (private, where development happens).
CodeZ is a **distribution surface** (this public repo). Code flows one way:
CodeZero → CodeZ. It never flows back.

The two repos drifted once and were force-synced as a one-time cleanup. That
force-sync is **not** the model. `scripts/sync-from-codezero.sh` replaces it
with a deterministic, idempotent export so the repos stop diverging and never
need another manual reconciliation.

## What the export does

The export is git-driven. It reads the source's `git ls-files` manifest (only
tracked files — no `node_modules`, no `web/dist`, no `.DS_Store`), applies an
explicit exclude list, preserves distro-only files, and writes a
distribution-pinned `package.json`.

**Excluded** (private / source-only, never reaches the public repo):

| Path | Why |
|------|-----|
| `.env` | local secrets (distro ships `.env.example`) |
| `RUNBOOK.md` | private operator runbook |
| `docs/research/` | internal research notes |
| `docs/superpowers/` | internal design specs |
| `docs/channel-e2e-report.md` | internal QA report |
| `docs/plan-*.md` | internal planning docs |
| `.agent-log/` | agent transcripts |

**Preserved** (distro-only — the export never deletes or overwrites these):

`LICENSE`, `.env.example`, `.gitignore` (distro variant), `package.json`,
`bun.lock`.

**Renamed**: `.claude/agents/codezero.md` → `.claude/agents/codez.md`.

**`package.json`**: the source's scripts and dependencies carry forward, but
the public package name (`opzero-claude`) is kept and the
`@opzero/codez-hub-client` dependency is changed from the monorepo `file:` link
to a registry pin (`^<version>`). See "Hub client pinning" below.

The exclude / preserve / rename lists live at the top of the script
(`EXCLUDES` and `PROTECTED`). Keep them in sync with what should and should not
ship publicly.

## Running it

```bash
# From the CodeZ repo root. Auto-detects ../CodeZero, or pass --source.
./scripts/sync-from-codezero.sh
./scripts/sync-from-codezero.sh --source /path/to/CodeZero
CODEZERO_SOURCE=/path/to/CodeZero ./scripts/sync-from-codezero.sh

# Dry run — report drift, exit non-zero if behind (used by CI):
./scripts/sync-from-codezero.sh --check
```

The script edits the working tree only. It never commits, pushes, or
publishes. After running:

```bash
git status
git diff
bun install      # refresh bun.lock for the registry-pinned hub client
# review, then commit
```

Re-running with no upstream change produces no diff (idempotent).

## CI

`.github/workflows/sync-from-codezero.yml` has two jobs:

- **drift-check** — on every push/PR to `main`, runs the export in `--check`
  mode and fails if CodeZ has fallen behind CodeZero. This is the guard that
  stops the repos from silently diverging again.
- **sync** — manual (`workflow_dispatch`). Runs the export and opens a
  `sync/from-codezero` PR with the result. Never commits to `main` directly.

Both jobs check out CodeZero read-only. Because CodeZero is private, the
default `GITHUB_TOKEN` cannot read it — provide a token with read access to
`OpZero-sh/CodeZero` as the **`CODEZERO_RO_TOKEN`** repo secret. When the
secret is absent (forks), the drift check skips instead of failing.

## Hub client pinning

CodeZero develops against the hub client via a monorepo `file:` link
(`file:../codez-hub/packages/client`), which ties the checkout to a sibling
directory. The distro must not depend on a sibling checkout, so CodeZ pins the
published registry version instead:

```json
"@opzero/codez-hub-client": "^0.1.0"
```

The package is published to npm by
[`codez-hub`](https://github.com/OpZero-sh/codez-hub)'s
`.github/workflows/publish-client.yml` (on `client-v*` tags or manual
dispatch). When the hub client gets a new release, bump the pin here (or let
the next export carry the new version forward) and run `bun install`.
