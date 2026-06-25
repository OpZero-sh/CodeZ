# CodeZero

React + Bun web UI for Claude Code. Server + SPA, phone-first design. Installable
as a PWA on iOS and Android via Add to Home Screen.

Package name: `opzero-code`. Product name shown in the UI: **CodeZero**. On-disk
config directory remains `~/.config/opzero-claude/` to preserve existing installs.

<img width="600" alt="image" src="https://github.com/user-attachments/assets/743de5f6-63bf-48f3-8ef8-215aa78f3031" />

## Quick start

```bash
codez setup
```

One command installs dependencies, builds the web UI, provisions a machine agent
against the default CodeZ Hub (`https://code.opzero.sh`), registers the local
MCP bridge with Claude Code, installs autostart, and starts the server.

Run it again any time — it is idempotent. Flags: `--skip-hub`, `--skip-mcp`,
`--skip-autostart`, `--no-start`.

## What the agent sees

After `codez setup`, the machine automatically appears in
[zhub](https://code.opzero.sh) with its hostname, repos, and any active
sessions. Any MCP client — Claude.ai, Claude CLI, mobile — connects to the hub
and can drive this machine remotely.

## Develop

```bash
bun run dev
```

Runs the Bun server on `http://127.0.0.1:4097` and the Vite dev server for the
web UI. The web dev server proxies `/api` to the server.

## Build and serve

```bash
bun run build       # tsc + vite build
bun run start       # production server on 4097
bun run typecheck   # server-side tsc
cd web && bunx tsc --noEmit  # client-side tsc
```

## Config

User config lives at `~/.config/opzero-claude/config.json`. On first run the
server generates a password, bcrypts it, writes `authSecret`, and persists the
hub URL when `codez setup` provisions it.

Hub auth tokens live at `~/.config/opzero-claude/hub-auth.json` (mode 0600).

## Features

- Live Claude Code sessions with real-time SSE streaming
- Mirror externally-owned sessions via JSONL tailing
- Channels: bidirectional relay into terminal sessions via MCP plugin
- Cost / token tracking per session
- Permission mode picker (Accept Edits, Auto, Bypass, Don't Ask, Plan)
- PWA install: Add to Home Screen on iOS/Android
- Voice input via Web Speech API
- Command palette (Cmd+K): sessions, projects, quick actions
- Auto-memory viewer per project
- Session disposal with confirmation
- Live sidebar status updates with session-start flash
- Inline send-error feedback
- Cloudflare Access auth provider (optional)
- Auth fallback: automatic OAuth / API key retry on billing errors
- Self-healing reconciliation loop (stale channels, orphan sessions, auth health)
- Remote MCP server (`packages/codezero-mcp/`) — 17 tools for full agent control

## MCP Server (agent control)

A remote MCP server at `packages/codezero-mcp/` exposes 17 tools for full
programmatic control over CodeZero. Run alongside the main server:

```bash
bun run packages/codezero-mcp/index.ts   # starts on :4098
```

Agents connect via the hub URL (recommended) or directly for local testing.
See `docs/mcp.md` for details.

## Public URL

https://codez.opzero.sh

## Appendix: Optional direct browser access (Cloudflare Tunnel)

The primary distribution path is the hub. If you need a direct HTTPS URL for
this machine (e.g. to hit the web UI without the hub), Cloudflare Tunnel is the
recommended route.

```bash
cloudflared tunnel login
cloudflared tunnel create codezero
cloudflared tunnel route dns codezero codez.yourdomain.com
```

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/<you>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: codez.yourdomain.com
    service: http://localhost:4097
  - service: http_status:404
```

Run:

```bash
bun run start                     # server
cloudflared tunnel run codezero   # tunnel, separate terminal
```

The server listens on plain HTTP. Cloudflare terminates TLS at the edge.
