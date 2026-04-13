/**
 * MCP Streamable HTTP transport route.
 *
 * Mounts at /mcp on the main CodeZero server so agents reach it via
 * the Cloudflare tunnel (e.g. codez.yourdomain.com/mcp).
 * Auth is handled here via AuthKit OAuth tokens — CodeZero's cookie
 * auth is bypassed for these paths (see auth.ts isPublicPath).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CodeZeroClient } from "../../packages/codezero-mcp/client.ts";
import { EventPoller } from "../../packages/codezero-mcp/events.ts";
import { registerTools, type ToolCallEvent } from "../../packages/codezero-mcp/tools.ts";
import type { EventBus } from "../bus";

let bus: EventBus | null = null;

export function initMcpTransport(eventBus: EventBus): void {
  bus = eventBus;
}

const AUTHKIT_URL = process.env.AUTHKIT_URL || "";

interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
}

const tokenCache = new Map<string, { user: UserInfo; expiresAt: number }>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

async function validateToken(token: string): Promise<UserInfo | null> {
  if (!token.startsWith("mat_")) return null;
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  try {
    const res = await fetch(`${AUTHKIT_URL}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as UserInfo;
    tokenCache.set(token, { user, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}

function isLoopback(req: Request): boolean {
  const host = new URL(req.url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function authenticateRequest(
  req: Request,
): Promise<{ token: string; clientId: string; scopes: string[] } | null> {
  if (isLoopback(req)) {
    return { token: "loopback", clientId: "loopback", scopes: ["mcp:tools"] };
  }
  const header = req.headers.get("authorization");
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const user = await validateToken(token);
  if (!user) return null;
  return { token, clientId: user.sub, scopes: ["mcp:tools"] };
}

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

// CodeZeroClient talks to ourselves on loopback — avoids coupling MCP
// tools directly to server internals.
const client = new CodeZeroClient();
const poller = new EventPoller();
poller.connect();

function createMcpServer(clientId: string): Server {
  const server = new Server(
    { name: "codezero-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, client, poller, (event: ToolCallEvent) => {
    if (!bus) return;
    if (event.phase === "started") {
      bus.emit({
        type: "mcp.tool_call.started",
        callId: event.callId,
        tool: event.tool,
        clientId,
        sessionId: event.sessionId,
        startedAt: Date.now(),
      });
    } else {
      bus.emit({
        type: "mcp.tool_call.finished",
        callId: event.callId,
        tool: event.tool,
        clientId,
        sessionId: event.sessionId,
        durationMs: event.durationMs ?? 0,
        isError: event.isError ?? false,
      });
    }
  });
  return server;
}

export function mcpPrmRoute(req: Request): Response {
  // Cloudflare tunnel forwards plain HTTP; use X-Forwarded-Proto to reconstruct the public origin
  let serverUrl = process.env.CODEZERO_MCP_URL;
  if (!serverUrl) {
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    serverUrl = `${proto}://${url.host}`;
  }
  return Response.json(
    {
      resource: serverUrl,
      authorization_servers: [AUTHKIT_URL],
      scopes_supported: ["mcp:tools"],
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function mcpTransportRoute(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, mcp-session-id, mcp-protocol-version",
        "Access-Control-Expose-Headers": "mcp-session-id",
      },
    });
  }

  const authInfo = await authenticateRequest(req);
  if (!authInfo) {
    const url_ = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") || url_.protocol.replace(":", "");
    const origin = `${proto}://${url_.host}`;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: Bearer token required" },
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "WWW-Authenticate",
        },
      },
    );
  }

  if (req.method === "POST") {
    const sessionId = req.headers.get("mcp-session-id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    // Stale session after server restart — return 404 so the client
    // re-initializes without needing to re-authenticate.
    if (sessionId && !transport) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Session expired, please re-initialize" },
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    if (!transport) {
      const t = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id: string) => {
          transports.set(id, t);
        },
      });
      transport = t;
      transport.onclose = () => {
        const entry = [...transports.entries()].find(([, v]) => v === t);
        if (entry) transports.delete(entry[0]);
      };
      const server = createMcpServer(authInfo.clientId);
      await server.connect(transport);
    }

    return transport.handleRequest(req, { authInfo });
  }

  if (req.method === "GET") {
    const sessionId = req.headers.get("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      return new Response("Session not found", { status: 404 });
    }
    return transport.handleRequest(req, { authInfo });
  }

  if (req.method === "DELETE") {
    const sessionId = req.headers.get("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (transport) {
      transports.delete(sessionId!);
      return transport.handleRequest(req, { authInfo });
    }
    return new Response(null, { status: 204 });
  }

  return new Response("Method not allowed", { status: 405 });
}

export function stopMcpPoller(): void {
  poller.disconnect();
}
