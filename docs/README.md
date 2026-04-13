# CodeZero Documentation

## Guides

- [Architecture](architecture.md) — system architecture diagram and data flow
- [MCP Server](mcp.md) — remote MCP server reference (17 tools, OAuth, connection guide)
- [Channels](channels.md) — bidirectional terminal relay via MCP plugin
- [Installation](install.md) — Docker, Bun, Homebrew, and environment setup
- [launchd](launchd.md) — macOS auto-start with LaunchAgent

## Quick Reference

| Component | Port | Description |
|-----------|------|-------------|
| Bun HTTP server | 4097 | Main server (API + SPA + MCP transport) |
| codezero-mcp | 4098 | Standalone MCP server (development/isolation) |
| Vite dev server | 5173 | Frontend dev server (proxies /api to 4097) |

## Related Projects

- [MCPAuthKit](https://github.com/OpZero-sh/MCPAuthKit) — OAuth 2.1 gateway for MCP server authentication
- [OpZero](https://opzero.sh) — parent project
