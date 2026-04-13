# CodeZ — Agent Operating Guide

This file is the operating manual for any agent (subagent, orchestrator, or future-Claude-session)
working in this codebase. It supplements `CLAUDE.md` (architecture) and `Roadmap.md`
(current priorities). Read this before starting any task.

---

## Running the app

```bash
bun run dev          # server on :4097, Vite on :5173
bun run build        # tsc --noEmit + vite build → web/dist
bun run start        # production server on :4097
bun run typecheck    # server tsc --noEmit
cd web && bunx tsc --noEmit  # client tsc
```

For browser testing: use agent-browser at iPhone 15 Pro Max viewport (430x932).

## How to test a change

1. `bun run build`
2. `bun run typecheck && cd web && bunx tsc --noEmit`
3. `kill $(lsof -nP -iTCP:4097 -sTCP:LISTEN -t)` to stop the running server
4. `bun run start` to start fresh (your new code is in web/dist)
5. `agent-browser` verification

For auth-gated browser testing: the server has `loopbackBypass: true` by default.
For full auth bypass, temporarily switch `~/.config/opzero-claude/config.json` to
plaintext password (`"password": "testpass"` instead of bcrypt hash), restart server,
log in via curl, extract JWT cookie, load into agent-browser state, restore bcrypt
config, restart server.

## Roadmap priorities

See `Roadmap.md`. The orchestrator works in waves:

- **Shipped**: marked `[SHIPPED]` in `Roadmap.md`
- **Rejected**: marked `[REJECTED]` with reason in `Roadmap.md`
- **In progress**: ask orchestrator or check active task
- **Next**: top of the open list

## Swarm conventions

### File partitioning
Each agent gets **exclusive ownership** of a file set. No two agents touch the same
file unless explicitly coordinated. Before dispatching, the orchestrator scouts each
item to identify conflicts.

### What agents can touch
- Own files only
- New files in their owned directories
- No changes to `server/types.ts` / `web/src/lib/types.ts` without the orchestrator
  coordinating both sides (types must stay in sync)

### What agents cannot do
- `git add .` or `git commit`
- Touch files in sibling OpZero repos
- Remove emojis or add them
- Change the package name `opzero-claude`
- Add new npm dependencies without checking `package.json` first

### Verification
After implementing, agents must run:
- `bun run typecheck` at repo root
- `cd web && bunx tsc --noEmit`
- `bun run build` (if web files changed)

## Key patterns

### Store mutations (IMPORTANT)
Never mutate `state` directly. Always rebuild the top-level object:

```ts
// WRONG — React won't re-render
state.foo = bar;
emit();

// RIGHT — immutable update
setState({ ...state, foo: bar });
```

### Adding SSE events
1. Add variant to `SSEEvent` in both `server/types.ts` AND `web/src/lib/types.ts`
2. Emit from server (usually `SessionProcess` or `SessionTailer`)
3. Handle in `web/src/lib/store.ts::dispatch`
4. If it mutates messages, add a reducer in `web/src/lib/parts.ts`

### Adding API routes
1. Add handler in `server/routes/*.ts`
2. Wire into `server/index.ts::fetch`
3. Add path to public-paths in `server/auth.ts` if unauthed access is needed
4. Add client wrapper in `web/src/lib/api.ts`
5. Add types to `server/types.ts` and `web/src/lib/types.ts`

### Adding a new tool renderer
1. Create `web/src/components/parts/XyzToolView.tsx`
2. Add case to `web/src/components/parts/ToolUsePart.tsx` dispatcher
3. Follow existing patterns: `border-l-2 border-l-accent` for subagent tools,
   `border-l-2 border-l-primary` for regular tools. Cyan pulse for running,
   violet accent for results.

### Permission mode flag logic
The CLI flag for permission behavior is conditional:
- `permissionMode === "bypassPermissions"` → `--dangerously-skip-permissions`
- `permissionMode` is set → `--permission-mode <val>`
- `permissionMode` is blank → omit both (claude default)

Never add `--dangerously-skip-permissions` alongside `--permission-mode`.

### Project slug derivation
Use `encodeProjectSlug(cwd)` from `server/claude/paths.ts`. Never hardcode or
manually construct slugs. The encoder handles encoding all special chars.

## Stream-json vs JSONL

**Stream-json** = stdout from `claude -p --output-format stream-json`. Used by
`SessionProcess` for live sessions. Emits result/cost records.

**JSONL** = `~/.claude/projects/<slug>/<id>.jsonl`. Appended by Claude Code
for all sessions. Used by `SessionTailer` for mirror sessions and `history.ts`
for historical reads. Does NOT carry cost/result records.

Never mix these formats.

## Auth providers

Two providers are shipped:
- `createCookieAuthProvider(config)` — default, JWT cookie
- `createCloudflareAccessAuthProvider(config)` — set `"authProvider": "cf-access"` in config

To add a new provider: implement `AuthProvider` interface in `server/auth.ts`, wire
in `server/index.ts`. The interface is:
```ts
interface AuthProvider {
  name: string;
  verify(req: Request): Promise<{ok: true; user: {sub: string}} | {ok: false}>;
  loginUrl?: string;
  logoutUrl?: string;
}
```

## Agent log

The orchestrator maintains `.agent-log/` with per-wave entries covering:
- Decisions and why
- Challenges encountered
- Files changed
- Shipped items

Read the most recent log before starting new work to avoid repeating mistakes.

## Research docs

`docs/research/` contains backgrounders on features under investigation:
- `kairos.md` — not shipped, compile-time stripped
- `ultraplan.md` — internal-only, not wrapable
- `voice_mode.md` — no native Claude Code primitive, implemented via Web Speech API
- `daemon.md` — KAIROS rename, not shipped
- `agent_triggers.md` — cron scheduling, undocumented
- `bridge_monitor.md` — BRIDGE_MODE is Remote Control (not applicable), MONITOR_TOOL shipped v2.1.98+
- `buddy.md` — real Tamagotchi, not externally scriptable
- `auto_dream.md` — memory consolidation, read-access straightforward

## Common pitfalls

1. **Browser test auth**: loopback bypass is on by default; for full auth testing,
   see the testing pattern in "How to test a change" above.
2. **JSONL has no cost data**: mirror sessions show $0 cost. This is correct — the
   JSONL format doesn't carry result records.
3. **Fork session**: blocked. `claude --fork-session` can return a new session ID
   at `system.init` time. The current architecture keys on the spawn-time ID.
4. **Subagent streaming**: blocked. Requires channels in subagent subprocesses.
5. **Bun.serve idleTimeout**: must be `idleTimeout: 0` for SSE streams. Don't change.

## Links

- Repo: https://github.com/OpZero-sh/CodeZ
- Docs: see `docs/` directory and `CLAUDE.md`
