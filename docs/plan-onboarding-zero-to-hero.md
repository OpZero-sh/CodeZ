# CodeZ/OpZero — zero to federated hero (onboarding redesign)

> Canonical hosts (product-owner directive, 2026-06-18): auth host = **auth.opzero.sh**, hosted hub = **code.opzero.sh**. Every `*.open0p.com` host (`code.open0p.com`, `authkit.open0p.com`) is **LEGACY**, to be retired behind redirects. This document designs *against* the canonical names. It does **not** edit domain literals in code/tickets (another agent owns that); it flags every legacy occurrence it depends on.

---

## 1. Current reality — the verified end-to-end journey

A user becomes a "federated hero" by crossing three legs: **signup** (browser, MCPAuthKit) → **machine setup** (`codez setup`) → **federated** (drive the fleet at code.opzero.sh and via the `/mcp` connector). Here is what actually happens today.

### Leg 1 — Signup / login (MCPAuthKit, the identity root)
- MCPAuthKit is a single-file OAuth 2.1 / PKCE gateway (`MCPAuthKit/src/worker.js`). It issues `mat_` access tokens (1h) and `mrt_` refresh tokens (30d) via `authorization_code` + PKCE/S256 and `refresh_token` grants only (`worker.js:482-490` — there is **no** `client_credentials` grant and no machine-mint endpoint).
- Login/signup happens on AuthKit's own consent screen; the user row lives in Neon `authkit_users`; tokens live in D1 `access_tokens` and are dual-written to Neon so the hub can validate cross-DB.
- Discovery issuer is **host-derived** (`worker.js:226`, `${url.protocol}//${url.host}`), so binding a new hostname auto-corrects discovery with no issuer code change.

### Leg 2 — Machine setup (`codez setup`)
- In codez-hub **the token IS the identity**. A machine's hub identity is 100% derived from the `mat_` it presents at the `/ws` upgrade: the Worker SHA-256-hashes it, reads `user_id` from MCPAuthKit's D1 (`codez-hub/src/auth/tokens.ts:21-44`), and routes into a per-user Durable Object via `env.HUB.idFromName(userId)` (`codez-hub/src/index.ts:224`). The machine never chooses its `user_id`.
- `codez setup` runs `ensureHubAuth` (`CodeZero/bin/setup.ts:110-143`). Lacking a real owner login, it computes `email = process.env.HUB_EMAIL ?? opz-${hostname()}@opzero.local` (`setup.ts:126`; same literal at `bin/cli.ts:50`) and calls `loginHeadless` (`CodeZero/server/hub-auth.ts:323-361`), which runs `runAuthorize(mode='signup')` **first**. Signup mints a brand-new `usr_...` per email. **That is the split-brain.**
- A complete interactive PKCE browser login already ships — `login()` at `hub-auth.ts:225-269` (registers a client, spins a loopback callback, opens the browser, exchanges the code, persists `StoredAuth`) — but it is wired only into the standalone `bin/interactive-login.ts`, **not** into `setup`.
- At boot `startHubAgent` (`CodeZero/server/hub.ts:285-359`) loads the token, reads a stable random `machineId` (`hub.ts:165-178`, a label only, not identity), and opens the WS. The agent reports `codezVersion` in its `register` frame (`packages/client/src/agent.ts:323`); the hub persists it to `machines.codez_version` (`schema.sql:12`).
- An identity-continuity guard runs on the `registered` ack: `checkIdentity` compares the echoed `userId` to the persisted `<configDir>/hub-user-id`; a **mismatch is fatal** (`state=identity_error`, supervisor stops; `agent.ts:343-383`). This catches *re-pointing*, not wrong-account first-provisioning.

### Leg 3 — Federated (hosted SPA + transport + connector)
- The hub is a stateless Cloudflare Worker; the per-user DO `HubAgent` owns all machine WS connections. `online` is memory-only (`hub-agent.ts:518`, `online: this.machines.has(...)`); D1 `last_seen_at` is the durable registry.
- The hosted SPA at code.opzero.sh authenticates via browser PKCE, then sets `store.localMachineId = null` (`App.tsx:469-475`) and lists machines via `store.loadRemoteMachines → loadRemoteProjects` (`store.ts:468-507`). **The data is loaded into `state.remote`.**
- The SPA is served by the hub Worker itself via `env.ASSETS` with `run_worker_first:true` (`wrangler.jsonc:38-43`), so in hosted mode the page origin already **is** `https://code.opzero.sh`.
- The hub already implements the full claude.ai connector contract: `/mcp` Streamable HTTP behind `mcp:tools`, the `401 + WWW-Authenticate` challenge, and a PRM at `/.well-known/oauth-protected-resource` whose `resource` self-reports the request origin (`src/index.ts:18`). The OAuth chain (resource → PRM → AS metadata → DCR → authorize → token → `/mcp`) is wired end-to-end.

### Already shipped — do NOT rebuild
- MCPAuthKit = single OAuth for hosted UI session **and** `/mcp` connector (both delegate to the same AUTHKIT_URL worker).
- MCPAuthKit user login over minted `mat_`/`mrt_` tokens; `refresh_token` grant works (no `mrt_` rotation).
- Machine dashboard at code.opzero.sh; per-machine session list (start/resume/abort/fork); wake sleeping machines from the UI (`hub-agent.ts:570-609`).
- Hardened machine-agent reconnect + token refresh (agent side): `createTokenRefresher`/`createAuthRecovery` wired into the agent at `hub.ts:322-323`; identity-continuity guard (`agent.ts:343-383`).
- Per-user DO keying (`idFromName(userId)`), wake-from-UI, per-machine session relay, `registered`-ack `userId` echo (`hub-agent.ts:370`).
- `opzero-router` host dispatch already maps `code.opzero.sh → CODEZ_HUB` and `auth.opzero.sh → MCP_AUTHKIT` (`workers/opzero-router/src/index.ts:6-9`).
- Interactive browser `login()` exists (`hub-auth.ts:225-269`) and is wired into `bin/interactive-login.ts`.

### Two ticket pointers are stale — flag, do not chase
- **CodeZero#8** points at `hub-auth.ts::provisionMachineAgent (~321-344)`. **That function does not exist.** The root cause is the synthetic-email default at `bin/setup.ts:126` + `bin/cli.ts:50` feeding `loginHeadless` (`hub-auth.ts:323-361`).
- **OpZ_cli#1** as worded does not match the on-disk OpZ_cli (2 commits): no `refreshToken`/`expiresAt`/PKCE/OAuth exists there, and `login --browser` is **still a stub** (`OpZ_cli/packages/cli/src/commands/login.ts:22-27`). This contradicts the "ALREADY DONE: MCPAuthKit OAuth implemented in OpZ_cli" bullet — that work is **not in this checkout**. See Open Questions.

---

## 2. The gap — why a freshly-set-up user is not a federated hero

**2.1 — CodeZero#8 split-brain provisioning (root cause; everything downstream depends on this).**
`codez setup` on a cloud box silently creates `opz-<host>@opzero.local`, minting a `user_id` (`usr_lannkb13...`) different from the owner (`jeff@opzero.io` = `usr_d8a7ze5...`). The machine registers online and healthy — in its *own* per-user DO. The owner, logged into code.opzero.sh under `usr_d8a7ze5...`, routes to a *different, empty* DO and never sees the 4 cloud machines. Setup prints a green "machine agent provisioned" with no hint anything is wrong. The `identityMismatch` guard does **not** fire here (a machine provisioned once under a consistent throwaway id registers cleanly); it only catches later re-pointing.

**2.2 — CodeZero#6 / #7 phantom + empty hosted UI.**
Even when machines *are* under the owner, the SPA looks dead on first load:
- Nothing is auto-selected (`store.selected` stays all-null, `store.ts:75`), so the header reads "No session selected" over fully-loaded `state.remote` — **CodeZero#7**.
- The sidebar renders a hardcoded "This machine" header (`SessionList.tsx:783`) and "No projects yet" banner (`:776-780`) describing a local machine that does not exist in hosted mode; the New Session dialog defaults its picker to `<option value="local">` (`:329, :457`) which routes to local `/api` endpoints that fail — **CodeZero#6**.
- `loadProjects()` fires unconditionally in hosted mode (`App.tsx:455-458`) and errors against the hub Worker, leaking into the global ErrorBanner.

**2.3 — Silent success (no proof of federation).**
`codez setup` ends in a generic "setup complete" banner that proves the script ran, not that the user is federated. The existing `codez hub status` (`cli.ts:58-80`) and the setup poll both read `/api/health/details`, which has **no hub subsystem** — it returns `selfHeal.getStatus()` (only `session:*`/`bridge:*`/`auth`, `self-heal.ts:65-99`). The real `hub.connected` lives at `services-settings.ts:62-63`. So today's "success" points at the wrong endpoint and the existing "hub connected" poll is dead.

**2.4 — Token expiry, stale agents, legacy domains.**
- **OpZ_cli#1**: the deploy CLI has no token-expiry awareness; a short-lived bearer dies with a raw 401 and no auto-recovery. (The *machine-agent* token path is already auto-refreshing — these are different concerns; see Open Questions.)
- **CodeZero#9**: the deployed cloudchamber agent is a stale build lacking `list_projects`/`list_sessions`; unknown actions throw, `loadRemoteProjects` swallows the 502 (`store.ts:501-506`), and the machine shows online with silently-empty projects and no UI hint.
- **CodeZero#10 + legacy domains**: the SPA hardcodes `code.open0p.com` REST (`hubApi.ts:3`), `wss://code.open0p.com` (`useHubStream.ts:43`), and the `authkit.open0p.com` issuer (`hubAuth.ts:11`). The hub PRM advertises `authkit.open0p.com` (`codez-hub/src/index.ts:19`). These work only because `opzero-router` still answers the legacy hosts — the exact coupling that blocks retiring `*.open0p.com`. Compounding: `_org-profile/CLAUDE.md:96` warns **`*.opzero.sh` SSL is currently broken** — the true gating blocker for the canonical cutover and the connector.

---

## 3. The redesigned journey — zero to federated hero

The target experience, stage by stage, on canonical **auth.opzero.sh** + **code.opzero.sh**, ending in an explicit "you are federated" confirmation in **both** the CLI and the hosted UI.

### Stage 1 — Sign in once, machine attaches under YOUR account
`codez setup` no longer self-provisions a throwaway identity. Auth moves to the **front** of setup (before the long install/build) so the one interactive moment happens while the user is watching.

- **Interactive (any box with a browser) — the real, implementable fix.** `ensureHubAuth` calls the existing `login()` (`hub-auth.ts:225-269`) instead of `loginHeadless(synthetic-email)`. The owner completes OAuth once on auth.opzero.sh; the persisted token is the owner's, so the agent registers into the owner's DO and appears in the dashboard immediately.
  ```
  $ codez setup
  [setup] Sign in to attach this machine to your account.
  [setup] Press Enter to open auth.opzero.sh, or paste this URL on another device: ...
     → owner logs in ONCE
  [setup] ✓ Attached to jeff@opzero.io  (usr_d8a7ze5...)
  ```
- **Headless (cloud boxes, no browser).** **No automated owner-identity path exists today** (see 3.5). Headless boxes use the explicit `HUB_EMAIL`/`HUB_PASSWORD`/`CODEZ_HUB_TOKEN` escape hatch, or the manual token-transplant in Stage 5. The detector below makes the wrong-account outcome impossible to miss. Headless detection (no `DISPLAY` / `SSH_CONNECTION` set / `--headless`) skips the browser spawn and prints copy-paste instructions instead.

Because many machines share one `user_id`, they do **not** collapse: `machineId` separates identity from label, so N machines = N distinct D1 rows under one owner, each with its own hostname. Unified identity *federates* machines; it does not merge them.

### Stage 2 — `codez setup` ends in an honest "you are federated" screen
After the daemon boots and registers, setup renders a federation-specific banner driven by `verifyFederation()`, which reaches the agent **over HTTP** (`GET /api/settings/services`, not an in-process `agent.getStatus()` — the agent lives in the server process, not the setup CLI). It asserts four claims:

1. **account** — `GET auth.opzero.sh/oauth/userinfo` (new body-parse of `{sub, email}`) using the stored token.
2. **machine registered** — the `userId` the hub echoed (`codez_hub_ws` status detail) and the email it carries. **Honesty caveat:** with a single machine token, `sub === userId` by construction, so this cannot *programmatically* prove "matches the owner" until a distinct owner login exists. So the screen **surfaces the email** (`jeff@opzero.io` vs `opz-studio-mbp@opzero.local`) so the operator can eyeball a throwaway, rather than rendering a false green check.
3. **hub.connected** — from `/api/settings/services` `codez_hub_ws` status (the real source), polled to cover the cold-start window.
4. **token** — stored `expiresAt` in the future + `refreshToken` present + refresher wired (`hub.ts:322`).

```
============================================================
  You are federated.
============================================================
  account   ok   jeff@opzero.io  (usr_d8a7ze5...)
  machine   ok   "studio-mbp" registered under jeff@opzero.io
  hub       ok   connected  (code.opzero.sh)
  token     ok   valid until 14:32 UTC, refresh present
  → Your machine is live at https://code.opzero.sh
  → Run 'codez status' anytime to re-check.
============================================================
```
The split-brain failure renders loudly: `machine [!] registered as opz-studio-mbp@opzero.local — joined a DIFFERENT account; will NOT appear under jeff@opzero.io. Fix: re-run 'codez setup' and sign in as yourself.`

A new top-level `codez status` (alias `hub status`, replacing the `/api/health/details` dump) asserts the same four claims, supports `--json`, and returns distinct exit codes (0 all-pass, 1 not-connected, 2 wrong-account) per the existing exit-code convention.

### Stage 3 — Open code.opzero.sh and land on a live machine
- **Auto-select** the first online machine (most-recently-seen, preferring a machine whose projects array is **non-empty** so a stale agent does not win the sort) and its newest session — or pre-arm the New Session dialog for it. Guarded by `localMachineId === null && selected.sessionId === null` so it never clobbers URL hydration. Re-runs idempotently as the async project/session fan-out resolves. (CodeZero#7)
- **Kill the phantom**: in hosted mode (`localMachineId === null`) suppress the "This machine" header, the local `grouped` map, and the local "No projects yet" banner. New Session picker defaults to the first online remote machine and drops `<option value="local">`. A dedicated hosted empty state — "No machines federated to this account yet — run `codez setup`" — names the symptom of the split-brain instead of showing a misleading local banner. (CodeZero#6)
- **Per-machine health**: each machine group header shows online/heartbeat freshness (via `heartbeatAgeMs`) and a "needs upgrade — projects unavailable until upgraded" pill driven by the **client-side** stale-agent signal (online machine whose `list_projects` returned the relayed "Unknown action" 502) plus an optional `needsUpgrade` flag from the hub's version floor. The pill keys strictly on version/Unknown-action, **never on empty-projects alone**, so a mis-provisioned (#8) machine is not mislabeled "stale."

### Stage 4 — Same-origin, canonical everywhere
Every hosted call goes same-origin (`window.location.origin`), so a user on code.opzero.sh makes zero cross-origin calls and a future host rename needs zero SPA edits. The auth issuer points at the canonical `auth.opzero.sh`. Legacy `code.open0p.com` HTML GETs 301 to canonical at the edge; legacy `/api`, `/ws`, `/mcp`, `/.well-known/` keep serving so un-upgraded agents/connectors stay alive during cutover.

### Stage 5 — Re-provision the 4 orphaned cloud machines + redeploy the stale agent
The 4 boxes are headless and online in their *own* throwaway DOs. Re-provisioning is a **token swap**, not full re-setup, but the identity guard makes a naive swap fatal. Interim working path (no new MCPAuthKit primitive required):
1. On a box that *has* a browser, run `login()` to mint owner `mat_`/`mrt_`.
2. Copy `hub-auth.json` to the cloud box **and delete `<configDir>/hub-user-id`** so `checkIdentity` re-learns the owner id instead of going fatal.
3. Restart. The old throwaway DOs go idle and reap via the 90s heartbeat timeout (`hub-agent.ts:467-488`).

For the cloudchamber box this pairs with the **CodeZero#9 redeploy** (same SSH session). The redeploy reuses the same `machineId` + `hub-auth.json`, so the machine re-registers to the same DO row.

### Stage 6 — Publish code.opzero.sh/mcp as a claude.ai connector (E2E)
The transport and OAuth chain are already wired; the remaining work is **canonical-domain correctness + a verified runbook**, and it is **gated on the `*.opzero.sh` SSL fix** (infra, out of scope here). Deliverable: a smoke test asserting `code.opzero.sh/mcp` → 401 + `WWW-Authenticate` → PRM `authorization_servers === ["https://auth.opzero.sh"]` → `auth.opzero.sh` AS metadata with S256. The connector-add step is documented but un-runnable until SSL is healthy.

---

## 4. Concrete change plan (grouped by ticket)

| Ticket | Repo | File:line | Change |
|---|---|---|---|
| **#8** (critical) | CodeZero | `bin/setup.ts:110-143,126,131` | Rewrite `ensureHubAuth`: default to interactive `login()` (`hub-auth.ts:225-269`) instead of `loginHeadless` with the `opz-<host>@opzero.local` synthetic email. Move auth before install/build. Detect headless (`DISPLAY`/`SSH_CONNECTION`/`--headless`) and print copy-paste URL + escape-hatch instructions. Keep `HUB_EMAIL`/`HUB_PASSWORD`/`CODEZ_HUB_TOKEN` reachable (headless has no other path today — do NOT delete). |
| **#8** | CodeZero | `bin/cli.ts:50,42-45` | Remove synthetic-email default in `cmdHubLogin`. Add `--login`/`--headless`/`--token` flags to `SetupOptions` (`setup.ts:10-16`) + cmdSetup mapping; wire `interactive-login.ts`'s `login()` into the interactive path. |
| **#8** | CodeZero | `server/hub-auth.ts:323-361` | Drop signup-first as the provisioning default in `loginHeadless`; keep as login-only helper for the explicit-credentials escape hatch. After `login()` returns, call `GET /oauth/userinfo` to fetch `{sub,email}` and persist `email` into `StoredAuth` so the federated banner + idempotent re-run check stay intact. |
| **success** | CodeZero | `bin/setup.ts:322-332` | Replace generic banner with `verifyFederation()` that polls `GET /api/settings/services` (HTTP, post-boot), gathers the 4 claims, and renders the "You are federated" / "NOT under your account" screen. **Do not** model the poll on the dead `/api/health/details` poll (`setup.ts:309-313`); read `codez_hub_ws` status. |
| **success** | CodeZero | `bin/cli.ts` | Add top-level `codez status` (alias `hub status`) asserting the 4 claims via `/oauth/userinfo` + `/api/settings/services` + `readStoredAuth`; `--json`; exit codes 0/1/2. Replace `cmdHubStatus`'s `/api/health/details` dump. |
| **success** | CodeZero | `server/routes/services-settings.ts:62-63` | Extend the `codez_hub_ws` row to include the resolved `getStatus().userId` and the account email so `codez status`/setup can compare without a second hub round-trip. Path is `/api/settings/services` (`index.ts:76`). |
| **#6** | CodeZero | `web/src/components/SessionList.tsx:329,367,457,776-785` | Derive `hosted = localMachineId === null`. Render local branch ("This machine" header, local `grouped.map`, "No projects yet") only when `!hosted`; add hosted empty state for `remoteGroups.length===0`. Default New Session `machineId` to first online remote (not `"local"`); render `<option value="local">` only when `!hosted`. Use `openSession(slug, id, source)` / `selectSession(source, slug, sessionId)` arg order. |
| **#7** | CodeZero | `web/src/lib/store.ts:468-521` | Add idempotent `autoSelectFirstOnline()`; call at end of `loadRemoteMachines` and from `loadRemoteSessions` when `selected.sessionId===null && localMachineId===null`. Prefer a machine with non-empty projects; fall back to first-online-by-lastSeenAt. Also short-circuit/swallow `loadProjects()` in hosted mode so the suppressed local branch leaves no stray ErrorBanner entry. |
| **#9** | CodeZero | `web/src/lib/store.ts:501-506` | Convert bare `catch {` to `catch (err)`; when `list_projects` fails with relayed "Unknown action" (502 body via `hubApi.req`), tag `projectsError:'stale-agent'` on the remote entry (add field to `RemoteMachineState` + client types) instead of silent `projects:[]`. |
| **#9** | codez-hub | `src/hub-agent.ts:499-528` | In `handleListMachines`, add derived `needsUpgrade` by comparing persisted `codez_version` (may be NULL — null-guard) against an env `MIN_AGENT_VERSION` floor. Additive; mirror optional `needsUpgrade`/`heartbeatAgeMs` on `HubMachine` (`hubApi.ts:5-18`). |
| **#9** | CodeZero | `web/src/components/SessionList.tsx` (machine group header) | Render "needs upgrade — projects unavailable until upgraded" pill when `needsUpgrade || projectsError==='stale-agent'`. Coordinate the `776-832` region with the #6/#7 owner (single contiguous block; CodeZero/CLAUDE.md file-partitioning). |
| **#9** | CodeZ / codez-container | `CodeZ/server/hub.ts`; `.gitmodules`; `Dockerfile` | **The container builds `CodeZ`, and on-disk `CodeZ/server/hub.ts` has NO `list_projects`/`list_sessions` cases** (those are in `CodeZero/server/hub.ts:188,197`). A pin bump alone does NOT acquire the fix. Either (a) port the two cases into `CodeZ/server/hub.ts` and bump the container's CodeZ pin, **or** (b) repoint the container to build CodeZero. Then rebuild/redeploy the image; pinned `CODEZ_MACHINE_ID` + existing `hub-auth.json` mean same-DO re-registration. |
| **#10** | CodeZero | `web/src/lib/hubApi.ts:3` | `HUB_BASE_URL = window.location.origin`. |
| **#10** | CodeZero | `web/src/hooks/useHubStream.ts:43` | Derive WS URL from `window.location.origin` (path `/api/stream`, `wss:`/`ws:` from `location.protocol`). Also hoist `ws` to a ref and split subscription updates into a second effect keyed on a stable `machineIds.join(",")`, guarded by `readyState===OPEN` and re-sent in `onopen`, so the socket survives the load-storm. Decide explicitly whether per-session subscriptions are preserved. |
| **#10** | CodeZero | `web/src/lib/hubAuth.ts:11` | Point ISSUER at `https://auth.opzero.sh` via `import.meta.env.VITE_AUTHKIT_ISSUER` with that hardcoded fallback. **New build wiring** — plumb the var into codez-hub `build:spa`; CodeZero/web has no `.env` infra today. |
| **retire open0p** | codez-hub | `src/index.ts:388-395` | Inside `fetch`, after `const url = new URL(...)` (line 388) and before `/health` (395): if `url.hostname === "code.open0p.com"` and HTML GET, 301 to `https://code.opzero.sh + path + search`. **Exclude** `/api`, `/ws`, `/mcp`, `/.well-known/`. (Anchor is 388, not the `export default {` at 386.) |
| **retire open0p** | CodeZero / CodeZ | `server/hub.ts:18`, `CodeZ/server/hub.ts:18`, `bin/setup.ts:18` | Flip `DEFAULT_HUB_URL` to `https://code.opzero.sh` so new setups never write legacy. **Co-owned with the repoint owner — coordinate to avoid double-patching.** |
| **auth.opzero.sh repoint** | MCPAuthKit | `wrangler.toml:16-20` (commented), `worker.js:1071` | Add an active Cloudflare custom-domain/route for `auth.opzero.sh` (issuer is host-derived, no logic change). Fix the one hardcoded `authkit.opzero.sh` example at `worker.js:1071` (non-canonical even post-migration). **Owned by the auth/MCPAuthKit agent.** |
| **auth.opzero.sh repoint** | codez-hub | `src/index.ts:19` | PRM `authorization_servers` → `["https://auth.opzero.sh"]`. **Owned by the auth angle; the SPA issuer flip + connector runbook depend on this landing with or after.** |
| **OpZ_cli#1** | OpZ_cli | `packages/cli/src/commands/login.ts:22-27`; `packages/core/src/{auth,types,client}.ts` | **Blocked / needs reconciliation** — the deploy CLI has no OAuth/refresh and `login --browser` is a stub. Until ownership is clarified (see Open Q1), no `codez status`-style proof can exist there. The machine-agent token path is already auto-refreshing (`hub.ts:322-323`). |
| **E2E connector** | codez-hub | `scripts/` (new) + docs | Executable smoke test: `code.opzero.sh/mcp` 401 → PRM `authorization_servers === auth.opzero.sh` → `auth.opzero.sh` AS metadata (S256). First assertion = TLS handshake on both hosts. **Connector-add step un-runnable until `*.opzero.sh` SSL is fixed.** |

### Dropped / reclassified per the critiques
- **Mode B headless pairing (`POST /api/pairing` + `/redeem`)** — **DROPPED as an infeasible blocker.** It required the hub to mint an owner-scoped token, but MCPAuthKit has only `authorization_code`/`refresh_token` grants (no `client_credentials`, no delegation; `worker.js:482-490`), codez-hub holds no owner credential, has no KV binding, and must not write AUTH_DB. An unauthenticated redeem also cannot route to a per-user DO. Reclassified as **blocked-on-a-new-MCPAuthKit-primitive** (Open Q2). Headless boxes use the escape hatch / manual transplant until then.
- **`identityMismatch`/`userIdAlignment` as the split-brain detector** — does not fire for wrong-account *first* provisioning (only re-pointing). The success screen surfaces the **email** instead of asserting a programmatic match.
- **`commandActions` from the hub** for #9 staleness — the affected old agents cannot self-report it; #9 is driven purely by the client-side "online + empty after Unknown-action" inference. `heartbeatAgeMs` is kept (genuinely additive).

---

## 5. Sequenced rollout

**Critical path: #8 first.** Until machines provision under the owner, every hosted/connector improvement renders an empty or phantom dashboard.

**Phase 0 — Infra prerequisites (block several phases; owned outside this plan)**
- Fix `*.opzero.sh` SSL (`_org-profile/CLAUDE.md:96`). Gates Stage 4 cutover and Stage 6 connector.
- Repoint `auth.opzero.sh → MCPAuthKit` (custom domain) and flip PRM `authorization_servers` (`codez-hub/src/index.ts:19`).

**Phase 1 — Kill the split-brain (#8), interactive path** *(depends on: auth.opzero.sh reachable for a clean UX, but ships against legacy host if needed)*
- Wire `login()` into `ensureHubAuth`; remove synthetic-email default; persist `email` via `/oauth/userinfo`; headless detection + escape-hatch messaging.

**Phase 2 — Honest success screen + `codez status`** *(depends on Phase 1 so claim 2 is meaningful; reads `/api/settings/services`)*
- `verifyFederation()` banner; `services-settings` row extension; top-level `codez status`.

**Phase 3 — Re-provision the 4 cloud machines + redeploy stale agent (#9)** *(depends on Phase 1 for owner token; #9 source fix is independent)*
- Port `list_projects`/`list_sessions` into `CodeZ` (or repoint container to CodeZero); rebuild image. Manual token-transplant (delete `hub-user-id`) per box.

**Phase 4 — Hosted UX (#6, #7, #9 pill)** *(depends on Phase 1+3 so there are real machines/projects to select and a real stale signal to render)*
- Auto-select; phantom suppression; hosted empty state; health pill; `loadProjects` short-circuit. Single owner for `SessionList.tsx:776-832`.

**Phase 5 — Same-origin + retire open0p (#10, retire draft)** *(depends on Phase 0 SSL + PRM flip)*
- Same-origin REST/WS; issuer via `VITE_AUTHKIT_ISSUER`; edge 301 from legacy HTML; flip `DEFAULT_HUB_URL`; redeploy agents; **only then** remove `code.open0p.com/*` route after telemetry shows no legacy-host agent traffic for a full heartbeat-timeout window. WS effect ref-rewire ships here.

**Phase 6 — Connector E2E (draft)** *(depends on Phase 0 SSL + Phase 5 canonical discovery)*
- Smoke-test runbook (TLS-first assertion); human connector-add once SSL is healthy.

**Phase 7 (optional / parallel) — OpZ_cli#1** *(blocked on Open Q1 reconciliation)*

---

## 6. Open questions / decisions for the owner

1. **OpZ_cli#1 reconciliation (blocking that ticket).** The on-disk OpZ_cli has no `refreshToken`/`expiresAt`/OAuth and `login --browser` is a stub, contradicting the "ALREADY DONE: MCPAuthKit OAuth implemented in OpZ_cli" bullet. Is the wrong CLI checked out / a stale branch, or does "OpZ_cli#1" actually target the CodeZero **machine-agent** token path (where refresh IS already wired at `hub.ts:322-323`)? Decide before any CLI work.

2. **Headless provisioning primitive (gates Mode B / automated cloud re-provisioning).** Do we add a new MCPAuthKit grant — a `client_credentials`-style or pairing-redeem grant that mints an owner-scoped `mat_`/`mrt_` given a server credential + verified owner binding? Until this exists, headless cloud boxes have **no** automated unified-identity path and must use `HUB_EMAIL`/`CODEZ_HUB_TOKEN` or manual token-transplant. Owner must decide if this is worth a dedicated MCPAuthKit ticket.

3. **#9 container fix: port vs. repoint.** Port `list_projects`/`list_sessions` from CodeZero into `CodeZ/server/hub.ts` (keeps the container building CodeZ), or repoint `codez-container` to build CodeZero? Affects which repo owns the agent long-term.

4. **`MIN_AGENT_VERSION` floor.** What is the floor value, and where is it set (hub env)? `codez_version` can be NULL — confirm NULL machines are treated as "unknown," not auto-flagged.

5. **`SessionList.tsx:776-832` ownership.** #6/#7 and the #9 pill both edit this contiguous block. Per CodeZero/CLAUDE.md file-partitioning, assign a single owner.

6. **`DEFAULT_HUB_URL` literal ownership.** These (`CodeZero/server/hub.ts:18`, `CodeZ/server/hub.ts:18`, `bin/setup.ts:18`) sit on the seam between this plan and the open0p-retirement owner. Confirm who patches them to avoid conflicting values.

7. **`agent:ws` scope.** MCPAuthKit `scopes_supported` (`worker.js:238`) lacks `agent:ws`; machine WS works today via an `mcp:tools` dev-fallback. Owner tokens carry `mcp:tools` so this is latent — but should `agent:ws` be added before any scope tightening?

8. **Legacy-route retirement trigger.** What telemetry signal and window confirm "no agent has used `code.open0p.com` for a full heartbeat-timeout" before removing the route?
