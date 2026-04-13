# opzero-channel

Claude Code channel plugin for opzero-claude. Runs as an MCP stdio child of a
`claude` process and exposes a loopback HTTP surface so the opzero-claude web
server can inject prompts into the running session and stream reply-tool
invocations back out.

## Launch

Do not invoke directly. Launch via the parent project's launcher, which wires
up the required env var and the development-channels flag:

```sh
../../scripts/launch-opzero.sh
```

Under the hood `claude` must be started with:

```
claude --dangerously-load-development-channels server:opzero-channel
```

## Env vars

- `OPZERO_CHANNEL_SESSION_ID` — required. The claude session id this plugin
  attaches to. Used as the discovery file key so the opzero-claude server can
  match plugin -> session. Exits 1 if missing.

## Discovery file

On startup the plugin writes `~/.opzero-claude/channels/<sessionId>.json`
with `{ pid, sessionId, port, secret, createdAt, version }`. It is deleted
on SIGINT, SIGTERM, or normal exit. The opzero-claude server reads this file
to find the loopback port and the per-session shared secret.

## HTTP surface (loopback only)

All routes bind on `127.0.0.1` with an auto-assigned port.

- `POST /inject` — body `{ content, meta?, chat_id? }`. Requires
  `X-OPZero-Secret` header. Emits a `notifications/claude/channel` MCP
  notification whose `meta` becomes `<channel ...>` tag attributes.
- `GET /events` — SSE stream. Requires `X-OPZero-Secret`. Emits
  `data: {"type":"reply","chat_id","text","ts"}\n\n` whenever claude calls
  the `reply` tool. Heartbeats every 20s.
- `GET /status` — unauthenticated liveness, returns
  `{ ok, sessionId, pid, version }`.

## Security

- Localhost-only bind (`127.0.0.1`).
- 32-byte per-session shared secret generated at startup, written only to
  the user-owned discovery file and checked on every `/inject` and `/events`
  request.
- `stdout` is reserved for MCP JSON-RPC framing. All logs go to `stderr`.

## Requirements

Research preview. Requires Claude Code >= 2.1.80 and
`--dangerously-load-development-channels server:opzero-channel` at launch.
