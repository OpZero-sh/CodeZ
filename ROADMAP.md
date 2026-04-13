# CodeZero Roadmap

Living document. Everything we know we want to build or investigate next,
ordered roughly by impact. Architecture rules and conventions live in
[CLAUDE.md](./CLAUDE.md). Git history is the source of truth for what
actually landed; this file is for what's still out there.

Last updated after item 36 shipped (OpZero project browser + connectors panel).

## Shipped (context only, see git for detail)

Foundational build:
- Bun HTTP server + React 19 SPA, single-process model, Cloudflare tunnel
  at Cloudflare tunnel
- SessionPool (stream-json duplex wrapping the claude CLI)
- SessionTailer (read-only fs.watch mirror of externally-owned sessions)
- `/api/events` SSE multiplexer, EventBus, immutable useSyncExternalStore
- Form-based cookie auth with pluggable AuthProvider interface
- launchd autostart scripts

User-facing features:
- Sidebar + mobile drawer, iOS safe-area padding, autoscroll to latest
- Deep links (`/s/<slug>/<id>`), URL persistence across reload
- Slash command picker, Quick Actions chip row
- Session Info bottom sheet with full metadata
- ThreadNav scroll controls with J/K/G/gg keyboard shortcuts
- TaskToolView + TaskTeamGrid for multi-subagent visualization
- Visible ErrorBanner with dismiss
- Session.status enum (live / mirror / idle) with status pills

Channels (full round trip):
- `packages/opzero-channel/` MCP plugin with discovery file, shared
  secret, `POST /inject`, `GET /events` SSE, `reply` tool, permission
  request handler, `POST /permission` verdict route
- `scripts/launch-opzero.sh` launcher wrapper
- Server `ChannelBridgePool` subscribes to plugin `/events` and relays
  into the main bus
- Permission relay surfaces on the phone as inline Allow/Deny prompts
- `server/claude/channels.ts` discovery reader + inject client with PID
  liveness check

Rebrands:
- Product renamed **CodeZero** (wordmark, titles, banners — package and
  repo name stay `opzero-claude`)
- **AuthZero** restyle of MCPAuthKit consent screen on feature branch
  `rebrand-authzero`, not yet deployed (see Open Threads below)

Recent fixes:
- `useSyncExternalStore` store-mutation bug
- POST routing for new session creation
- `--session-id` + `--resume` flag conflict
- `Bun.serve idleTimeout: 0` for SSE
- Mirror-guard relaxation (no more hard 409 on externally-owned sessions)

Wave 1 — mobile polish + send UX (2026-04-11):
- **PWA install shell** — `manifest.webmanifest`, icon assets, `apple-touch-icon`,
  `mobile-web-app-capable` meta tags in `index.html`; public-path bypass in
  `server/auth.ts` for all icon/manifest paths. Removes Safari chrome on home-screen
  install; iOS Add-to-Home-Screen works via Share menu on the deployed HTTPS host.
- **Inline send-error feedback** — `PromptBox` now shows send failures directly beneath
  the textarea; error clears on next keystroke and does not duplicate in the global
  `ErrorBanner`. Failed sends also keep the draft text instead of clearing it.
- **Live sidebar status + bucket fix** — `SessionProcess` now derives `projectSlug`
  from `cwd` at spawn and on `system.init`, so live session SSE events correctly
  update the sidebar bucket. Sidebar rows flash briefly (1.8s cyan glow) when a
  session newly transitions to `live`.

Wave 2 — creation UX + cost transparency (2026-04-11):
- **Cost / token tracking** — `ResultPart.usage` typed as `Usage` (input_tokens,
  output_tokens, cache metrics); `usageTotals` aggregated in the store per session
  on every `session.idle` event and seeded from historical `ResultPart` records on
  session open. `SessionInfoSheet` now shows turns, total cost, input/output
  tokens, and total duration with a "(live session)" / "(mirror session — no
  usage data)" label.
- **Session disposal confirmation** — both the sidebar trash button and the header
  Disconnect button now show a confirmation dialog before calling
  `store.disposeSession`. "Keep" cancels; "Dispose" is the destructive action.
  JSONL is retained on dispose (server's existing default).
- **Permission mode picker** — `NewSessionDialog` now has a dropdown between the
  Model input and the footer with six options: Default, Accept Edits, Auto, Bypass
  Permissions, Don't Ask, Plan. Backend replaces the previous hardcoded
  `--dangerously-skip-permissions` with conditional logic:
  `bypassPermissions` → `--dangerously-skip-permissions`;
  other modes → `--permission-mode <val>`; blank → omit both (claude default).

Wave 3 — voice + palette + memory + auth + research probes (2026-04-11):
- **Voice input** — mic button in `PromptBox` using Web Speech API (WebkitSpeechRecognition
  for iOS Safari). Push-to-talk with auto-submit on silence. Graceful degradation
  when API is unavailable.
- **Command palette** — `Cmd+K` / `Ctrl+K` opens a searchable overlay with sessions
  (grouped by project), quick actions (New Session, Toggle Sidebar, Open Info, Logout),
  keyboard navigation (↑↓ Enter Escape), glass-card styling.
- **Auto-memory UI** — `GET /api/projects/:slug/memory` reads
  `~/.claude/projects/<slug>/memory/` and surfaces file contents in `SessionInfoSheet`.
  Read-only; "(no memory files)" when absent.
- **Cloudflare Access auth** — `createCloudflareAccessAuthProvider` reads
  `Cf-Access-Jwt-Assertion`, verifies via JWKS from `cdn-cgi/access/certs`, with 5-min
  JWKS cache. Activate via `"authProvider": "cf-access"` in config.
- **Research probes** — 9 background agents wrote `docs/research/` on KAIROS,
  ULTRAPLAN, VOICE_MODE, DAEMON, AGENT_TRIGGERS, BRIDGE_MODE/MONITOR_TOOL, BUDDY,
  autoDream. Findings: KAIROS/ULTRAPLAN are compile-time stripped from public builds;
  MONITOR_TOOL shipped v2.1.98+; VOICE_MODE has no native Claude Code primitive;
  BUDDY is real but not scriptable; autoDream has readable memory files.
- **`.claude/agents/codezero.md`** — agent definition file orienting future subagents
  to project layout, conventions, style rules, gotchas, and known open items.

Wave 4 — paste-image + markers + memory + session tree (2026-04-11):
- **Paste-image** — paperclip button in `PromptBox` + clipboard paste detection. Files
  uploaded to `POST /api/sessions/:id/upload`, stored in `~/.config/opzero-claude/uploads/`.
  `sendUserPrompt` extended to send base64 image content blocks alongside text.
- **Markers** — bookmark system for sessions. Pin icon on message hover, violet side rail
  on marked messages, markers panel (bottom sheet, cross-session toggle), ThreadNav
  jump-to-prev/next-marker with `m`/`M` shortcuts.
- **CodeZero memory** — persistent state store at `~/.config/opzero-claude/state.json`.
  `server/state.ts` with `get/set/save`. `GET /api/state` and `PATCH /api/state` routes.
  Stores markers, preferences, and recent cwds. Markers panel reads/writes through the API.
- **Session tree by repo name** — sidebar now shows parsed git remote origin as the group
  label (e.g. `OpZero-sh/CodeZ` instead of `-USERS-OPZ-OPZ-OPZERO-SH`). Worktree
  sessions fold into the same group. 7-day cache of parsed repo names keyed by absolute
  path.

Wave 5 — agent control surface (2026-04-12):
- **Remote MCP server** — `packages/codezero-mcp/` ships a Bun HTTP server on
  :4098 using MCP Streamable HTTP transport (WebStandardStreamableHTTPServerTransport).
  17 tools: session lifecycle (create, resume, fork, abort, dispose), prompt
  injection, permission resolution, project/memory browsing, full-text search,
  real-time event polling via SSE buffer, state management, and observability
  stats. Agents connect via `{"type":"http","url":"http://127.0.0.1:4098/mcp"}`
  in their MCP config.

## Open threads, tiered

### Tier 0 — soon, high leverage

**0. Computer use integration.** Claude Code 2026-w14 introduced computer
use — Claude can control the screen (mouse, keyboard, screenshots) as a
tool. CodeZero should:

- Surface `/computer` as a slash command and quick-action chip (done in
  this commit for the chip)
- When Claude invokes computer-use tool calls, render them in the
  message thread with a specialized `ComputerUsePart` widget: screenshot
  thumbnail, action overlay (click coords, type text, scroll), before/
  after diff when available
- Stream computer-use screenshots into the thread so the mobile user
  can watch Claude operate their Mac in real time
- Consider: should CodeZero sessions be able to START computer use, or
  only mirror sessions that are already using it? If starting, the
  server needs to pass `--computer-use` or equivalent flag to the CLI
- Fetch https://code.claude.com/docs/en/whats-new/2026-w14 for the
  exact flag syntax and tool schema before building
- Look at how the existing `parts/` renderers dispatch and add a
  `ComputerUsePartView.tsx` with screenshot display + action annotation
  overlay

Estimated: half day to probe the protocol + render screenshots, another
half for the action overlay + streaming. High visual impact.

**1. Research-preview probe swarm.** [DONE — wave 3 shipped 9 research docs in `docs/research/`.] User surfaced a list of gated Claude
Code features worth reverse-engineering. Same format as the remote-trigger
probe that found Channels: one background agent per feature, each writes
findings to `docs/research/<feature>.md`, then synthesize. Priority order
within the list:

- **KAIROS** — autonomous background agent behind `PROACTIVE/KAIROS`
  flags. Three exclusive tools not in regular Claude Code: push
  notifications, file delivery, GitHub PR subscriptions. Append-only
  daily logs. Cross-session persistence. If scriptable, this is a
  long-running-task orchestrator we can wrap.
- **ULTRAPLAN** — offloads planning to a remote Cloud Container Runtime
  session running Opus 4.6 for up to 30 minutes. Browser-approvable.
  `ULTRAPLAN_TELEPORT_LOCAL` sentinel returns the result to the local
  terminal. If usable, this is free infra for hard planning jobs.
- **autoDream** — memory consolidation during idle, four-phase
  architecture. The user-facing auto-memory the home-level CLAUDE.md
  already uses may be the surface of this. Worth probing for how
  "idle" is detected and whether the consolidation can be invoked.
- **VOICE_MODE** — if this enables dictation into a live claude session,
  it's the best hands-free mobile primitive we could add. Pairs with
  the no-notifications preference: voice in, visual out.
- **DAEMON** — may be another path to a long-running backend that
  doesn't require a terminal. Could replace launchd for some use cases.
- **AGENT_TRIGGERS** — might let one session spawn another on events.
- **BRIDGE_MODE, MONITOR_TOOL** — unknown shape, worth enumerating.
- **BUDDY** — Tamagotchi with 18 species, deterministic Mulberry32 gacha
  seeded from userId, stats like DEBUGGING/CHAOS/SNARK. Low priority,
  high whimsy. Good Easter egg candidate if it's scriptable.
- **Undercover Mode / Anti-distillation** — noted, not actionable (one
  is employee-only, the other is outbound pollution only).

Estimated: one research wave of 6-10 background agents, ~30 minutes
wall, ~$5-10 subagent cost. Dispatch by dropping the `/orchestrate`
skill into a fresh session pointed at this repo.

**2. [SHIPPED] PWA install manifest + icons.** Install CodeZero to the iOS home
screen as a standalone app. Removes Safari chrome entirely (the iOS
Safari URL bar problem we've already patched around with safe-area
padding goes away for good in standalone mode). Scope: add `manifest.
json`, favicon pack, apple-touch-icon, `<link rel="manifest">` in
index.html. Maybe a small onboarding dialog on first mobile visit
suggesting Add to Home Screen. ~30 min work.

**3. Channel-end-to-end verification.** We shipped Channels and
permission relay but never ran a live claude subprocess end-to-end to
confirm the happy path. User's job; mine is to make sure it's
reproducible. If anything fails, diagnose and fix. Cost: one ~$0.10
context-cache spawn.

**4. [SHIPPED] Inline send-error feedback.** Send failures currently surface in
the top-of-page ErrorBanner, which is far from the textarea tap target.
Add an inline error bubble directly beneath the PromptBox with
auto-clear on next keystroke. ~15 min.

### Tier 1 — medium priority, new capability

**5. [SHIPPED] Paste-image / file-reference support.** iPhone screenshot paste is
the biggest ergonomic gap for mobile usage. Claude Code takes files at
session start via `--file file_id:relative_path`. We'd:

- Accept `<input type="file">` or paste events in the PromptBox
- POST the file to a new `/api/uploads` endpoint
- On next prompt, include the file reference in the stream-json input
  message as a content block with a file attachment

Scope is bigger than it looks because of the multi-part content block
plumbing. Half a day.

**6. [SHIPPED] Cross-session team dashboard.** Global panel showing every
in-flight subagent across all active sessions. `task.started` /
`task.finished` SSE events emitted from `SessionProcess` when Task tool_use
blocks are detected/completed. `GET /api/events` propagates these to all
clients. Fleet bottom sheet shows running tasks with session title,
agent type, description, live elapsed timer, and completed count.
Header has a Bot icon (Fleet button) that pulses cyan when tasks are
running. Tapping a task card navigates to that session.

**7. Fork session.** Server returns 501 today for
`POST /api/sessions/:id/fork`. Wire it to
`claude --fork-session --resume <id>` so the user can branch a
conversation without stomping the original. UI: a "Fork" button in the
header dropdown. Small but high-leverage for "I want to try an
alternative path".

**8. [SHIPPED] Sessions list live status updates.** The sidebar currently shows
status dots from the initial `listSessionsForProject` fetch; it doesn't
react when sessions transition live -> idle or when a channel appears.
Wire `session.updated` events into the sidebar reducer so the dots
update in real time. Also add a "just started" flash animation for
newly-live sessions. Small.

**9. Subagent output streaming.** Task tool calls show the prompt and
the final result, but subagents have their own intermediate stream
(text/tool_use blocks) while they're running. Surface those inside the
TaskToolView as a live mini-thread. Requires detecting nested stream
events in process.ts and emitting them with `parent_tool_use_id` set.
~half day.

**10. [SHIPPED] Cost / token tracking.** Stream-json emits usage numbers on every
`result` event. Aggregate into the store keyed by sessionId, show a
running `$0.xx / N tokens` in the SessionInfoSheet and optionally a
session-level badge. Small.

**11. [SHIPPED] Voice input.** Web Speech API has iOS Safari support. Add a mic
button to PromptBox that starts speech recognition, appends transcribed
text to the textarea, auto-submits on silence. Replaces the "type on
iOS" ergonomic problem for long prompts. Depends on how `VOICE_MODE`
research shakes out — if there's a native Claude Code primitive, use
that instead.

**12. [SHIPPED] Permission mode switcher.** We hardcode
`--dangerously-skip-permissions` in `SessionProcess`. A header dropdown
to choose `acceptEdits | auto | bypassPermissions | default | dontAsk
| plan` on session creation would make the UI safer for non-sandbox
work. Small.

**13. [SHIPPED] Session disposal confirmation.** The Trash2 button in SessionList
disposes sessions with no confirmation. Add a small confirm dialog,
maybe with "keep JSONL" as the default so nothing's actually destroyed.
Tiny.

**14. [SHIPPED] Markers — flag things you breezed past.** A lightweight bookmark
system for "come back to this later". When you're moving fast in a
session and Claude surfaces something interesting but you don't want
to derail — a tool output, a file path, a decision, a subagent result —
you drop a marker and keep going. Later you open a Markers panel and
jump through them.

Design sketch:

- **Drop a marker**: a small pin icon on each message (hover or
  long-press on mobile), or a `/mark <label>` slash command that
  marks the *next* assistant turn, or a "Mark" button in the message
  action menu. Optional one-line label; free-text.
- **Marker shape**: `{ id, sessionId, messageId, partId?, label?,
  note?, createdAt, resolved?: boolean }`. Stored in CodeZero's own
  memory (see item 17), not in the JSONL. Scoped to the session by
  default, with a "global / cross-session" toggle.
- **Markers panel**: a new bottom sheet (reuse shadcn Sheet), listing
  all markers for the current session + a toggle to show all markers
  across all sessions. Each row: session title / message snippet /
  label / relative time / resolve button. Tap jumps to the marker.
- **In-thread rendering**: marked messages get a subtle violet side
  rail (matching the accent) + a small pin glyph in the corner.
- **Resolved vs open**: marking things "done" should feel good. Strike-
  through + fade on resolve, unresolve by tapping again.
- **Markers + ThreadNav**: add a "jump to next marker" affordance
  alongside the existing "next user message" nav.

Estimated: half a day for the core (schema, store, drop-action,
panel). Polish and cross-session view another half. High user value
for a tool built around watching long subagent runs go by.

**15. [SHIPPED] CodeZero memory — local persistent state store.** Separate from
Claude Code's auto-memory (which is per-project under
`~/.claude/projects/<slug>/memory/`), CodeZero itself should persist
its own state between restarts. What belongs here:

- User preferences: default project, default model, permission mode,
  custom quick-actions chip set, theme
- Pinned sessions (a "favorites" tier in the sidebar that survives
  project boundaries)
- Markers (item 14) — this is where they live
- Cost / token tracker snapshots for budget awareness
- Recent cwds for the New Session dialog's history dropdown
- Session notes / tags — freeform metadata on sessions that the
  JSONL doesn't capture

Store: `~/.config/opzero-claude/state.json` to start, or a `sqlite3`
file if we grow beyond ~1MB. Access through a `server/state.ts`
module with explicit getters/setters; the server reads on startup and
writes on mutation. Client-side mirror via a `/api/state` GET/PATCH
endpoint that's cookie-authed like everything else.

This is infrastructure for items 14 (markers), 10 (cost tracking),
and future personalization. Build it once and everything downstream
gets cheap. Half a day for the backing store + API, another half for
the initial consumers.

**16. Messaging / iMessage relay — text-in-text-out surface.** Use
CodeZero as a text relay into Claude. The user sends an iMessage from
anywhere (phone, watch, Mac, CarPlay) and Claude responds in the same
thread. This is the "claw" / opencode Telegram-bridge pattern but
targeting Apple's text stack specifically.

The good news: Anthropic already ships an **iMessage channel reference
plugin** at
`github.com/anthropics/claude-plugins-official/tree/main/external_plugins/imessage`.
It reads the Messages sqlite database directly and sends replies via
AppleScript. We don't have to build the iMessage side from scratch;
we just install it and aim it at a session. The work is integration:

- Install the iMessage plugin (or our own fork) and wire it into
  CodeZero's launcher so it attaches alongside `opzero-channel`
- In the UI, expose a "Relay this session to iMessage" toggle that
  writes an entry to `~/.claude/channels/imessage/.env` and restarts
  the session with `--channels plugin:imessage@claude-plugins-official`
- Show inbound iMessage as a different visual treatment in the thread
  (blue bubble matching Messages' look, contact name from the handle)
- Outbound replies flow back through the plugin's Messages-db write
  path automatically

Security: the iMessage plugin uses a sender allowlist. We bootstrap
with the user's own Apple ID (self-chat bypasses auth per the docs)
and let them add other handles via `/imessage:access allow <handle>`
from the phone.

Follow-up after iMessage works: Telegram (same mechanism, same
reference plugin), SMS (Twilio or similar), Slack (different story,
needs a Slack app). But iMessage-first for the iPhone-primary use
case.

Estimated: ~1 day for the first working iMessage -> Claude flow
through CodeZero, another day for the inbound visualization + contact
management UI. Depends on item 3 (Channel end-to-end verification)
working first.

**17. [SHIPPED] Session tree by repo name, not directory path.** Sidebar currently
labels project groups with their encoded slug (e.g.
`-USERS-OPZ-OPZ-OPZERO-SH--CLAUDE-WORKTREES-CONDESCENDING-SANDERSON`)
which is unreadable. Switch to:

- **Primary label**: repo name if the cwd is inside a git repo (from
  `git remote get-url origin` parsed to `<org>/<repo>`, falling back
  to the name of the dir containing `.git`)
- **Secondary label**: relative path within the repo if the session's
  cwd is a subdirectory (e.g. `opzero-claude/web`)
- **Fallback**: basename of the cwd when no git repo is detected

Implementation: extend `listProjects` in `server/claude/history.ts` to
resolve each project's cwd -> repo root -> repo name on first read,
cache the result on disk (CodeZero memory, item 15) keyed by absolute
path, invalidate on a weekly basis or when the project's JSONL count
changes. Walking up from cwd looking for `.git` is cheap; reading the
remote config is cheaper than a git subprocess if we parse
`.git/config` directly.

Group the sidebar by repo name. Sessions from git worktrees of the
same repo (e.g.
`opzero-sh/OpZero.sh` and
`opzero-sh/OpZero.sh/.claude-worktrees/foo`) fold into the same
group with a worktree sub-label. Sessions from unrelated dirs stay
in their own groups by fallback path.

~half day. Huge readability win on the phone where the current slug
text overflows badly.

### Tier 2 — developer ergonomics + distribution

**18. [SHIPPED] Self-healing — detect and repair degraded state automatically.**
CodeZero has several pieces of state that can rot silently: stale
channel discovery files, stuck SSE bridges, orphaned SessionProcess
entries, tailers that missed an fs.watch event, config drift. Today
most of these are caught opportunistically or not at all. Build a
small `server/self-heal.ts` reconciliation loop that runs every N
seconds and sweeps:

- **Channel discovery**: `readChannelDiscovery` already checks PID
  liveness and unlinks stale files on read. Extend: periodic scan of
  `~/.opzero-claude/channels/` to unlink stale files proactively, not
  just on demand.
- **Channel bridges**: if a `ChannelBridgePool` entry has a closed
  fetch stream or hasn't received a heartbeat in > 60s, drop it and
  re-establish on next session open.
- **SessionProcess orphans**: if `pool.map` contains an entry whose
  `child.exited` has resolved but we never removed it from the map,
  reap it.
- **Tailer lag**: if a session's JSONL mtime has advanced but the
  tailer hasn't emitted any events in > 30s, reset its fs.watch and
  re-read from the last known position.
- **Config drift**: on startup, verify `authSecret` exists, password
  is bcrypted (migrate if plaintext), permissions on config file are
  `600` (fix if looser).
- **Build fingerprint mismatch**: if `web/dist/index.html` doesn't
  reference the JS/CSS hashes that match the committed source
  fingerprint, auto-trigger a rebuild on server startup.
- **Bridge pool -> bus mismatch**: if bridge fires events for a
  sessionId that no client is subscribed to, let it keep running
  (cheap) but log.

Expose `/api/health/details` with a per-subsystem status so the UI
can show a "system healthy" indicator with a drill-down panel
showing what self-heal has been doing. Integrate with the
ErrorBanner: show an actionable toast when self-heal can't fix
something ("2 stale channels could not be unlinked, check
permissions").

Also add logs: every self-heal action writes a line to a ring buffer
in memory the UI can display. "[self-heal] unlinked stale channel
discovery for abc-123 (pid 99999 dead)".

Estimated: half day for the loop + first set of checks, another
half for the UI surfacing. Pays off every future deployment.

**19. [SHIPPED] CodeZero subagent definition.** Add
`.claude/agents/codezero.md` with frontmatter and a system prompt that
orients a future claude subagent to this project's layout, conventions,
gotchas, and commit style. The user explicitly asked for this during
the CLAUDE.md wave; we wrote the doc but got redirected to Channels
before the agent file landed. Tiny.

**20. [SHIPPED] Tests for critical paths.** Zero test coverage right now. At
minimum we want:

- `server/auth.ts` — JWT sign/verify round trip, bcrypt verify, rate
  limit, public path gating
- `server/claude/channels.ts` — discovery read/write/stale cleanup,
  inject fetch with/without secret
- `server/claude/channel-bridge.ts` — SSE frame parsing
- `server/claude/protocol.ts` — stream-json parseLine on real fixtures
- `server/claude/history.ts` — JSONL reducer on real fixtures
- `web/src/lib/store.ts` — immutability, dispatch reducers, URL sync

Use `bun test` (no external framework needed). ~half day for the core
set, adds confidence on every future refactor.

**21. [SHIPPED] Distribution packaging.** Make CodeZero installable by other
users running their own claude CLI. Path options:

- **Homebrew tap**: `brew install opzero-sh/tap/codezero`, installer
  drops a launchd plist and bun binary
- **bunx one-liner**: `bunx codezero serve` pulls from a published bun
  package
- **Docker**: `docker run opzero/codezero` for Linux users

Blockers: pluggable auth (done), config UX that isn't "edit JSON by
hand" (needs a `codezero init` subcommand), docs for pointing at your
own Cloudflare tunnel / Tailscale / etc. ~1-2 days.

**22. Multi-user distribution — make CodeZero deployable by anyone.**

> **STATUS: PLANNING ONLY.** This item captures the full scope of work
> required to let other users deploy CodeZero with their own domains and
> Cloudflare accounts. It is NOT ready for implementation. Do not start
> building any of this until the scope is explicitly approved and
> sequenced into a sprint. The items below are a research inventory,
> not a task list.

Currently CodeZero is a single-operator tool with the operator's infrastructure
baked into defaults and docs. The architecture already supports
multi-user deployment (pluggable auth, config-driven setup, dynamic
path resolution), but several hardcoded values and missing setup tooling
prevent someone else from deploying it today.

**What needs to change (inventory, not commitment):**

*Config extraction:*
- `AUTHKIT_URL` defaults to `https://authkit.yourdomain.com` in
  `mcp-transport.ts` — must come from `config.json` alongside
  `authProvider` selection
- `CODEZERO_MCP_URL` env var fallback builds from request host (fine),
  but the AuthKit URL is baked in (not fine)
- Any other env vars or defaults that assume `yourdomain.com`

*First-run experience:*
- `codezero init` command or interactive first-run wizard that prompts
  for: domain, auth provider (cookie / Cloudflare Access / AuthKit),
  Cloudflare tunnel setup, and generates `config.json`
- Today `loadConfig()` auto-generates a password and secret on first
  run, which is good, but it doesn't guide the user through domain or
  auth setup

*Cloudflare tunnel guide:*
- Current docs reference the specific `opencode` tunnel UUID and
  `yourdomain.com` hostnames — rewrite as a generic guide with
  placeholders
- Consider whether `cloudflared tunnel create` + `route dns` can be
  automated in the init script

*Documentation:*
- README rewrite aimed at "deploy this for your own domain in 10
  minutes" — currently assumes the operator's env
- CLAUDE.md references `Cloudflare tunnel`, tunnel UUIDs, etc. as
  concrete examples — fine for internal use, confusing for external
  users
- `docs/mcp.md` connection guide references specific URLs

*Repo hygiene:*
- Scrub git history or start a clean initial squash (history
  references personal infra, API keys were rotated but visible in
  diffs)
- Add LICENSE file
- Ship tests (item 20) — contributors need a safety net
- `.env.example` with all configurable values documented

*Packaging (depends on item 16):*
- Homebrew tap, `bunx codezero`, or Docker image so users don't
  clone the repo
- The init script should be the entry point, not reading CLAUDE.md

**Not in scope (things that already work):**
- Auth pluggability (AuthProvider interface is solid)
- Session management (config-driven, no hardcoded paths)
- launchd scripts (already template-based with path substitution)
- MCP transport (already builds URLs from request host)

**Depends on:** item 16 (distribution packaging), item 20 (tests).
**Gate:** do not make the repo public until this item ships.

**Agent Orchestration & Efficiency:**

**23. Agent cost guidance in MCP tool descriptions** — Update send_prompt description in packages/codezero-mcp/tools.ts to warn orchestrating agents that resumed sessions with long history consume significantly more rate-limit quota per turn. Recommend create_session for independent tasks, only resume when prior context is needed.

**24. Expose context size in list_sessions** — Add estimated_context_tokens or similar field to list_sessions response so orchestrating agents can see how heavy a session is before deciding to resume it. Pull from JSONL file size or last session.idle usage data.

**25. Model selection guidance in create_session** — Update create_session description to guide agents: use Sonnet for routine file ops/edits/git, reserve Opus for complex multi-step reasoning and architectural work.

**26. Server-side fast-path tools (zero LLM cost)** — Add new MCP tools that bypass Claude Code entirely for simple operations: read_file(slug, path), list_directory(slug, path), git_status(slug), git_log(slug, n). Direct shell commands run by Bun server, no session needed.

**27. Session lifecycle: fresh_fork option** — Add a compact/fresh_fork option to send_prompt that auto-creates a fresh session in the same project, carries over CLAUDE.md/project memory, but drops conversation history. One-flag way to avoid context bloat.

**28. Wire up get_observability aggregation** — Aggregate session.idle cost estimates into the observability endpoint: per-project spend, per-model, rolling window. Frame as "equivalent API cost" since users are on subscription plans. Becomes the "why am I hitting rate limits" diagnostic.

**29. Orchestrating agent best practices doc** — Add a section to AGENTS.md covering session hygiene, when to create vs resume, model selection guidance, and when to use fast-path tools vs full Claude Code turns.

### Tier 3 — brand + polish + finish open work

**23. AuthZero — complete the deploy cycle.** Feature branch
`rebrand-authzero` in `MCPAuthKit` has the consent-screen restyle ready.
the maintainer needs to:

- `wrangler dev` and visit the oauth/authorize URL to eyeball it
- Merge `rebrand-authzero` into `main`
- `wrangler deploy` to push to authkit.yourdomain.com

Plus follow-ups:

- Mirror the same change into `mcp-authkit-vercel` for parity with the
  Vercel edge variant (same template surgery, different file)
- Decide whether to rebrand the MCPAuthKit landing page HTML
  (`getLandingHTML`) or leave "MCP AuthKit" as the package identity
  while "AuthZero" is the user-visible consent brand

**24. OpZero.sh `AuthPage.tsx` pre-redirect styling.** The small
"Continue" page in OpZero.sh that precedes the AuthKit redirect could
adopt the glass-card + gradient-text look so the whole auth flow feels
consistent. Minor — it's a brief interstitial most users barely see.

**25. [SHIPPED] Onboarding / landing page / docs for CodeZero.** There's no
marketing page or onboarding. If CodeZero goes public (item 17), it
needs:

- A short landing explaining what it is and why (one page, matching
  the cyberpunk aesthetic)
- A docs site or detailed README with the architecture, the Channels
  flow, the launchd install, the cloudflared setup
- Screenshots of the mobile UI in action
- Link to the GitHub repo

~half day if we have good screenshots already.

**26. [SHIPPED] Keyboard command palette.** Cmd+K opens a searchable palette of
sessions, projects, and actions (New Session, Open Info, Toggle
Sidebar, Logout, etc). Good desktop ergonomics, mostly irrelevant on
mobile. ~half day.

**27. [SHIPPED] Auto-memory UI.** Surface what's in
`~/.claude/projects/<slug>/memory/` for the current session's project.
Read-only list in the SessionInfoSheet would be a start. Edit would be
bigger. Small read-only variant.

**28. [SHIPPED] Cloudflare Access as optional auth path.** Instead of our
form-cookie, users who have Cloudflare Zero Trust set up can put Access
in front of `Cloudflare tunnel` and our server just trusts the
`Cf-Access-Jwt-Assertion` header. Implement `CloudflareAccessAuthProvider`
against the existing `AuthProvider` interface. The hard part is the
Cloudflare dashboard config (user action), not our code.

### Tier 4 — stretch, fun, long tail

**29. RemoteTrigger cloud cron UI.** We decoded `RemoteTrigger` as a
CRUD client for Anthropic's scheduled-cloud-agents API. Expose a panel
in the UI that lists your triggers, lets you create new ones, and lets
you fire `run` from the phone. Depends on OAuth credentials being
present for Claude Code. Half a day.

**30. [SHIPPED] Session search.** Find sessions by message content, not just
title. `GET /api/search?q=query` scans all JSONL files lazily (index built
on first request), returns up to 20 matches sorted by mtime with snippets.
Command palette (`Cmd+K`) fetches search results on 2+ char queries,
300ms debounce, shows "Search Results" group with title + snippet under each
result. Text content from both user and assistant messages is indexed.

**31. Dark/light toggle.** We're dark-only. Toggle is trivial since
Tailwind v4 supports it at the class level and our tokens are already
HSL variables. The actual design work to make the light variant look
good is the real cost. Skip unless someone complains.

**32. BUDDY Tamagotchi.** If the research probe confirms it's real and
scriptable, a small idle-clicker in the sidebar that reacts to session
activity (DEBUGGING stat increases with tool calls, CHAOS with aborts,
SNARK with errors). Pure fun. Low priority, but would make the UI
memorable.

**33. Skills / plugins / MCP management and discovery.** Extend CodeZero
to manage Claude Code's installed capabilities: skills, slash commands,
MCP servers, and agents. The goal is a `/skills` command (analogous to
`skills.sh` in opencode) that lists available skills with descriptions,
lets users install from URLs or the filesystem, and surfaces which skills
are active for the current project. Also handles plugin discovery:
scan `~/.claude/plugins/` and `~/.claude/agents/` and expose them in
the UI alongside the existing session metadata. The `find-skills` skill
probe already exists; the gap is wiring it into CodeZero's own session
management and surfacing it in the mobile UI. ~half day for the
installer/discovery layer, another half for the UI.

**34. Built-in brainstorming with visual companion.** Add a native
`/brainstorm` command in the PromptBox that opens a brainstorming
session — wired into the same skill that this agent uses. This makes
ideation a first-class CodeZero feature rather than a one-off CLI
workflow. The command opens a full-screen brainstorming overlay with
the same one-question-at-a-time flow. After the user approves a design,
it auto-generates a spec file in `docs/superpowers/specs/` and queues
it for wave execution. Also wires in the visual companion (web-based
mockup browser) so design discussions can include live diagrams.
Estimated: ~1 day.

**35. Swarm mode — autonomous wave planning and execution.** Extend the
orchestrator to work in fully autonomous mode: given a natural-language
goal, the orchestrator breaks it into implementation waves, dispatches
agents per wave, integrates results, and self-corrects on failures —
all without prompting the user. The orchestrator already has the wave
pattern (`.agent-log/`, per-wave commit, `Roadmap.md` updates). The
gap is: auto-scoping ("what can I ship in wave N?"), retry logic for
failed agent tasks, and a progress HUD in the UI that shows wave
number, items in flight, and completed count. Also add a "pause" affordance
so the user can interrupt mid-wave. This is the product-level swarm:
CodeZero running CodeZero. ~1-2 days.

**36. [SHIPPED] OpZero integrations and connectors.** CodeZero currently operates
in isolation — it knows about its own sessions but not the surrounding
tool ecosystem. Surface the other OpZero projects in the UI:
- **Project browser**: scan `~/opz/` and the `opzero-sh` GitHub org for
  repos, show them in a sidebar panel with health indicators
- **Connector registry**: `opzero.sh/mcp`, `mcpauthkit`, `audit`,
  `infra`, and any other local projects get a "Open in CodeZero" action
- **Shared state**: MCP AuthKit auth state propagates into CodeZero sessions
  so agents can interact with protected OpZero APIs without re-auth
- **Cross-repo context**: when Claude Code runs in a worktree, make it
  aware of sibling repos (e.g. `opzero.sh` needs `mcpauthkit` in scope)
  via shared `.claude/projects` or a workspace manifest
Estimated: ~1 day for the project browser + connectors, half day for
cross-repo context injection.

**37. UAT mode — human-in-the-loop test runner.** Surface a UAT
(User Acceptance Testing) workflow in the UI: the user records a
sequence of browser actions (or imports from `agent-browser` output),
runs them against a target URL, and CodeZero reports pass/fail per step
with screenshots. This turns the `dogfood` skill pattern into a first-class
UI panel. The agent-browser already has the primitives; the gap is wiring
it into CodeZero sessions so test runs appear as live sessions with
structured output. Also: replay mode (rerun a recorded sequence), diff
mode (compare screenshots between runs), and CI export (JSONL test
results for GitHub Actions). ~half day.

**38. MCP server monitoring and debugging.** When Claude Code loads MCP
servers (from `~/.config/claude/mcp_servers.json` or project-level
config), surface their status in CodeZero: which servers are connected,
latency per call, error rates, tool inventory. This extends the existing
`SessionInfoSheet` metadata section and adds a dedicated `MCP Monitor`
panel accessible from the header. On the server side, instrument the
`SessionProcess` to log MCP tool calls with timing. On the client side,
aggregate and display per-server metrics. Also add a "relay MCP traffic"
toggle that logs all MCP request/response payloads for debugging.
Estimated: half day.

**39. Observability — session telemetry and analytics.** Give CodeZero
insight into its own usage patterns beyond per-session cost tracking:
- **Activity timeline**: per-project bar chart of session frequency and
  duration over the last 30 days (stored in `~/.config/opzero-claude/state.json`)
- **Tool usage heatmap**: which tools are used most across all sessions
- **Token burn rate**: rolling 7-day average cost with projection
- **Session health**: flag sessions that ended in error, had high token
  counts, or ran unusually long
- **Fleet pulse**: summary of live sessions across projects at a glance
All of this lives in a new "Observability" panel in the header,
mirrors the Fleet dashboard concept but for usage patterns rather than
active agents. ~half day.

**40. Computer Use — surface Claude's browser control in the UI.**
Claude Code 2026-w14 introduced native computer use (browser control
via screenshots + mouse/keyboard actions). When a session uses
computer use, the message thread should surface the screenshots as
inline images and render mouse/keyboard actions as a styled overlay or
annotation layer. Beyond rendering:

- **Initiate from the phone**: a "Browse" affordance in the prompt box
  that tells Claude to open a URL and interact. The user watches
  screenshots flow in the thread in real time and can type follow-up
  instructions ("click the login button", "fill in the email field").
- **Screenshot rendering**: the `tool_use` content blocks for computer
  use include base64 screenshots. Add a new `ComputerUsePart.tsx` that
  renders them as inline images with a zoom-on-tap and an action
  overlay (click point, typed text, scroll direction).
- **Streaming**: with `--include-partial-messages`, screenshots arrive
  as `tool_result` content blocks. Render them as they land — no
  waiting for the full turn to finish.
- **Mobile UX**: screenshots are wide (1280px+). On the iPhone viewport,
  render them full-width with a pinch-to-zoom and a light border, not
  squished to `max-w-[85%]`.

Depends on the exact computer-use tool schema from Claude Code 2026-w14.
Probe the release notes at `code.claude.com/docs/en/whats-new/2026-w14`
to extract the `tool_use.name` and `tool_result` shapes before building.
Estimated: ~1 day for the renderer + probe, another day for the
initiate-from-phone flow.

**41. Session sidebar overhaul — naming, sorting, controls.**
The sidebar is hard to use on mobile: project slugs overflow, session
titles are truncated first-message fragments, empty project groups
clutter the list, and there's no way to sort or rename. Redesign:

- **Human-readable titles**: derive from first user message (current),
  but allow inline rename (tap title to edit, persisted to state.json).
  Fall back to `session.metadata.model + relTime` when no user message.
- **Hide empty groups**: projects with zero sessions collapse to a
  single line or hide entirely behind a "Show all projects" toggle.
- **Sort controls**: default by most recent activity (`lastMessageAt`
  desc). Add a sort dropdown: Recent, Oldest, Alphabetical, Status
  (live first). Persist preference to state.json.
- **Session controls on long-press / context menu**: effort level
  (low/medium/high/max), model override, permission mode change,
  rename, pin to top, archive. These mutate session metadata and
  persist across reloads.
- **Effort level**: expose Claude Code's `--effort-level` flag per
  session. Show as a small badge on the session row (e.g. "H" for
  high). Configurable from the session context menu or the
  SessionInfoSheet.
- **Compact mode**: option to show sessions as single-line rows
  (title + status dot only) for dense sidebar on mobile.
- **Search integration**: the existing Cmd+K search should also
  filter the sidebar in real time when the sidebar search input is
  focused.

Estimated: half day for sort + hide empty + rename, another half for
effort level + context menu + compact mode.

### Rejected

**7. Fork session (current implementation).** Deferring because `claude --fork-session --resume <id>` may yield a new session ID at runtime (emitted in `system.init.session_id`) that differs from the source ID. The current architecture keys `SessionProcess` by the ID passed at spawn time, and the reducer wires events by `session.id`. Correctly handling the ID remap requires non-trivial changes to pool keying and store upsert semantics. Revisit after the channels plumbing stabilizes or if Claude Code's fork primitive emits the new ID synchronously before the first prompt.

**9. Subagent output streaming.** Requires subagent intermediate stream events to flow back to the parent, which is architecturally impossible without the channels mechanism being wired into subagent sessions. The channels plugin (`packages/opzero-channel/`) would need to be loaded in subagent subprocesses via `--dangerously-load-development-channels` and the relay path for subagent events is not yet built. This is gated on the full channels story being complete.

### Deferred / non-goals

- **Push notifications.** User explicitly said they don't want them.
  All `session.idle` / `session.error` surfacing stays in-app only.
- **Multi-user / team mode.** CodeZero is designed for one user's
  devices talking to one user's claude sessions. No plans to add
  multi-tenancy.
- **Replacing Claude Code.** We wrap, we don't reimplement.

## Decisions worth remembering

- **Package name stays `opzero-claude`.** Only the UI brand changed to
  CodeZero. Never rename on disk, in the repo, or in package.json.
  Touching those breaks launchd, the github remote, config paths.
- **Mirror sessions are writable.** We relaxed the 60-second mtime
  guard after the maintainer pointed out it was blocking a path that actually
  worked. Never re-add hard blocking on mirror; degrade gracefully
  instead (try channel, fall back to resume).
- **Distribution auth model = pluggable.** `AuthProvider` interface is
  the extension point. Future providers (OIDC, Cloudflare Access, etc.)
  drop in without touching routes.
- **No emojis.** In source, in commits, in user-facing strings, in
  docs, and in the auth pages we control. Cyberpunk minimalism.
- **JSONL is source of truth.** The tailer reads it, history.ts parses
  it, the SessionProcess stdout path and the channel inject path both
  end up writing to it. Don't build state that lives anywhere else.

## Reference

- `CLAUDE.md` — architecture, conventions, style rules, gotchas
- `docs/channels.md` — Channels user-facing documentation
- `docs/remote-trigger-findings.md` — research doc that led to Channels
- `docs/launchd.md` — autostart runbook
- `scripts/launch-opzero.sh` — wrapper launcher for channel-enabled sessions
- GitHub: https://github.com/OpZero-sh/CodeZ (private)
- Live: https://Cloudflare tunnel
