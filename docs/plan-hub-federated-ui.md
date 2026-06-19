# Plan: Hub-federated CodeZero UI

Goal: when a user is logged into CodeZero via OAuth (MCPAuthKit), the SPA
also shows sessions from their other machines, routed through the Hub at
`code.opzero.sh`. When unauthenticated, the SPA behaves exactly as today
(local-only, localhost:4097 server).

Non-goal: rewriting the local-only path. The existing `/api/*` + `/api/events`
contract stays. Hub federation is additive.

---

## Architecture

```
  Browser SPA
   |
   +-- Local tier  (always, when served by local Bun server)
   |     GET /api/projects, /api/sessions/:id, POST prompt, SSE /api/events
   |     cookie auth, same-origin
   |
   +-- Hub tier    (only when OAuth session present)
         Bearer mat_* from MCPAuthKit
         GET https://code.opzero.sh/api/machines
         GET /api/machines/:mid/projects
         GET /api/machines/:mid/sessions/:sid
         POST /api/machines/:mid/sessions/:sid/prompt
         WS  /api/stream   -> multiplexed events for every remote session
```

The SPA's store keeps two disjoint partitions:
- `local.*` — projects/sessions/messages from the local server
- `remote[machineId].*` — same shape, per remote machine

Sidebar groups by "This machine" + one group per remote machine. Selecting
a remote session threads `machineId` through every action.

---

## Work breakdown

### A. Hub Worker — browser-facing API (`codez-hub/src/`)

New file `src/routes/browser.ts` (or fold into `src/index.ts`). All routes
require a valid `mat_*` bearer; reuse existing `requireAuth()` path.

1. `GET /api/machines` → `Machine[]` (from D1 `machines` table scoped to user_id)
2. `GET /api/machines/:mid/projects` → fan-out: DO relays a new
   `list_projects` command over WS to machine; 30s timeout; cache result.
3. `GET /api/machines/:mid/projects/:slug/sessions` → same pattern, new
   `list_sessions` command.
4. `GET /api/machines/:mid/sessions/:sid` → new `get_session_full` command
   that returns `{session, messages}` (mirrors local route).
5. `POST /api/machines/:mid/sessions/:sid/prompt` → existing `send_prompt`
   command, just exposed under the browser prefix.
6. `POST /api/machines/:mid/sessions/:sid/abort` → existing `abort_session`.
7. `POST /api/machines/:mid/projects/:slug/sessions` → existing
   `create_session`.
8. `GET /api/stream` — **WebSocket**, not SSE. Worker CPU budget is friendlier
   to WS than long-lived SSE, and Hub DOs already speak WS. Browser opens
   one WS, subscribes to `{machineId, sessionId}` pairs, DO forwards every
   `event` envelope matching the subscription. Events already flow
   machine→DO over the agent WS; this is a second fan-out stage.

### B. Hub DO — event fan-out (`codez-hub/src/hub-agent.ts`)

Today events land in a circular buffer for polling. Add a browser-subscriber
map: `subscribers: Map<wsId, { userId, filter: Set<machineId:sessionId> }>`.
On each incoming machine `event` envelope, iterate subscribers whose filter
matches and `ws.send(JSON.stringify(envelope))`. Keep the circular buffer
for MCP `poll_events` parity.

New command actions to add in `src/protocol/types.ts` and
`codez-hub/client/agent.ts`:
- `list_projects` → local `GET /api/projects`
- `list_sessions` → local `GET /api/projects/:slug/sessions`
- `get_session_full` → local `GET /api/sessions/:sid?slug=:slug`

### C. Machine-side agent — finish outstanding items

1. **Stable machineId**: persist UUID at `~/.config/opzero-claude/machine-id`
   on first boot. Generate with `crypto.randomUUID()`. Pass into
   `HubMachineAgent` constructor.
2. **Session change notifications**: in `server/hub.ts`, subscribe the
   `hubAgent` to the `EventBus` for `session.created|updated|idle` and
   call `hubAgent.updateSessions(currentSessions())` (coalesce to 1/sec).
   Already partial — verify and finish.
3. **New command handlers** for `list_projects`, `list_sessions`,
   `get_session_full`. Reuse `listProjects` / `listSessionsForProject` /
   `loadSessionMessagesAndMetadata` from `server/claude/history.ts`.

### D. SPA — OAuth-aware remote mode (`web/src/`)

1. **Auth detection**: `authClient.ts` already calls `/api/auth/me` and
   `/api/auth/provider`. When `provider === "authkit"` and a session exists,
   fetch the `mat_*` token from the local server (new endpoint
   `GET /api/hub/token` that reads `~/.config/opzero-claude/hub-auth.json`)
   and expose `hubEnabled: true` in the auth slice.
2. **New API client**: `web/src/lib/hubApi.ts` — mirrors `api.ts` but hits
   `https://code.opzero.sh/api/*` with `Authorization: Bearer ${mat}`.
   No cookies, no `credentials: "include"`. Handles 401 → trigger refresh
   by calling the local `/api/hub/token` again.
3. **Store partitioning**: extend `web/src/lib/store.ts` state with
   `remote: Record<machineId, { projects, sessions, messages }>`. Add
   dispatchers keyed by `{source: "local" | machineId}`. Every reducer that
   mutates projects/sessions/messages takes a source key.
4. **Hub event stream**: `web/src/hooks/useHubStream.ts` — opens WS to
   `wss://code.opzero.sh/api/stream?token=…`, pushes events into store
   under the right `machineId` partition. Subscribes to open remote
   sessions; resubscribes on selection change.
5. **Sidebar changes**: `web/src/components/SessionList.tsx` — new group
   header row per remote machine ("MacBook Pro · last seen 3m ago"), cyan
   dot for online, muted for offline. Local group unchanged.
6. **URL sync**: extend `useUrlSync` path scheme to
   `/m/:machineId/s/:slug/:sessionId` for remote sessions; keep
   `/s/:slug/:sessionId` for local.
7. **PromptBox / actions**: thread `machineId | null` through the current
   session selection. `null` → local API, non-null → hubApi.
8. **Offline remote machines**: if WS to Hub says a machine is offline,
   still show its cached session list (read-only, grayed), disable prompt
   box with a "machine offline" hint.

### E. Local server — token handoff for SPA

One new route in `server/routes/` (e.g. `hub-token.ts`):
- `GET /api/hub/token` → reads `~/.config/opzero-claude/hub-auth.json`,
  returns `{ accessToken, expiresAt }`. Requires existing local auth.
  Never returns refresh token. Rotates through `getAccessToken()` so the
  SPA always gets a fresh `mat_*`.

---

## Sequencing (build in this order)

1. C1 + C2 first (stable machineId + session change notifications) — they
   unblock accurate Hub state regardless of the UI work.
2. B + C3 (new Hub command actions + DO fan-out) — server plumbing for
   remote reads + live events.
3. A (Hub Worker browser API) — thin HTTP layer over the new commands.
4. E (local token handoff endpoint).
5. D1–D4 (SPA auth detection, hubApi client, store partitioning, WS hook).
6. D5–D8 (UI: sidebar groups, URL sync, prompt routing, offline state).
7. End-to-end dogfood: two machines both running CodeZero with Hub agent,
   open SPA on machine A, verify machine B's sessions appear and stream.

---

## Risks / open questions

- **WS fan-out scale**: Workers DOs have a per-instance WS cap
  (one-DO-per-user model should be fine; verify). If hit, fall back to
  SSE with shorter reconnects.
- **Token in the browser**: `mat_*` in JS memory is acceptable (matches
  MCP client model), but must NOT be persisted to localStorage. Only in
  the auth store slice; refreshed on page load via `/api/hub/token`.
- **CORS**: Hub Worker must `Access-Control-Allow-Origin` the local
  server's origin (`http://127.0.0.1:4097` and the Cloudflare-tunneled
  `claude.opzero.sh`) with `Allow-Credentials: false` (bearer auth, no
  cookies).
- **Session ID collisions across machines**: the Hub already keys sessions
  by `(machine_id, session_id)`; the SPA must do the same. Do not use a
  bare `sessionId` as a map key anywhere in the remote partition.
- **Local mode unchanged**: every change in D must be feature-gated on
  `hubEnabled`. Unauthenticated + no-OAuth-provider path is a regression
  risk; cover with a smoke check before shipping.
- **Type duplication**: the Hub and CodeZero both ship typed protocols.
  Already solved by sibling-dir imports from `../../codez-hub/client`.
  New command actions must be added to the Hub's `protocol/types.ts`
  first, then picked up on both ends.

---

## Out of scope for this milestone

- Multi-user Hub (user_id today is just the MCPAuthKit subject; fine).
- Channels / permission relay to remote machines.
- Fork session across machines.
- iMessage / push notifications for remote session state.
- A standalone Hub-hosted SPA (Hub doesn't serve static assets here; the
  SPA is still served by the local Bun server). We can revisit hosting
  the SPA on Cloudflare Pages later if we want phone-without-laptop
  access — that's a larger architectural shift.
