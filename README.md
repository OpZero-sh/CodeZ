# CodeZ

Self-hosted web UI for Claude Code. Drive AI-assisted development sessions from your phone, tablet, or any browser — no API key required.

CodeZ wraps the official [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) using its supported `stream-json` duplex interface. It does not hijack credentials, inject prompts through unofficial channels, or require an Anthropic API key. Users authenticate with their existing Claude Max (or Team/Enterprise) subscription via OAuth, fully compliant with [Anthropic's Terms of Service](https://www.anthropic.com/policies/terms-of-service).

Built by [OpZero](https://opzero.sh). Part of the OpZero open-source ecosystem.

<img width="863" height="1024" alt="image" src="https://github.com/user-attachments/assets/cd63a715-625c-4c4b-87d9-7c99939830ca" />

---

## Features

### Session Management
- **Live sessions** — spawn Claude Code sessions from the UI, stream responses in real time
- **Mirror sessions** — tail externally-owned terminal sessions (read-only via JSONL watching)
- **Channels** — bidirectional relay into terminal sessions via MCP plugin, turning read-only mirrors into writable sessions
- **Session search** — full-text search across all session content
- **Fork / resume** — resume idle sessions or fork existing conversations

### Mobile-First UI
- **Phone-first design** — optimized for iPhone / Android, safe-area padding, bottom-sheet panels
- **PWA install** — Add to Home Screen on iOS and Android for a native app experience
- **Voice input** — push-to-talk via Web Speech API with auto-submit on silence
- **Command palette** — `Cmd+K` / `Ctrl+K` searchable overlay for sessions, projects, and quick actions
- **Deep links** — shareable URLs (`/s/<project>/<session>`) that persist across reloads

### Development Visibility
- **Cost and token tracking** — per-session input/output tokens, cache metrics, and estimated cost
- **Tool-use renderers** — rich cards for Bash, Edit, Read, Search, Task (subagent), and more
- **Subagent team grid** — visualize parallel agent work with status indicators
- **Permission mode picker** — choose Accept Edits, Auto, Bypass, Plan, or Default per session
- **Auto-memory viewer** — browse Claude's `.claude/` memory files per project
- **MCP tool call observability** — real-time monitoring of tool calls from connected agents

### Cyberpunk Aesthetic
- **Dark terminal UI** — Synthetic Void background, Carbon Fiber cards, Hyper Cyan (`#00F5FF`) primary, Neural Violet (`#8B5CF6`) accent
- **Glass morphism** — frosted glass panels, card glow effects, gradient text
- **Animated brand logo** — neural-ring animation with OpZero wordmark

---

## How It Works

CodeZ is a single Bun HTTP server that spawns `claude` CLI processes in `stream-json` duplex mode. It keeps stdin open across turns so the context cache stays warm, parses stdout events in real time, and fans them out to browser clients via Server-Sent Events.

```
  Browser (React 19 SPA)
       |
       |  HTTPS via Cloudflare Tunnel
       v
  Bun HTTP Server (server/index.ts)
       |
       +-- SessionPool
       |     +-- SessionProcess  (spawns `claude -p --input-format stream-json`)
       |     +-- SessionTailer   (fs.watch on JSONL for mirror sessions)
       |     +-- ChannelBridge   (bidirectional relay via MCP plugin)
       |
       +-- EventBus (in-process pub/sub -> SSE to all clients)
       +-- /mcp (MCP Streamable HTTP transport for agent access)
```

**No API key in the loop.** CodeZ strips `ANTHROPIC_API_KEY` from subprocess environments by default so the CLI uses OAuth (your Max subscription). If a billing error occurs, it auto-retries with the API key as fallback.

---

## MCP Server — Claude Chat as a Custom Connector

CodeZ exposes a remote [MCP](https://modelcontextprotocol.io/) server with **17 tools** for full programmatic control. Authentication is handled by [MCPAuthKit](https://github.com/OpZero-sh/MCPAuthKit) (also an OpZero project), which provides OAuth 2.1 + PKCE token management.

This means **regular Claude** — on iOS, desktop, and web (claude.ai) — can connect to your CodeZ instance as a custom MCP connector and orchestrate Claude Code sessions. Claude chat becomes a remote control for Claude Code.

### What you can do from Claude chat

| Tool | Description |
|------|-------------|
| `create_session` | Spawn a new Claude Code session in any project |
| `send_prompt` | Send a prompt to a running session |
| `poll_events` | Watch real-time streaming output |
| `get_session` | Read the full conversation |
| `abort_session` | Cancel a running turn |
| `list_projects` | Browse all projects and sessions |
| `search_sessions` | Full-text search across history |
| `get_observability` | Check cost and usage stats |
| `respond_permission` | Allow or deny tool permission requests |
| ...and 8 more | `dispose_session`, `fork_session`, `get_project_memory`, `get_health`, `get_health_details`, `get_state`, `update_state`, `list_sessions` |

### Connect from Claude chat (iOS / desktop / web)

Add CodeZ as a custom MCP connector in your Claude settings:

```json
{
  "codez": {
    "type": "http",
    "url": "https://codez.yourdomain.com/mcp"
  }
}
```

On first use, Claude will:
1. Discover the Protected Resource Metadata at `/.well-known/oauth-protected-resource`
2. Find your MCPAuthKit authorization server
3. Open a browser window for OAuth consent
4. Exchange the code for an access token (auto-refreshes)

No manual token management. No API keys. Just your Claude subscription.

### Connect from Claude Code (local)

For local access, no auth needed:

```json
{
  "codez": {
    "type": "http",
    "url": "http://127.0.0.1:4097/mcp"
  }
}
```

See [docs/mcp.md](docs/mcp.md) for the full MCP server reference.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A domain + [Cloudflare](https://www.cloudflare.com/) account (for remote access)

### Install and run

```bash
git clone https://github.com/OpZero-sh/CodeZ.git
cd CodeZ
bun run setup
```

The setup wizard installs dependencies, builds the web UI, creates your server credentials, and optionally configures the MCP connector.

Or do it manually:

```bash
bun install
cd web && bun install && cd ..
bun run build
bun run start          # production server on http://127.0.0.1:4097
```

### Development mode

```bash
bun run dev            # concurrent server (4097) + Vite dev server (5173)
```

---

## Remote Access with Cloudflare Tunnel

CodeZ is designed to run on your local machine (Mac Mini, MacBook, home server) and be accessed remotely via a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). You set up your own tunnel and domain — CodeZ does not phone home or require any OpZero infrastructure.

### Setup

```bash
# 1. Install cloudflared
brew install cloudflared

# 2. Authenticate with Cloudflare (opens browser)
cloudflared tunnel login

# 3. Create a named tunnel
cloudflared tunnel create codez

# 4. Route your subdomain to the tunnel
cloudflared tunnel route dns codez codez.yourdomain.com
```

### Configure

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/<you>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: codez.yourdomain.com
    service: http://localhost:4097
  - service: http_status:404
```

### Run

```bash
# Start the server
bun run start

# Start the tunnel (separate terminal)
cloudflared tunnel run codez
```

Your CodeZ instance is now live at `https://codez.yourdomain.com`.

The server listens on plain HTTP. Cloudflare terminates TLS at the edge. Cookie auth uses the `Secure` flag, which works automatically through the tunnel and on loopback.

### MCPAuthKit setup (for MCP remote access)

To let Claude chat (or other MCP clients) connect remotely, deploy an [MCPAuthKit](https://github.com/OpZero-sh/MCPAuthKit) instance on your own Cloudflare account and register CodeZ as a resource server. See [docs/mcp.md](docs/mcp.md) for step-by-step instructions.

---

## Channels — Bidirectional Terminal Relay

Channels let you send messages from the CodeZ web UI into a `claude` process running in your terminal. Your phone and your terminal talk to the same session.

```bash
./scripts/launch-opzero.sh --cwd ~/my/project
```

This spawns a channel-enabled `claude` session with an MCP plugin that bridges the terminal and the web UI. Messages you send from the phone land as channel events in the terminal; Claude's replies stream back to the browser.

See [docs/channels.md](docs/channels.md) for the full guide, security model, and limitations.

---

## Docker

```bash
docker-compose up -d
# or
docker build -t codez .
docker run -d -p 4097:4097 \
  -v ~/.config/opzero-claude:/root/.config/opzero-claude \
  --restart unless-stopped codez
```

---

## macOS Auto-Start (launchd)

```bash
./scripts/install-launchd.sh     # bootstrap LaunchAgent
./scripts/uninstall-launchd.sh   # tear it down
```

See [docs/launchd.md](docs/launchd.md) for the runbook.

---

## Config

Server config lives at `~/.config/opzero-claude/config.json`. On first run, the server generates a random password, bcrypt-hashes it, and writes an auth secret. You can also run `bun run setup` or `codez init` to configure interactively.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEZ_PORT` | `4097` | Server port |
| `CODEZ_HOST` | `127.0.0.1` | Server bind host |
| `AUTHKIT_URL` | _(none)_ | Your MCPAuthKit instance URL (required for remote MCP access) |
| `CODEZ_MCP_URL` | auto-detected | Public URL for MCP Protected Resource Metadata |
| `CODEZ_MCP_PORT` | `4098` | Port for standalone MCP server |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | [Bun](https://bun.sh) — no framework, raw `Bun.serve` |
| Frontend | React 19 + Vite + Tailwind CSS v4 |
| UI Components | shadcn/ui primitives |
| Icons | Lucide |
| Auth | Cookie JWT (default), Cloudflare Access (optional), MCPAuthKit OAuth (MCP) |
| MCP | `@modelcontextprotocol/sdk` — Streamable HTTP transport |
| Tunnel | Cloudflare Tunnel (`cloudflared`) |
| Process | Claude Code CLI via `stream-json` duplex mode |

---

## Project Structure

```
CodeZ/
  server/           Bun HTTP server (no framework)
    index.ts          entry point, wires config + auth + pool + routes + SSE
    claude/           SessionProcess, SessionPool, SessionTailer, history
    routes/           API handlers + MCP transport
  web/              React 19 SPA
    src/
      components/     UI components + tool-use renderers
      lib/            store, types, API client
      theme/          Tailwind v4 tokens (cyberpunk palette)
  packages/
    codezero-mcp/     Remote MCP server (17 tools, Streamable HTTP)
    opzero-channel/   MCP plugin for bidirectional terminal relay
  scripts/          Setup, launchd, channel launcher
  docs/             Architecture, MCP guide, Channels guide
```

---

## Why CodeZ Exists

Claude Code is powerful but terminal-bound. CodeZ lets you:

- **Use Claude Code from your phone** while away from your desk
- **Watch what agent teams are doing** in real time across multiple sessions
- **Start, stop, and manage sessions** from anywhere
- **Let Claude chat orchestrate Claude Code** via MCP — your AI talks to your AI
- **Share access** with collaborators via your own authenticated tunnel

All without giving up your Claude Max subscription, violating any terms of service, or trusting a third-party proxy with your credentials.

---

## License

MIT

---

## OpZero Ecosystem

CodeZ is part of the [OpZero](https://opzero.sh) open-source ecosystem:

| Project | Description |
|---------|-------------|
| [OpZero.sh](https://opzero.sh) | Deploy websites from your terminal — the parent platform |
| [MCPAuthKit](https://github.com/OpZero-sh/MCPAuthKit) | OAuth 2.1 for MCP servers in one Cloudflare Worker |
| [skills](https://github.com/OpZero-sh/skills) | Official OpZero agent skills for Claude Code, Cursor, Windsurf, and 20+ AI agents |
| [uat](https://github.com/OpZero-sh/uat) | AI-native test engine for browser, API, and MCP testing — 46 tools over MCP |
| [token-5-0](https://github.com/OpZero-sh/token-5-0) | Context window budget manager — Claude Code plugin that vaults oversized payloads |
| [cli](https://github.com/OpZero-sh/cli) | OpZero CLI — deploy to Cloudflare, Vercel, or Netlify from your terminal |

## Links

- [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) — official Anthropic documentation
- [MCP specification](https://modelcontextprotocol.io/) — Model Context Protocol
