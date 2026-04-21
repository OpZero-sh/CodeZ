# CodeZ Installation Guide

The supported path is `codez setup`. It is idempotent, noninteractive by
default, and does everything from dependency install to autostart.

## One-shot install

```bash
# Clone and enter the repo, then:
codez setup
```

Behind the scenes, `codez setup`:

1. Verifies `bun` and (softly) `claude` are on PATH.
2. Runs `bun install` at root and `web/`, then `bun run build`.
3. Generates or reuses `~/.config/opzero-claude/config.json` (first-run
   password + authSecret).
4. Provisions a headless hub machine agent via MCPAuthKit PKCE (skippable
   with `--skip-hub`).
5. Persists `hubUrl` into the config (default `https://code.open0p.com`).
6. Registers the local MCP bridge with Claude Code via
   `claude mcp add --scope user codez -- http http://127.0.0.1:4097/mcp`
   (skippable with `--skip-mcp`).
7. Installs an autostart unit — `launchd` on macOS, user `systemd` on Linux
   (skippable with `--skip-autostart`).
8. Starts the server and polls `/api/health` (skippable with `--no-start`).

Flags are presence-only; all defaults assume a desktop install against the
production hub.

## Docker

```bash
docker build -t codez .
docker run -d -p 4097:4097 \
  -v ~/.config/opzero-claude:/root/.config/opzero-claude \
  --restart unless-stopped codez
```

The container's first boot runs `codez setup --no-start --skip-autostart`
against the mounted config dir, then execs the server. Provide
`HUB_EMAIL` / `HUB_PASSWORD` / `CODEZ_HUB_TOKEN` via `-e` as needed.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEZERO_PORT` | `4097` | Server port |
| `CODEZERO_HOST` | `127.0.0.1` | Server host |
| `CODEZERO_CONFIG_PATH` | `~/.config/opzero-claude/config.json` | Config file |
| `CODEZ_HUB_URL` | `https://code.open0p.com` | Hub URL (overrides config) |
| `CODEZ_HUB_TOKEN` | unset | Pre-provisioned bearer; skips OAuth |
| `HUB_EMAIL` | `opz-<hostname>@opzero.local` | Hub OAuth identity |
| `HUB_PASSWORD` | random base64url(18) | Hub OAuth password |
| `AUTHKIT_URL` | `https://authkit.open0p.com` | MCPAuthKit endpoint |

## Autostart units

- macOS launchd: `scripts/install-launchd.sh` / `scripts/uninstall-launchd.sh`.
  Label: `sh.opzero.claude`. Logs in `.logs/`.
- Linux systemd (user): `scripts/install-systemd.sh`. Unit name:
  `codez.service`. Logs in `.logs/`.

## Manual first run

If you prefer to do each step by hand:

```bash
bun install && cd web && bun install && cd .. && bun run build
bun run server/index.ts    # generates config on first run
codez hub login            # optional: provision hub agent
```

## Cloudflare Tunnel (optional appendix)

If you want a direct HTTPS URL to this machine without going through the
hub, use a Cloudflare Tunnel. This is the old distribution path; the hub
is the recommended remote access route.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:4097
```

For persistent tunnels with a domain, see the
[Remote Access section of the README](../README.md#remote-access-with-cloudflare-tunnel).
