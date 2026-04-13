# MCP Server

## What it does

CodeZ exposes a remote MCP server at `/mcp` on its main HTTP server.
Any MCP-compatible agent (Claude Code, custom agents, etc.) can connect
and get full programmatic control: create sessions, send prompts, watch
real-time events, manage permissions, search across history, and read
observability data.

The endpoint uses the MCP Streamable HTTP transport (RFC-compliant
POST/GET/DELETE on a single path). Authentication is handled by
[MCPAuthKit](https://github.com/OpZero-sh/MCPAuthKit) OAuth 2.1 tokens
for remote access, with loopback bypass for local agents on the same
machine.

## Requirements

- CodeZ server running (default `127.0.0.1:4097`)
- For remote access: a deployed CodeZ instance reachable over HTTPS
  (e.g. via Cloudflare tunnel)
- For remote access: an MCPAuthKit instance for OAuth (e.g.
  `authkit.yourdomain.com`)

## Connect from Claude Code

### Local (same machine)

No auth needed. Add to `~/.config/claude/mcp_servers.json`:

```json
{
  "codez": {
    "type": "http",
    "url": "http://127.0.0.1:4097/mcp"
  }
}
```

Restart Claude Code. The 17 CodeZ tools will appear in your tool list.

### Remote (over the internet)

Remote connections require an OAuth token from your MCPAuthKit instance.
Claude Code handles the OAuth flow automatically when configured:

```json
{
  "codez": {
    "type": "http",
    "url": "https://your-codez-domain.com/mcp"
  }
}
```

On first use, Claude Code will:

1. Discover the Protected Resource Metadata at
   `https://your-codez-domain.com/.well-known/oauth-protected-resource`
2. Find the authorization server (your MCPAuthKit instance)
3. Open a browser window for OAuth consent
4. Exchange the authorization code for an access token
5. Use the token for all subsequent requests (auto-refreshes)

No manual token management required.

## Connect from a custom agent

If you're building your own MCP client, the flow is:

1. **Discover auth**: `GET https://your-codez-domain.com/.well-known/oauth-protected-resource`
   returns:
   ```json
   {
     "resource": "https://your-codez-domain.com",
     "authorization_servers": ["https://your-authkit-domain.com"],
     "scopes_supported": ["mcp:tools"],
     "bearer_methods_supported": ["header"]
   }
   ```

2. **Get a token**: Complete the OAuth 2.1 + PKCE flow with the
   authorization server (dynamic client registration, authorize,
   token exchange). See [MCPAuthKit integration guide](https://github.com/OpZero-sh/MCPAuthKit/blob/main/docs/integration.md).

3. **Call /mcp**: Send MCP JSON-RPC messages via HTTP:
   ```bash
   curl -X POST https://your-codez-domain.com/mcp \
     -H "Authorization: Bearer mat_your_token_here" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

4. **Handle sessions**: The server returns an `mcp-session-id` header
   on the first response. Include it in subsequent requests for
   stateful communication.

## Available tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all Claude Code projects with slugs and session counts |
| `list_sessions` | List sessions for a project |
| `get_session` | Get full session details including messages and parts |
| `create_session` | Create a new live Claude Code session |
| `send_prompt` | Send a prompt to a session (resumes idle, injects via channel for mirror) |
| `abort_session` | Abort the currently running turn |
| `dispose_session` | Kill and dispose a live session process |
| `fork_session` | Fork an existing session into a new conversation branch |
| `respond_permission` | Allow or deny a tool permission request |
| `get_project_memory` | Read .claude/ memory files for a project |
| `search_sessions` | Full-text search across all session content |
| `poll_events` | Poll for real-time SSE events (session activity, streaming, tasks) |
| `get_health` | Check server health |
| `get_health_details` | Get self-heal log and subsystem status |
| `get_state` | Get application state (markers, preferences) |
| `update_state` | Update application state |
| `get_observability` | Get cost and usage statistics across all projects |

## Example workflows

### Watch a session in real time

```
1. list_projects                          → find the project slug
2. list_sessions(slug)                    → find the session ID
3. poll_events(session_id, timeout_ms=10000)  → watch for new messages
```

### Start a session and send a prompt

```
1. create_session(slug, cwd="/path/to/project")  → get session_id
2. send_prompt(session_id, text="Fix the failing tests", slug=slug)
3. poll_events(session_id)                → watch Claude work
4. get_session(session_id, slug)          → read the full conversation
```

### Orchestrate multiple sessions

```
1. create_session(slug, cwd=path1)  → session A
2. create_session(slug, cwd=path2)  → session B
3. send_prompt(A, "Refactor the auth module")
4. send_prompt(B, "Update the tests")
5. poll_events()                    → watch both (no session filter)
6. get_observability()              → check total cost
```

## Standalone server

The `packages/codezero-mcp/` package can also run as a standalone
process on a separate port, useful for development or isolation:

```bash
bun run packages/codezero-mcp/index.ts
# Starts on port 4098 (configurable via CODEZ_MCP_PORT)
```

Configure agents to point at `http://127.0.0.1:4098/mcp` instead.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTHKIT_URL` | _(none — must be set)_ | Your MCPAuthKit OAuth server URL |
| `CODEZ_MCP_URL` | auto-detected from request | Public URL for PRM metadata |
| `CODEZ_MCP_PORT` | `4098` | Port for standalone server only |
| `CODEZ_MCP_HOST` | `0.0.0.0` | Bind host for standalone server only |
| `CODEZ_URL` | `http://127.0.0.1:4097` | CodeZ API URL (standalone only) |

## Server registration (one-time setup)

Register CodeZ as a resource server with your MCPAuthKit instance:

```bash
curl -X POST https://your-authkit-domain.com/api/servers \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "codez-mcp",
    "resource_url": "https://your-codez-domain.com/mcp",
    "scopes": ["mcp:tools"]
  }'
```

Save the returned `server_id` — it identifies your CodeZ instance in
the AuthKit system.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Unauthorized: Bearer token required" | No or invalid OAuth token | Check your MCP config URL matches the deployed server |
| Tools don't appear in Claude Code | Config not loaded | Restart Claude Code after editing `mcp_servers.json` |
| "Session not found" on GET /mcp | Stale MCP session | Client should re-initialize (POST without session ID) |
| Connection refused on :4097 | Server not running | Start with `bun run start` |
| OAuth redirect loop | AuthKit not registered | Run the server registration step above |
| "codez-mcp not found" in Claude | Wrong config key | Verify the JSON in `mcp_servers.json` is valid |
| Local works but remote fails | Missing tunnel route | Ensure your tunnel config routes to port 4097 |
