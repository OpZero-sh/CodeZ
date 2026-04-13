# Channels

## What it does

Channels lets you send messages from the opzero-claude web UI into a `claude`
process running in your terminal, so your phone and your terminal are actually
talking to the same session. It is a research-preview Claude Code feature
(requires Claude Code 2.1.80+) that we expose via a small Bun MCP plugin at
`packages/opzero-channel/`.

This is the primary way to get bidirectional writes into an externally-owned
"mirror" session. Without Channels, mirror sessions are read-only tails of a
JSONL file; with Channels, they become writable from anywhere.

## Requirements

- Claude Code `>= 2.1.80` on PATH
- Bun on PATH
- Logged in with claude.ai credentials (not an API key)
- opzero-claude server running (loopback on `127.0.0.1:4097` by default)

## How it works

```
  ./scripts/launch-opzero.sh
          |
          v
  claude --session-id <uuid>                    (terminal, foreground)
          |
          +-- spawns MCP stdio subprocess ---> bun packages/opzero-channel/index.ts
                                                     |
                                                     +-- writes discovery file:
                                                     |     ~/.opzero-claude/channels/<uuid>.json
                                                     |     { port, secret, pid }
                                                     |
                                                     +-- binds HTTP on 127.0.0.1:<port>
                                                           POST /inject   (web UI -> plugin)
                                                           GET  /sse      (plugin -> web UI)

  Browser (opzero-claude SPA)
          |
          v
  Bun server reads discovery file, POSTs user turns to the plugin, which emits
  <channel> events into Claude's agent loop. Claude calls the plugin's `reply`
  tool; the reply streams back to the server over SSE and into the browser.
```

## How to use

Start a session from a shell in your project:

```bash
./scripts/launch-opzero.sh --cwd ~/my/project
```

Optional flags:

```bash
./scripts/launch-opzero.sh \
  --cwd ~/my/project \
  --model claude-opus-4-5 \
  --session-id 8c0c3a5e-... \
  -- --permission-mode acceptEdits
```

Then open opzero-claude on your phone (or any browser), find the session in
the sidebar - it will show up as `live` because the launcher owns it - and
send a message. The message lands as a channel event in the terminal where
`claude` is running, Claude replies, and the reply streams back to the browser
as part of the same conversation.

## Security

- Each plugin generates a per-session shared secret on startup and writes it
  to `~/.opzero-claude/channels/<sessionId>.json` with mode `0600`.
- Only the local opzero-claude server - which knows to read that discovery
  file - can POST to the plugin with a valid bearer token.
- The plugin binds to `127.0.0.1` only. No external access, no listener on
  any routable interface.
- Session IDs are UUIDv4. Discovery files are cleaned up on plugin exit.

## Current limitations

- Research preview. The `--dangerously-load-development-channels` flag, the
  `<channel>` event shape, and the MCP surface may all change between
  Claude Code versions.
- You can only attach channels to sessions you start with the launcher. An
  already-running `claude` process cannot be retrofitted.
- Requires `--dangerously-load-development-channels` until our plugin lands
  on Anthropic's built-in allowlist.
- Permission relay (remote tool-approval prompts surfaced to the phone) is
  not yet wired up - tool approvals still have to happen in the terminal.

## Debug checklist

- `ls ~/.opzero-claude/channels/` - should show `<sessionId>.json` for every
  launcher-spawned claude currently running.
- `curl http://127.0.0.1:<port>/status` (port from the discovery file) -
  plugin liveness probe.
- Run `/mcp` inside the claude session - `opzero-channel` should appear in
  the connected MCP servers list.
- If `/api/sessions/:id/prompt` returns 403 when posting to the plugin, the
  shared secret is stale. Restart the session via the launcher.
- If inject fails with `ECONNREFUSED`, the plugin crashed. Check
  `~/.claude/debug/<session-id>.txt` for its stderr.
