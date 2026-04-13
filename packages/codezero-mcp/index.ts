#!/usr/bin/env bun
/**
 * codezero-mcp: a remote MCP server that exposes CodeZero's session management,
 * prompting, and event streaming as MCP tools over Streamable HTTP transport.
 * Agents connect via {"type": "http", "url": "http://127.0.0.1:4098/mcp"}.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CodeZeroClient } from "./client.ts";
import { EventPoller } from "./events.ts";
import { registerTools } from "./tools.ts";

const PORT = Number(process.env.CODEZERO_MCP_PORT) || 4098;
const CODEZERO_URL = process.env.CODEZERO_URL || "http://127.0.0.1:4097";
const AUTHKIT_URL = process.env.AUTHKIT_URL || "";
const RESOURCE_URL = process.env.CODEZERO_MCP_URL || `http://127.0.0.1:${PORT}`;

interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
}

// Token validation cache: token hash -> { user, expiresAt }
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

function unauthorizedResponse(req: Request): Response {
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
        "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_URL}/.well-known/oauth-protected-resource"`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

// Returns AuthInfo for the MCP transport, or null if unauthenticated
async function authenticateRequest(
  req: Request,
): Promise<{ token: string; clientId: string; scopes: string[] } | null> {
  // Loopback bypass — same pattern as the main CodeZero server
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

const client = new CodeZeroClient(CODEZERO_URL);
const poller = new EventPoller(CODEZERO_URL);
poller.connect();

// Stateful: each MCP session gets its own transport so notifications
// and server-initiated messages route to the correct client.
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

function createServer(): Server {
  const server = new Server(
    { name: "codezero-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
    },
  );
  registerTools(server, client, poller);
  return server;
}

const httpServer = Bun.serve({
  // Bind 0.0.0.0 so the server is reachable through Cloudflare tunnel;
  // auth gate protects non-loopback requests via AuthKit OAuth tokens.
  hostname: process.env.CODEZERO_MCP_HOST || "0.0.0.0",
  port: PORT,
  idleTimeout: 0,
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // CORS preflight — MCP clients may send OPTIONS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id, mcp-protocol-version",
          "Access-Control-Expose-Headers": "mcp-session-id",
        },
      });
    }

    // RFC 9728: Protected Resource Metadata
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return Response.json(
        {
          resource: RESOURCE_URL,
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

    if (url.pathname === "/mcp") {
      // Auth gate — loopback bypasses, remote requires a valid token
      const authInfo = await authenticateRequest(req);
      if (!authInfo) return unauthorizedResponse(req);
      if (req.method === "POST") {
        const sessionId = req.headers.get("mcp-session-id");
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          // Capture in a local so the closure can reference it after the map insert
          const t = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              transports.set(id, t);
            },
          });
          transport = t;

          transport.onclose = () => {
            const entry = [...transports.entries()].find(
              ([, v]) => v === t,
            );
            if (entry) transports.delete(entry[0]);
          };

          const server = createServer();
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

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        name: "codezero-mcp",
        sessions: transports.size,
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[codezero-mcp] shutting down (${signal})`);
  poller.disconnect();
  httpServer.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.error(
  `[codezero-mcp] ready port=${PORT} codezero=${CODEZERO_URL} pid=${process.pid}`,
);
