# CodeZero

**Claude Code in your pocket.** A mobile-first web console for AI-assisted development.

## What is CodeZero?

CodeZero is a web-based terminal console that gives you mobile access to Claude Code sessions. It connects to your local Claude Code instance via Cloudflare Tunnel, letting you monitor sessions, review messages, track costs, and manage AI-assisted development workflows from any device — phone, tablet, or desktop.

## Architecture

CodeZero consists of a server (Bun) that communicates with Claude Code via STDIO using the `stream-json` output format, and a client web app (React + Vite) that provides the UI. The server can be exposed locally via Cloudflare Tunnel for remote access, with authentication handled via JWT cookies or Cloudflare Access.

## Key Features

- **Session Management** — View all Claude Code sessions across your projects, filter by status (live/mirror/idle)
- **Live Message Streaming** — Watch messages arrive in real-time from active sessions
- **Cost & Usage Tracking** — Monitor token usage, costs, and duration per session
- **Memory Files** — Read Claude's memory files (CLAUDE.md, etc.) directly in the UI
- **Slash Command Palette** — Quick access to commands via Cmd/Ctrl+K
- **Markers** — Bookmark important moments in conversations
- **Mobile-Optimized** — PWA-ready with add-to-home-screen onboarding
- **Dark Cyberpunk UI** — Minimal, terminal-inspired aesthetic with cyan accents

## Installation

### Option 1: Docker (Recommended)

```bash
docker run -d \
  --name codezero \
  -p 4097:4097 \
  -v ~/.config/opzero-claude:/data \
  -e CODEZERO_CONFIG_JSON="$(cat ~/.config/opzero-claude/config.json)" \
  ghcr.io/opzero/codezero:latest
```

Then configure your Cloudflare Tunnel (see below).

### Option 2: Bun (Development)

```bash
# Clone and install
git clone https://github.com/OpZero-sh/CodeZero.git
cd CodeZero
bun install

# Create config
mkdir -p ~/.config/opzero-claude
cat > ~/.config/opzero-claude/config.json <<EOF
{
  "username": "admin",
  "password": "your-secure-password",
  "projects": [{"name": "My Projects", "paths": ["/path/to/your/projects"]}]
}
EOF

# Run
bun run dev
```

## Cloudflare Tunnel Setup

To access CodeZero from your phone or remotely:

1. Install `cloudflared`: `brew install cloudflared` (macOS) or download from [cloudflare.com](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/local/)
2. Create a tunnel:
   ```bash
   cloudflared tunnel create codezero
   ```
3. Add a DNS record:
   ```bash
   cloudflared tunnel route dns codezero your-subdomain.yourdomain.com
   ```
4. Run the tunnel:
   ```bash
   cloudflared tunnel run codezero --url http://localhost:4097
   ```

Your CodeZero instance will be available at `https://your-subdomain.yourdomain.com`.

## Live Demo

Try CodeZero live at: **https://claude.opzero.sh**

![CodeZero Screenshot](./screenshot.png)

*Above: CodeZero running on mobile, showing a live Claude Code session with cost tracking.*

## Tech Stack

- **Server**: Bun (TypeScript)
- **Client**: React + Vite + TypeScript
- **UI**: shadcn/ui components
- **Styling**: Tailwind CSS
- **Auth**: JWT cookies or Cloudflare Access
- **Tunnel**: Cloudflare Tunnel (cloudflared)

## License

MIT — See LICENSE file for details.

## Links

- [GitHub Repository](https://github.com/OpZero-sh/CodeZero)
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code)