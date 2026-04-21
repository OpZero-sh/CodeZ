# CodeZ — Project Guide

Product name: **CodeZ**. Package / repo / on-disk name: `opzero-claude`
(unchanged to avoid breaking things — only the UI-visible brand changes).

## Getting started

For fresh installs, run `codez setup`. It handles deps, build, hub auth,
MCP registration, and autostart. The command is idempotent — re-running
after a partial failure picks up where it left off. Config lives at
`~/.config/opzero-code/` on fresh installs; existing users on
`~/.config/opzero-claude/` continue to work unchanged, and
`codez config migrate` performs a non-destructive copy to the new path.

A web UI for driving Claude Code sessions remotely. Single Bun HTTP server
serves a React 19 SPA at `/` and a `/api/*` surface the SPA talks to. The
server spawns the `claude` CLI in stream-json duplex mode for sessions it
owns, and tails `~/.claude/projects/*.jsonl` for sessions it doesn't. Mirrors
opencode's single-server architecture but sits on top of Claude Code instead
of reimplementing it.

## Product purpose

The point is to use Claude Code from a phone (specifically an iPhone 15 Pro
Max) without being tied to a terminal. Secondary goals: see what subagent
teams are doing in real time, start fresh sessions from anywhere, browse
historical sessions, and hand the whole thing off to others as a
distributable app later.

## Architecture at a glance

```
  Browser (React 19 SPA)
       |
       |  HTTPS via Cloudflare tunnel  (codez.yourdomain.com -> 127.0.0.1:4097)
       v
  Bun HTTP server (server/index.ts)
       |
       +-- auth middleware (cookie JWT or Cloudflare Access, pluggable AuthProvider)
       +-- /api/health
       +-- /api/auth/{login,logout,me}
       +-- /api/projects            (list, list-sessions, memory)
       +-- /api/sessions/:id/...   (get, prompt, abort, dispose)
       +-- /api/events             (single SSE multiplexer — all events)
       +-- static /                (serves web/dist)
       |
       +-- EventBus (in-process pub/sub, fans out to SSE subscribers)
       |
       +-- SessionPool
             |
             +-- SessionProcess(id)   <- spawns `claude -p --input-format stream-json ...`
             |     keeps stdin open across turns so the context cache stays warm
             +-- SessionTailer(slug, id)   <- fs.watch on the JSONL file
                   mirrors externally-owned sessions read-only into the bus
```

Every real-time state change flows through the EventBus as a typed
`SSEEvent`. The SPA subscribes once to `/api/events` and dispatches events
into an immutable client store backed by `useSyncExternalStore`.

External agents can also control CodeZ programmatically via the remote
MCP server at `packages/codezero-mcp/`:

```
  External Agent (Claude Code, any MCP client)
       |
       |  MCP Streamable HTTP (POST/GET/DELETE)
       |  http://127.0.0.1:4098/mcp
       v
  codez-mcp (Bun HTTP server, packages/codezero-mcp/index.ts)
       |
       |  HTTP REST (loopback bypass, no auth)
       v
  CodeZ Bun server (127.0.0.1:4097)
```

## Quick commands

From the project root:

```bash
bun install                 # once
cd web && bun install       # web has its own package
bun run dev                 # concurrent server (4097) + vite dev (5173 with /api proxy)
bun run build               # tsc --noEmit + vite build, output at web/dist
bun run start               # production: serves web/dist + API on 4097
bun run typecheck           # server-side tsc --noEmit
cd web && bunx tsc --noEmit # web-side typecheck
```

For a clean local smoke test: `bun run build && bun run start`, then
`curl -s -u user:pass http://127.0.0.1:4097/api/health` (loopback bypass is
on by default so curl without auth also works from the same machine).

## Directory tour

```
opzero-claude/
  package.json          root scripts + server devDeps
  tsconfig.json         server + web unified strict TS config
  bun.lock
  README.md             ultra-short run card — don't bloat it
  CLAUDE.md             you are here
  .gitignore            node_modules, web/dist, .dogfood, .logs, .env

  server/               Bun runtime. No framework — Bun.serve + plain handlers.
    index.ts              entry, wires config + auth + pool + routes + SSE
    config.ts             loads ~/.config/opzero-claude/config.json; first-run
                          bcrypts the generated password and writes authSecret
    auth.ts               AuthProvider interface + createCookieAuthProvider;
                          minimal HS256 JWT via Web Crypto (no JWT lib)
    static.ts             SPA fallback from web/dist
    bus.ts                EventBus — subscribe() + emit()
    types.ts              AUTHORITATIVE types: Session, SessionStatus,
                          SessionMetadata, Part union, Message, SSEEvent
    routes/
      health.ts           GET /api/health
      auth.ts              /api/auth/{login,logout,me} + rate limit
      projects.ts         GET /api/projects, .../:slug/sessions, .../memory
      sessions.ts         GET :id, POST :id/prompt, abort, DELETE,
                          plus POST /api/projects/:slug/sessions (routed here)
      events.ts           GET /api/events — SSE stream
    claude/
      paths.ts            encode/decode project slug + claudeProjectsRoot()
      protocol.ts         stream-json event types + parseLine()
      process.ts          SessionProcess class (spawn, stdin pump,
                          stdout line parser, system.init metadata extraction)
      pool.ts             SessionPool (map of id -> SessionProcess,
                          also holds the tailer map)
      tailer.ts           SessionTailer (fs.watch + polling fallback,
                          emits message.created into the bus for new JSONL lines)
      history.ts          loadSessionMessagesAndMetadata: walks a JSONL file
                          and produces Message[] + SessionMetadata. Expensive
                          on large files — don't call in hot paths.

  web/                  React 19 + Vite + Tailwind v4 (CSS-first)
    package.json          web deps
    vite.config.ts        @tailwindcss/vite, @vitejs/plugin-react, proxy /api -> :4097
    tsconfig.json         @/* -> ./src/*
    index.html            viewport-fit=cover + interactive-widget=resizes-content
    src/
      main.tsx              ReactDOM.createRoot
      App.tsx               auth gate -> MainApp (3-pane shell), ErrorBanner,
                            mobile drawer, Header with status pill + info/logout,
                            MessageThread, PromptBox, SessionInfoSheet
      theme/globals.css     OpZero tokens ported from opzero-sh/OpZero.sh.
                            Synthetic Void bg, Carbon Fiber cards, Hyper Cyan
                            primary (#00F5FF), Neural Violet accent (#8B5CF6),
                            plus .glass, .glass-border, .card-glow, .gradient-text,
                            .cyan-glow, .animate-float.
      components/
        BrandLogo.tsx         animated neural-ring + "OpZero/claude" wordmark
        Login.tsx             form-based login, real <form autoComplete="username">
        SessionList.tsx       left rail, projects + sessions, status dots
        MessageThread.tsx     scrollable thread + ThreadNav overlay
        PromptBox.tsx         textarea, slash picker, quick actions, send/abort
        QuickActions.tsx      horizontal chip row above the prompt
        SlashCommandPicker.tsx  floating popover when input starts with /
        SessionInfoSheet.tsx    bottom-sheet metadata viewer
        ThreadNav.tsx           floating up/down/top/bottom scroll controls
        parts/                  specialized renderers for tool_use content
          index.ts                renderPart dispatcher
          TextPart.tsx            markdown-ish text
          ThinkingPart.tsx        collapsed thinking block
          ToolUsePart.tsx         generic tool wrapper + dispatch
          BashToolView.tsx        terminal-style output block
          EditToolView.tsx        unified diff viewer
          ReadToolView.tsx        file chip + content on expand
          SearchToolView.tsx      grep/glob results list
          TodoToolView.tsx        checklist view for TodoWrite
          TaskToolView.tsx        single subagent card (enhanced)
          TaskTeamGrid.tsx        multi-subagent grid for parallel Task calls
          WebToolView.tsx         URL chip + fetched content
          JsonFallbackView.tsx    default for unknown tools
          ResultPartView.tsx      footer badge row (cost, duration, status)
          SystemPartView.tsx      init metadata line
        ui/                     copied shadcn primitives
          button.tsx, input.tsx, scroll-area.tsx, dialog.tsx, tooltip.tsx,
          dropdown-menu.tsx, tabs.tsx, badge.tsx, separator.tsx, sheet.tsx
      hooks/
        useEventStream.ts     EventSource + exponential backoff, dispatches
                              to store.dispatch(event)
        useSessions.ts        small convenience hook
        useUrlSync.ts         writes /s/<slug>/<id>, hydrates from URL on
                              mount after projectsLoaded, popstate handler
      lib/
        api.ts                fetch wrapper (credentials: "include"); parses
                              server error JSON into usable messages
        authClient.ts         /api/auth/{me,login,logout}
        store.ts              module-level immutable store +
                              useSyncExternalStore. CRITICAL: every setState
                              rebuilds a new top-level object (see GOTCHAS)
        parts.ts              pure reducers for SSE events
        types.ts              client mirror of server types.ts
        utils.ts              cn() (clsx + tailwind-merge)
        cn.ts                 legacy alias, same as utils.ts

  docs/
    launchd.md              install/uninstall/logs/status for the autostart plist
    remote-trigger-findings.md  research doc: why RemoteTrigger was a dead end
                                and why Channels (MCP-based) is the real primitive

  scripts/
    sh.opzero.claude.plist.template  launchd plist with {{PROJECT_ROOT}} / {{BUN_BIN}}
    install-launchd.sh                resolves paths, substitutes, bootstraps
    uninstall-launchd.sh              bootout + rm

  packages/
    opzero-channel/       MCP plugin loaded by terminal `claude` for bidirectional
                          channel relay. Stdio transport, loopback HTTP bridge.
    codezero-mcp/         Remote MCP server giving agents full control over CodeZ.
      index.ts              Bun.serve entry on :4098, WebStandardStreamableHTTPServerTransport
      client.ts             HTTP client wrapping all /api/* endpoints on :4097
      tools.ts              17 MCP tool definitions + dispatch handler
      events.ts             SSE event poller (connects to /api/events, buffers for poll_events)
      package.json          @modelcontextprotocol/sdk, zod
      tsconfig.json         strict TS, mirrors opzero-channel

  .dogfood/             agent-browser screenshots + videos (gitignored)
  .logs/                launchd stdout/stderr (gitignored, created on install)
```

## Mental models you need

### Session status (live vs mirror vs idle)

A session is always in exactly one of three states, computed in
`server/routes/sessions.ts::sessionStatusFor`:

- `"live"` — we own a `SessionProcess` for this id in the pool. We can
  send prompts, abort, dispose, and stream deltas.
- `"mirror"` — we don't own it, but the JSONL file at
  `~/.claude/projects/<slug>/<id>.jsonl` was modified in the last 60
  seconds. Something else owns it (the user's terminal claude, another
  opzero-claude instance, opencode). Read-only. Sending returns 409.
- `"idle"` — archived. We don't own it and nothing else has touched it
  recently. Safe to resume, which promotes it to `"live"`.

The 60-second heuristic is deliberately imprecise. There's no clean Unix
primitive to say "another process has this file open for write", and we
accept the small risk that a 61-second-idle session gets resumed while
still technically owned by a terminal. Claude Code's JSONL writes are
append-only so the worst case is interleaved records, not data loss.

### Session.metadata

Every session has an optional `SessionMetadata` with model, permission
mode, tools, agents (subagents), skills, slash_commands, plugins, and
mcp_servers. Two population paths:

1. For live sessions: `SessionProcess::handleStreamJson` captures
   `{"type":"system","subtype":"init",...}` events from the CLI and
   builds metadata via `buildMetadataFromInit`.
2. For historical sessions: `history.ts::loadSessionMessagesAndMetadata`
   walks the JSONL and reconstructs metadata latest-wins from fields
   that appear sprinkled across user/assistant records (`version`,
   `message.model`, `permissionMode`, `deferred_tools_delta` records
   for tool changes, etc.). The JSONL does NOT contain `system.init`
   records — that's a stream-json-only format. See the comment in
   `history.ts` for the shape.

UI reads metadata for: slash command picker backfill, SessionInfoSheet,
model badge in the header.

### stream-json vs JSONL

Two different formats, same content:

- **stream-json** — what `claude -p --output-format stream-json --verbose
  --include-partial-messages` emits to stdout. Line-delimited JSON with
  types `system`, `user`, `assistant`, `stream_event`, `result`,
  `rate_limit_event`, `hook_event`. `stream_event` wraps raw Anthropic
  SDK events: `message_start`, `content_block_{start,delta,stop}`,
  `message_{delta,stop}`. The `content_block_delta` uses
  `text_delta | thinking_delta | input_json_delta | signature_delta`.
  Consumed by `SessionProcess` for live sessions.

- **JSONL on disk** — what Claude Code persists to
  `~/.claude/projects/<slug>/<id>.jsonl`. Different shape: top-level
  records with `parentUuid`, `sessionId`, `uuid`, `timestamp`, `type`,
  `message`, plus non-message records like
  `{"type":"file-history-snapshot",...}`,
  `{"type":"permission-mode",...}`, and
  `{"type":"user","attachment":{"type":"deferred_tools_delta",...}}`.
  Consumed by `history.ts` (for historical reads) and `SessionTailer`
  (for live mirroring). See `SessionTailer::handleLine` and
  `history.ts` for the parsing logic.

When you think "read historical state", it's JSONL. When you think
"parse a live subprocess stdout", it's stream-json. Never mix them.

### Event bus and SSE

`EventBus.emit({type, ...})` fans out to every subscriber synchronously.
`/api/events` is a single SSE stream that multiplexes ALL events for ALL
sessions. The client filters by `sessionId` in the reducer. Keep new
`SSEEvent` types in `server/types.ts` AND `web/src/lib/types.ts` — they
must match, and both `store.dispatch` and `applyDelta`/`applyPartUpdate`
must handle the new type.

### Store reactivity

`web/src/lib/store.ts` uses `useSyncExternalStore`. The module-level
`state` variable is rebuilt on every change via
`state = { ...state, ...patch }`. This is not optional — see the
mutation bug in GOTCHAS. Always go through `setState({ ... })`. Never
mutate `state.foo = ...` directly; React's `Object.is` check on the
snapshot will see no change and skip the re-render even though your
listeners fired.

## Auth model

Form-based cookie login. No HTTP Basic anywhere. The flow:

1. Browser hits `/` → SPA loads without auth
2. SPA calls `GET /api/auth/me`
3. If no valid cookie → 401 → render `<Login>` component
4. User submits `POST /api/auth/login` with `{username, password}`
5. Server verifies (bcrypt or plaintext) against `config.auth`, signs an
   HS256 JWT with `config.authSecret`, sets `opzero_claude_session`
   cookie (`HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`)
6. SPA re-calls `/api/auth/me`, gets user, swaps to `<MainApp>`
7. Logout: `POST /api/auth/logout` clears the cookie

`server/auth.ts` exports an `AuthProvider` interface:

```ts
interface AuthProvider {
  name: string;
  verify(req: Request): Promise<{ok: true; user: {sub: string}} | {ok: false}>;
  loginUrl?: string;
  logoutUrl?: string;
}
```

`createCookieAuthProvider(config)` is the default. Future providers
(OIDC, Cloudflare Access trust via `Cf-Access-Jwt-Assertion`, etc.) can
implement the same interface and drop in without touching route code.
**This interface is the distribution strategy** — users deploying behind
Cloudflare Access won't need our cookie layer at all.

Public paths that bypass auth: `/`, `/index.html`, `/assets/*`,
favicons, `/api/auth/*`, `/api/health`. Everything else requires either
loopback (on by default via `config.loopbackBypass`) or a valid
provider verification.

Rate limit: 5 failed logins per IP per minute, returns 429 with
`Retry-After: 60`. In-memory, swept on each check.

## Style rules

### Theme

- Base: **Synthetic Void** `hsl(240 20% 1%)` background, **Carbon Fiber**
  `hsl(240 10% 5%)` card surfaces, **Hyper Cyan** `hsl(186 100% 50%)`
  `#00F5FF` primary, **Neural Violet** `hsl(262 83% 65%)` `#8B5CF6`
  accent.
- Tokens live in `web/src/theme/globals.css` as CSS variables. Tailwind
  v4 `@theme inline` exposes them as utility classes
  (`bg-background`, `text-foreground`, `border-border`, `text-primary`,
  etc.). Never hardcode colors; use tokens.
- Utilities to use: `.glass`, `.glass-border`, `.card-glow`,
  `.glow-border`, `.gradient-text` (cyan -> violet), `.cyan-glow`,
  `.animate-float`.
- Tool-use cards: `border-l-2 border-l-accent` for subagent work,
  `border-l-2 border-l-primary` for regular tools. Cyan pulse on
  running state, violet accent on results.
- Monospace for anything code-ish (cwd, tool names, JSON, session IDs).
- Status dots: cyan for live, violet pulsing for mirror, none for idle.

### Components

- Shadcn primitives only from `@/components/ui/*`. Don't add new ones
  without checking the existing set.
- Use `cn()` from `@/lib/utils` for className composition.
- Lucide icons only. Common picks: `Menu`, `X`, `Info`, `LogOut`,
  `Send`, `Square`, `Loader2`, `Plus`, `Bot`, `CheckCircle2`,
  `AlertTriangle`, `ChevronRight`, `FileCode`, `FileText`, `Terminal`,
  `Search`, `CheckSquare`, `Sparkles`.

### React 19

- New JSX transform. **Do not `import React`.** Use named imports:
  `import { useEffect, useState, type ReactNode } from "react"`.
- Functional components. `function Foo()` not `const Foo = () =>`.
- Strict TypeScript. No `any` unless you're casting deliberately.
- No class components.

### No emojis

Not in source, not in commits (except the occasional dev-facing aside),
not in user-facing strings, not in docs. The brand is cyberpunk-minimal.

### No superfluous comments

Comments explain WHY, never WHAT. If code needs a comment to say what
it does, rename the function.

## Adding things

### A new API route

1. Add a handler in the appropriate `server/routes/*.ts`
2. Wire it into `server/index.ts::fetch` with a prefix or exact match
3. If it accepts unauth access, add its path to the public-paths list
   in `server/auth.ts`
4. If it returns a new response shape, update the TS types in
   `server/types.ts` AND `web/src/lib/types.ts`
5. Add a client wrapper in `web/src/lib/api.ts` with proper error
   handling
6. Rebuild, restart, verify

### A new SSE event type

1. Add the variant to `SSEEvent` in both `server/types.ts` and
   `web/src/lib/types.ts`
2. Emit it somewhere in the server (usually from `SessionProcess` or
   `SessionTailer`)
3. Handle it in `web/src/lib/store.ts::dispatch`
4. If it mutates messages, add a reducer in `web/src/lib/parts.ts`

### A new part renderer (for a new Claude Code tool)

1. Create `web/src/components/parts/XyzToolView.tsx`
2. Add a case to the dispatcher in
   `web/src/components/parts/ToolUsePart.tsx` matching `part.tool`
3. Export it from `web/src/components/parts/index.ts` if other code
   needs it directly
4. Match the aesthetic: `border-l-2 border-l-accent`, icon in the
   header, collapsible body, terminal-style output where appropriate

### A new auth provider (future distribution work)

1. Implement the `AuthProvider` interface in a new file,
   `server/auth-providers/<name>.ts`
2. Wire it in `server/index.ts` selection logic, probably keyed off a
   `config.authProvider = "cookie" | "oidc" | "cf-access" | ...`
3. No other route should need to change

## Gotchas (real bugs we've hit)

### The `useSyncExternalStore` mutation bug

If you mutate the store state in place (`state.foo = bar; emit()`),
React's `Object.is` check on `getSnapshot()` returns true and no
component re-renders even though every listener fired. The symptom is
"data is loading correctly but the UI stays stuck". ALWAYS rebuild the
top-level state object: `state = { ...state, ...patch }`.

### Router method conflict

`POST /api/projects/:slug/sessions` starts with `/api/projects` but
must be handled by `sessionsRoutes`, not `projectsRoutes`. The
dispatch in `server/index.ts` method-routes `/api/projects`: GET goes
to `projectsRoutes`, POST goes to `sessionsRoutes`. Don't "simplify"
this.

### Resume flag conflict

`claude --session-id X --resume X` is invalid; you can't specify both.
`SessionProcess` only passes `--session-id` when creating fresh and
`--resume` when resuming. Mutually exclusive. If you touch the spawn
args, preserve this.

### Bun.serve idleTimeout

Default is 10 seconds. Long-lived SSE streams get cut every 10 seconds.
We pass `idleTimeout: 0` in `server/index.ts::Bun.serve(...)`. Don't
remove it.

### Tailer + pool ownership

When the pool takes ownership of a session (`createNew` or
`resumeOrCreate`), it calls `stopTailer(id)` to avoid double-emitting
messages from both the subprocess and the file watcher. When the pool
disposes a session, it stops the tailer. If you add new code paths
that create sessions, keep this invariant.

### History reads can be slow

`loadSessionMessagesAndMetadata` walks the entire JSONL file. For the
current conversation's session file (currently 1.9 MB and growing),
this takes ~100ms. Don't call it in the SSE hot path; the route
handler reads it once per session open.

### Auth fallback

`SessionProcess` strips `ANTHROPIC_API_KEY` from the subprocess env by
default so the CLI uses OAuth (Max subscription). If the CLI returns a
billing/auth error (`"billing_error"`, `"Credit balance is too low"`,
etc.), the process auto-retries once with the API key restored (or
vice versa). Controlled by `AuthMode = "oauth" | "apikey"` and a
`childGeneration` counter to suppress stale exit handlers during retry.
The module-level `preferredAuthMode` updates when a `system.init` event
confirms auth succeeded, so future sessions in the same server lifetime
use the working mode first. `getAuthHealth()` exposes the current
preference and last failure for self-heal monitoring.

### Cost warning on fresh subprocess

Every `SessionProcess` boot cold-starts Claude Code's system prompt
cache — roughly 85k tokens of cache creation at ~$0.10 per session.
Follow-up turns in the same live process are cheap. Don't spawn
throwaway subprocesses.

### iOS safe areas

`App.tsx` root applies `env(safe-area-inset-top/left/right)` padding,
and `PromptBox` applies `env(safe-area-inset-bottom)`. Combined with
`height: 100dvh` and `viewport-fit=cover`, this keeps the prompt box
above the Safari URL bar and clear of the home indicator. Don't touch
this unless you're testing on a real iOS device.

### Secure cookie on plain HTTP

Cookie auth uses `Secure` which means browsers only send it over
HTTPS. Locally it works because of the loopback bypass in
`server/auth.ts`. Over the Cloudflare tunnel it works because Cloudflare
terminates TLS. If you ever try to hit the server directly from a
non-loopback client over plain HTTP, it will fail — that's correct.

## Dev workflow

1. Make the change.
2. `bunx tsc --noEmit` at both root and `web/`.
3. `cd web && bun run build` — MUST succeed before committing.
4. Restart the server: kill the running `bun run server/index.ts`
   process and start it again. The user wants each iteration reflected
   immediately.
5. Verify in the browser. Use agent-browser at the iPhone 15 Pro Max
   viewport (430x932) since that's the primary target.
6. Commit. Push. Report.

## Agent swarm conventions

When using background agents to parallelize work:

- **File partitioning is non-negotiable.** Each agent owns a disjoint
  set of files. If two agents both need to modify `App.tsx`, one of
  them owns it and the other creates a standalone component I wire in
  during the integration pass.
- **Contracts in the prompt.** When agents depend on types another
  agent is producing, inline the shape into the prompt so both sides
  agree.
- **No `git add` or `git commit` by subagents.** The orchestrator
  handles version control after integration.
- **Integration pass is always foreground.** Rebuild, typecheck,
  resolve seam issues, test, commit. Don't delegate this.

## Commit conventions

- Messages: Conventional-commits-ish. `fix:`, `feat:`, `chore:`, etc.
  Title under 72 chars. Body explains *why*.
- Always include the Claude Code co-author trailer:
  `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Never `git push` without explicit user approval, unless the user has
  durably authorized autonomous push for the current session (e.g.
  "kick some tires and light some fires", "don't come back to me till
  it's done").
- Never push to `main` with `--force`. Never rewrite published history.

## Deployment

### Cloudflare tunnel

Each deployment uses its own named tunnel and domain. Config at
`~/.cloudflared/config.yml`. The tunnel routes HTTPS traffic from
your domain to `http://127.0.0.1:4097`.

If you edit the config, kill the process and relaunch it — `SIGHUP`
terminates cloudflared, it doesn't hot-reload.

See the README for full tunnel setup instructions.

### launchd autostart

Optional but recommended:

```bash
./scripts/install-launchd.sh     # bootstrap LaunchAgent
./scripts/uninstall-launchd.sh   # tear it down
```

Logs at `.logs/server.out.log` and `.logs/server.err.log`. Status:
`launchctl print gui/$(id -u)/sh.opzero.claude | head`. Restart:
`launchctl kickstart -k gui/$(id -u)/sh.opzero.claude`. See
`docs/launchd.md` for the runbook.

## Things NOT to touch without checking first

- `server/types.ts` / `web/src/lib/types.ts` — they must stay in sync.
  Change both or neither.
- The `useSyncExternalStore` mutation pattern in `store.ts`. See
  GOTCHAS.
- `Bun.serve`'s `idleTimeout: 0`. See GOTCHAS.
- The resume-vs-session-id flag logic in `SessionProcess`. See GOTCHAS.
- The method-based router split for `/api/projects` in `index.ts`. See
  GOTCHAS.
- The `Secure` cookie attribute in `server/auth.ts`. Tempting to remove
  for local HTTP testing; don't — use the loopback bypass instead.
- Any sibling OpZero repos — they have their own CLAUDE.md files.

## Channels

Channels is the primary way to get bidirectional writes into externally-owned
(mirror) sessions. A terminal `claude` process launched through our wrapper
loads a small Bun MCP plugin at `packages/opzero-channel/`, which writes a
discovery file under `~/.opzero-claude/channels/<sessionId>.json`, binds a
loopback HTTP listener, and emits `<channel>` events into Claude's agent loop
whenever the opzero-claude server POSTs a user turn into it. Replies stream
back out through the plugin and into the web UI as part of the same
conversation. It is a research-preview Claude Code feature (>= 2.1.80) that
we expose via `--dangerously-load-development-channels`.

One-command launcher: `./scripts/launch-opzero.sh --cwd ~/my/project`. See
`docs/channels.md` for the full user-facing explanation, security model,
debug checklist, and current limitations (notably that permission relay is
not yet wired up).

## Open threads (roadmap)

See `Roadmap.md` for full list with tiering. Key remaining items:

- **Channels** — MCP plugin and relay are shipped; permission relay into the
  terminal is the remaining piece.
- **Fork session** — blocked on session ID remap semantics.
- **Subagent output streaming** — blocked on channels being loaded in subagents.
- **Cross-session team dashboard** — needs `task.started`/`task.finished` events.
- **Paste-image / file-reference** — clipboard paste + multipart content blocks.
- **Markers** — bookmark system for in-session flagging.
- **CodeZ memory** — persistent state store for preferences, markers, cost
  snapshots; enables items 14, 10, and personalization.
- **iMessage relay** — depends on Channels E2E verification.
- **Session tree by repo name** — group sidebar by git remote instead of slug.
- **Self-healing** — reconciliation loop for stale channels, orphan processes.
- **Distribution packaging** — Homebrew tap, bunx, or Docker.
- **Research probe** — KAIROS/ULTRAPLAN/autoDream are either not shipped
  or stripped from public builds. See `docs/research/` for findings.
- **Voice input** — Web Speech API shipped (item 11).
- **Command palette** — Cmd+K shipped (item 26).
- **Cloudflare Access** — `CloudflareAccessAuthProvider` shipped; requires
  dashboard config (item 28).
- **Auto-memory UI** — read-only memory viewer shipped (item 27).
- **Voice input** — Web Speech API shipped.
- **Command palette** — Cmd+K shipped.
- **Cloudflare Access** — provider shipped; user config required.
- **Auto-memory** — read-only memory viewer shipped.
- **.claude/agents/codez.md** — shipped (item 19).
- **Remote MCP server** — `packages/codezero-mcp/` shipped. 17 tools over
  Streamable HTTP at `:4098`. Agents connect via
  `{"type":"http","url":"http://127.0.0.1:4098/mcp"}`.
- **Tests** — not yet shipped (item 20).
