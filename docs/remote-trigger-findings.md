# Remote Trigger / Remote Control / Channels — Findings

Research date: 2026-04-11
Claude Code version inspected: **2.1.101** (`/Users/opz/.local/share/claude/versions/2.1.101`, Mach-O arm64, single-file Bun-compiled binary with embedded JS).

## TL;DR

**`--remote-control-session-name-prefix` and the `RemoteTrigger` tool are a dead end for opzero-claude's "inject a prompt into someone else's running terminal claude" goal — but the *real* feature we want exists and is called Claude Code **Channels**. Channels are a research-preview MCP extension (`--channels` flag, Claude Code >= 2.1.80) that lets a local MCP server push `notifications/claude/channel` events into the live agent loop of a running `claude` process. These arrive in Claude's context as a `<channel source="..." ...>text</channel>` user-turn and Claude responds to them synchronously. This is exactly the "opencode device-hopping" primitive we were looking for, and it's buildable today with `--dangerously-load-development-channels`.**

Verdict: **viable — pivot from RemoteTrigger to Channels.**

---

## 1. What `--remote-control-session-name-prefix` actually does

It's a **labeling flag** for Anthropic's hosted Remote Control feature, nothing more. It only controls the auto-generated display name shown in the session list at `claude.ai/code`.

Evidence from `claude --help` (2.1.101):

```
--remote-control-session-name-prefix <prefix>
    Prefix for auto-generated Remote Control session names (default: hostname)
```

And from the `claude remote-control --help` subcommand (there's a full `remote-control` subcommand too, not just a flag):

```
Remote Control - Connect your local environment to claude.ai/code
  --name <name>           Name for the session (shown in claude.ai/code)
  --remote-control-session-name-prefix <prefix>
                          Prefix for auto-generated session names
                          (default: hostname; env: CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX)
  --spawn <mode>          Spawn mode: same-dir, worktree, session (default: same-dir)
  --capacity <N>          Max concurrent sessions (default: 32)
Remote Control allows you to control sessions on your local device from
claude.ai/code (https://claude.ai/code). Run this command in the
directory you want to work in, then connect from the Claude app or web.
```

Confirmed in the official docs at <https://code.claude.com/docs/en/remote-control>:

> Your local Claude Code session makes **outbound HTTPS requests only and never opens inbound ports on your machine**. When you start Remote Control, it registers with the Anthropic API and polls for work.

The architecture is: your local `claude` long-polls `api.anthropic.com`; Anthropic's servers relay messages coming from `claude.ai/code` (web) or the mobile app into your local process. There is **no local listener**, no socket, no FIFO, no TCP port, no unix domain socket. The prefix flag just affects the auto-generated name string (e.g. `myhost-graceful-unicorn`) that shows up in the claude.ai/code sessions list.

### Filesystem / network surface of a running Remote Control session

From binary strings in `2.1.101`:

- API endpoints it talks to (all outbound, all `api.anthropic.com`):
  - `POST /v1/environments/bridge` (register bridge)
  - `DELETE /v1/environments/bridge/{id}`
  - `/v1/session_ingress/session/...` (session creation)
  - `/session_ingress/ws/...` (websocket for streaming work)
  - `/v2/session_ingress/shttp/mcp/...`
  - `/v1/code/sessions/...`
  - `/v1/code/triggers/...` (see RemoteTrigger below)
- Log prefixes in the code: `[bridge:api]`, `[bridge:ws]`, `[bridge:session]`, `[bridge:poll]`, `[bridge:repl]` — it's a poll-loop architecture (`pollForWork` is the function name) over an authenticated websocket to Anthropic.
- Local state: the string `/.session_ingress_token` appears alongside `/.oauth_token` and `/.api_key` — these are **credential files** the bridge stores in `~/.claude/`, not IPC channels. The `session_ingress_token` is a short-lived work secret received from Anthropic.

I ran `claude --remote-control-session-name-prefix test-rc --bare -p "hi" --model haiku` in `/tmp/rc-probe-opz`. Result: `Not logged in · Please run /login`, exit 0. Nothing created locally. `--bare` disables OAuth keychain reads, so the bridge path is unreachable without an API key — confirming the feature depends on claude.ai OAuth and outbound-only network.

## 2. What `RemoteTrigger` actually is

I pulled the tool definition directly out of the binary. It's **nothing like a prompt-injection channel** — it's an HTTP CRUD client for the scheduled-agents API at `api.anthropic.com/v1/code/triggers`. Full extracted snippet:

```js
Q$7={}; D_(Q$7, { RemoteTriggerTool: () => n65 });
Q65 = mH(() => h.strictObject({
  action:     h.enum(["list","get","create","update","run"]),
  trigger_id: h.string().regex(/^[\w-]+$/).optional()
                .describe("Required for get, update, and run"),
  body:       h.record(h.string(), h.unknown()).optional()
                .describe("JSON body for create and update"),
}));
l65 = mH(() => h.object({
  status: h.number(),
  json:   h.string(),
}));
n65 = lq({
  name: UjH,
  searchHint: "manage scheduled remote agent triggers",
  shouldDefer: true,
  isEnabled() {
    return !pH(process.env.CLAUDE_CODE_REMOTE)
        && E_("tengu_surreal_dali", false)
        && N1("allow_remote_sessions");
  },
  async call(H, _) {
    const q = Tq()?.accessToken;
    if (!q) throw Error("Not authenticated with a claude.ai account...");
    const O = `${r8().BASE_API_URL}/v1/code/triggers`;
    // ... switch on action: list=GET, get=GET /{id}, create=POST, update=POST /{id},
    //     run=POST /{id}/run
    return { data: { status: f.status, json: BH(f.data) } };
  },
});
```

Description string embedded in the binary:

```
Actions:
- list:   GET  /v1/code/triggers
- get:    GET  /v1/code/triggers/{trigger_id}
- create: POST /v1/code/triggers               (requires body)
- update: POST /v1/code/triggers/{trigger_id}  (requires body, partial update)
- run:    POST /v1/code/triggers/{trigger_id}/run (optional body)
The response is the raw JSON from the API.
```

So `RemoteTrigger` is a thin tool Claude calls to manage the user's **cron-like scheduled remote agents** at claude.ai (the same feature exposed by the `schedule` skill in the home-level CLAUDE.md). It wraps `POST /v1/code/triggers/{id}/run` to fire a scheduled task on demand. It has zero to do with injecting prompts into a running local session. The gating condition `!CLAUDE_CODE_REMOTE && tengu_surreal_dali && allow_remote_sessions` confirms it's for managing remote (cloud) trigger definitions, not talking to anything local.

## 3. IPC mechanism

For Remote Control / RemoteTrigger: **none.** The `claude` process only makes outbound HTTPS calls. No ports are bound, no unix sockets are created, no FIFOs. `/.session_ingress_token` is a credential file, not a bidirectional channel. There is no way to `echo "hi" > /some/socket` and have a running `claude` process pick it up through this feature.

For **Channels** (the real mechanism — see section 5): yes, IPC exists, but it is **MCP-stdio subprocess IPC**, not a generic server socket. A channel plugin is an MCP server that `claude` spawns as a subprocess at startup; `claude` reads `notifications/claude/channel` from the plugin's stdout. The plugin itself is free to listen on whatever local port it wants (Bun.serve on 127.0.0.1, a chat-platform long-poll, an iMessage sqlite watcher) and then call `mcp.notification()` to forward events into Claude.

## 4. Can we write to that channel and inject a user turn into the live agent loop?

Through Remote Control / RemoteTrigger: **no.**

Through Channels: **yes.** This is the whole point of Channels. Quote from <https://code.claude.com/docs/en/channels>:

> A channel is an MCP server that pushes events into your running Claude Code session, so Claude can react to things that happen while you're not at the terminal.

Event flow for a webhook-style channel (from the official reference at <https://code.claude.com/docs/en/channels-reference>):

1. User launches claude with `--channels` or `--dangerously-load-development-channels server:webhook`.
2. Claude Code spawns the channel MCP server as a stdio subprocess from the user's `.mcp.json`.
3. The channel subprocess opens its own HTTP listener on `127.0.0.1:<port>` (or polls Telegram/Discord, or tails the Messages db, etc.).
4. External caller hits the channel's HTTP endpoint: `curl -X POST localhost:8788 -d "message"`.
5. Channel handler calls `mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })`.
6. Claude Code receives the notification and injects it into the live agent loop as:

   ```
   <channel source="webhook" chat_id="1" path="/" method="POST">message</channel>
   ```

7. Claude sees the `<channel>` tag as the next user turn and responds in the same session. If the channel declares `tools: {}` and a `reply` tool, Claude can call it to route its answer back through the same channel.
8. Permission prompts (Bash/Write/Edit) can be forwarded out and answered remotely via `notifications/claude/channel/permission_request` / `notifications/claude/channel/permission` — relay works in both directions.

This *is* the "send a message to a running terminal claude from another process" primitive.

## 5. CLI flags for listening / external control

- `--channels plugin:<name>@<marketplace>` — opt a preinstalled channel plugin into this session.
- `--dangerously-load-development-channels server:<name>` — opt in a bare MCP server from `.mcp.json` as a channel during research preview (no allowlist check).
- `claude remote-control` (subcommand) — the outbound bridge to claude.ai/code.
- `claude --remote-control` / `--rc` — same but attached to an interactive session.
- `/remote-control` (slash command) — enable it mid-session.
- `--tmux` / `--worktree` — unrelated; iTerm/worktree management.

No flag exposes an HTTP endpoint or bound port from `claude` itself. All inbound paths go through either (a) an MCP channel subprocess, or (b) Anthropic's cloud bridge.

## 6. Documentation found

- <https://code.claude.com/docs/en/remote-control> — full Remote Control docs. Explicit quote: "outbound HTTPS requests only and never opens inbound ports." Requires claude.ai OAuth; API keys rejected. Confirms routing is via Anthropic's servers.
- <https://code.claude.com/docs/en/channels> — research-preview Channels feature. Telegram/Discord/iMessage/fakechat reference plugins. Requires Claude Code >= 2.1.80. `--channels` flag.
- <https://code.claude.com/docs/en/channels-reference> — full protocol contract: `capabilities.experimental['claude/channel'] = {}`, `notifications/claude/channel`, `<channel>` tag injection format, reply-tool pattern, sender gating for prompt-injection defense, permission relay (>= 2.1.81).
- Reference plugins: <https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins> — telegram, discord, imessage, fakechat source.

## 7. Possible integration path for opzero-claude

The viable route is **Channels**, not Remote Control. Concrete build plan:

**Create an opzero-claude channel plugin** (`packages/channel-opzero/webhook.ts`) — a Bun-based MCP stdio server that:

1. Declares `capabilities.experimental['claude/channel'] = {}` and `tools: {}` (two-way).
2. Connects to Claude Code over `StdioServerTransport()`.
3. Listens on `127.0.0.1:<auto-port>` for HTTP POSTs from the opzero-claude Bun server — or, better, tails a unix socket or named pipe in the session's working dir so opzero-claude can find it via `session_id → socket path` lookup.
4. On inbound POST, calls `mcp.notification({ method: 'notifications/claude/channel', params: { content: message, meta: { session_id, user_id } } })`.
5. Registers a `reply` tool with an `inputSchema` taking `{ session_id, text }`. When Claude calls it, the plugin writes the reply back out (either via SSE to the opzero-claude server or by appending to a known file).
6. Gates inbound on a per-session shared secret generated at spawn time and handed to the opzero-claude server.

**End-to-end flow:**

```
┌─ opzero-claude UI (React, running in browser) ─────────┐
│   User types "refactor this function" in chat panel    │
└────────────────────────┬───────────────────────────────┘
                         │ HTTP POST /sessions/:id/inject
                         ▼
┌─ opzero-claude Bun server ─────────────────────────────┐
│   Looks up session → channel plugin socket path        │
│   POSTs {text, session_id} to 127.0.0.1:<port>         │
│   with shared-secret header                            │
└────────────────────────┬───────────────────────────────┘
                         │ HTTP POST
                         ▼
┌─ opzero channel MCP plugin (stdio child of `claude`) ──┐
│   Validates secret, calls mcp.notification(...)        │
└────────────────────────┬───────────────────────────────┘
                         │ stdio (MCP notification)
                         ▼
┌─ terminal `claude` process (the user's live session) ──┐
│   Injects <channel source="opzero" ...>text</channel>  │
│   into the agent loop as the next user turn            │
│   Claude responds in JSONL → written to                │
│   ~/.claude/projects/*/session-<id>.jsonl              │
└────────────────────────┬───────────────────────────────┘
                         │ JSONL append
                         ▼
┌─ opzero-claude tailer (existing read-only tailer) ─────┐
│   Mirrors new JSONL lines back to the web UI           │
└────────────────────────────────────────────────────────┘
```

The only new bits opzero-claude needs:

- A small channel plugin package (~100 lines of TypeScript, mirrors fakechat).
- A way to get users to launch claude with `--dangerously-load-development-channels server:opzero-channel` (until it's on the allowlist) — document this in onboarding, or have opzero-claude's own "spawn session" path auto-include it.
- A discovery mechanism: when the channel plugin starts, write its `{session_id, port, secret}` tuple to `~/.opzero-claude/active-channels.json` so the Bun server can find it.
- Session-to-channel mapping keyed off the `claude` session id.

The tailer stays exactly as-is: JSONL is still the source of truth for what happened in the session. The channel only adds a *write* path. This is a clean extension of the current architecture.

### Caveats / constraints

- **Research preview.** Protocol (`notifications/claude/channel`, the `<channel>` tag shape) may change. Flag is `--dangerously-load-development-channels` until the plugin is on Anthropic's curated allowlist or an admin adds it to `allowedChannelPlugins`.
- **Requires claude.ai OAuth login.** API-key-only users can't use channels. Team/Enterprise admins must flip `channelsEnabled`.
- **Version floor.** 2.1.80 for Channels, 2.1.81 for permission relay.
- **Must authenticate the sender.** An ungated channel is a prompt-injection hole. Use a shared secret issued per-session, or require unix-socket peer uid matching.
- **One `claude` process = one set of channels.** You can't retroactively attach a channel to a running claude that wasn't started with `--channels`; the MCP subprocess is spawned at startup. Opzero-claude would need the user to launch their terminal claude via an opzero-claude wrapper (or we document the flag). No way around this without a protocol change from Anthropic.
- **Replies go through a tool call, not stdout.** Claude will use the `reply` MCP tool you expose; the local terminal shows `reply: sent` but not the reply text. Opzero-claude would read replies either via the plugin's own channel back to the Bun server, or by tailing the JSONL (which is what we already do).

## 8. Dead-end evidence for the original question

The original question — "does `--remote-control-session-name-prefix` + `RemoteTrigger` expose a channel for injecting prompts into a running `claude`?" — the answer is **no**:

1. `--remote-control-session-name-prefix` is a cosmetic label flag for the cloud bridge.
2. Remote Control is 100% outbound HTTPS to Anthropic. No local listener at all. Confirmed by the official security docs: *"never opens inbound ports on your machine"*.
3. `RemoteTrigger` is a CRUD tool for `/v1/code/triggers` — the scheduled-cloud-agents feature (same thing the `schedule` skill manages). Not a local IPC primitive.
4. The "bridge" architecture in the binary (`pollForWork`, `/v1/environments/bridge`, `/session_ingress/ws/`) is all Anthropic-server-mediated. To inject a prompt you'd need to be Anthropic's claude.ai web backend, which would mean impersonating the user to their own cloud session.

## 9. Recommendation

**Pivot.** Abandon the RemoteTrigger/remote-control investigation path; it doesn't exist as a local IPC. Instead, build a small "opzero-channel" MCP server following the `channels-reference` webhook pattern and require users to launch their terminal `claude` with `--dangerously-load-development-channels server:opzero-channel` (or wrap the spawn inside opzero-claude itself).

This gives us:

- Real write-access into running sessions that weren't spawned by our Bun server, as long as they opted in at startup.
- Symmetry with our existing JSONL tailer for the read path.
- A well-documented, officially supported (if preview) extension point.
- A clear upgrade path: once our plugin lands on Anthropic's allowlist, users can use plain `--channels` with no dangerous flag.

**Next concrete step:** clone `anthropics/claude-plugins-official` and read `external_plugins/fakechat` end-to-end; it is the closest reference (localhost HTTP + reply tool + two-way chat UI). Then adapt it into `packages/opzero-channel/` inside opzero-claude, plus a new Bun-server route that discovers active channels and POSTs to them.

Estimated effort: ~1–2 days for a working prototype, ~1 week for hardened multi-session routing, sender-secret rotation, and onboarding UX. Much cheaper than any path that would require reverse-engineering Anthropic's cloud bridge.

---

## Appendix: commands I ran

```bash
# Confirm the flag exists and find the subcommand
claude --help 2>&1                                     # shows --remote-control-session-name-prefix
claude remote-control --help 2>&1                      # reveals full subcommand

# Try to run it in a sandbox dir (failed fast — expected)
mkdir -p /tmp/rc-probe-opz && cd /tmp/rc-probe-opz
claude --remote-control-session-name-prefix test-rc --bare -p "hi" --model haiku
# -> "Not logged in · Please run /login", exit 0. No local files created.

# Pull strings out of the binary
strings /Users/opz/.local/share/claude/versions/2.1.101 | grep -iE 'RemoteTrigger|remote-control|session_ingress|bridge:|v1/code'
# -> bridge URLs, RemoteTriggerTool source, /v1/code/triggers CRUD, session_ingress_token paths

# Fetch authoritative docs
# https://code.claude.com/docs/en/remote-control
# https://code.claude.com/docs/en/channels
# https://code.claude.com/docs/en/channels-reference
```

## Appendix: most surprising finding

The "remote" features in Claude Code form **three orthogonal systems**, and only one of them is what opzero-claude actually wants:

| System | What it does | Network direction | Useful for opzero-claude? |
|---|---|---|---|
| **Remote Control** (`claude remote-control`, `--remote-control-session-name-prefix`) | Connects local claude to `claude.ai/code` web/mobile UI via Anthropic's cloud bridge | Outbound only | No — routes through Anthropic, not us |
| **RemoteTrigger tool** | Claude-callable CRUD for `/v1/code/triggers` (scheduled cloud agents) | Outbound only | No — manages cron jobs in the cloud |
| **Channels** (`--channels`, MCP `claude/channel` capability) | MCP stdio subprocess can push `notifications/claude/channel` → `<channel>` user-turn events into the live agent loop | Whatever the channel plugin wants (localhost HTTP, file watcher, chat API, etc.) | **Yes — this is the device-hopping primitive** |

The naming collision ("Remote Control" vs "RemoteTrigger") made it look like the answer to our question should be one of those two — but the actual answer is a third feature (Channels) that doesn't have "remote" in its name and was released as a research preview two minor versions before 2.1.101. Without reading `channels-reference.md` in full, you'd never know that `mcp.notification({ method: 'notifications/claude/channel' })` is the real injection primitive.
