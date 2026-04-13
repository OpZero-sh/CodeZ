#!/usr/bin/env bun
/**
 * opzero-channel: a Claude Code channel MCP plugin that exposes a loopback
 * HTTP surface so the opzero-claude web server can inject prompts into a
 * running `claude` process and receive reply-tool invocations over SSE.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Notification,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const VERSION = "0.1.0";
const PLUGIN_NAME = "opzero-channel";
const META_KEY_RE = /^[a-zA-Z0-9_]+$/;
const HEARTBEAT_MS = 20_000;

const sessionId = process.env.OPZERO_CHANNEL_SESSION_ID;
if (!sessionId) {
  console.error(
    `[${PLUGIN_NAME}] OPZERO_CHANNEL_SESSION_ID env var required; launch via scripts/launch-opzero.sh`,
  );
  process.exit(1);
}

const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const channelsDir = join(homedir(), ".opzero-claude", "channels");
const discoveryPath = join(channelsDir, `${sessionId}.json`);

type Listener = (chunk: string) => void;
const listeners = new Set<Listener>();

function broadcast(event: Record<string, unknown>): void {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const l of listeners) {
    try {
      l(line);
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] listener error:`, err);
    }
  }
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta || typeof meta !== "object") return out;
  for (const [k, v] of Object.entries(meta)) {
    if (!META_KEY_RE.test(k)) continue;
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

function checkSecret(req: Request): boolean {
  return req.headers.get("x-opzero-secret") === secret;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const mcp = new Server(
  { name: PLUGIN_NAME, version: VERSION },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions:
      'Messages from the opzero channel arrive as <channel source="opzero-channel" chat_id="..." source_app="opzero">text</channel>. These are prompts sent from the opzero-claude web UI on another device (usually a phone). Respond normally — your response will be routed back by calling the `reply` tool with the incoming chat_id and your message text. The reply tool is the ONLY way the remote user will see your response; the terminal will just show "sent". Always call reply for every channel message.',
  },
);

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  broadcast({
    type: "permission_request",
    request_id: params.request_id,
    tool_name: params.tool_name,
    description: params.description,
    input_preview: params.input_preview,
    ts: Date.now(),
  });
});

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message back over the opzero channel to the remote web UI. Call this for every channel message you receive; it is the only way the remote user sees your response.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description:
              "The chat_id from the incoming <channel> tag — identifies which conversation to reply to.",
          },
          text: {
            type: "string",
            description: "The message text to send back to the remote user.",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const chat_id = typeof args.chat_id === "string" ? args.chat_id : "";
  const text = typeof args.text === "string" ? args.text : "";
  if (!chat_id || !text) {
    throw new Error("reply requires chat_id and text string arguments");
  }
  broadcast({ type: "reply", chat_id, text, ts: Date.now() });
  return { content: [{ type: "text", text: "sent" }] };
});

async function emitChannel(
  content: string,
  meta: Record<string, string>,
): Promise<void> {
  const note: Notification = {
    method: "notifications/claude/channel",
    params: { content, meta },
  };
  await mcp.notification(note);
}

async function handleInject(req: Request): Promise<Response> {
  if (!checkSecret(req)) return jsonResponse(403, { error: "forbidden" });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json body" });
  }
  if (!body || typeof body !== "object") {
    return jsonResponse(400, { error: "body must be an object" });
  }
  const b = body as {
    content?: unknown;
    meta?: unknown;
    chat_id?: unknown;
  };
  const content = typeof b.content === "string" ? b.content : "";
  if (!content) {
    return jsonResponse(400, { error: "content required" });
  }
  const chatId = typeof b.chat_id === "string" && b.chat_id ? b.chat_id : "inject";
  const meta: Record<string, string> = {
    chat_id: chatId,
    ...sanitizeMeta(
      b.meta && typeof b.meta === "object"
        ? (b.meta as Record<string, unknown>)
        : undefined,
    ),
  };
  meta.chat_id = chatId;
  await emitChannel(content, meta);
  return jsonResponse(202, { ok: true });
}

function handleEvents(req: Request): Response {
  if (!checkSecret(req)) return jsonResponse(403, { error: "forbidden" });
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let listener: Listener | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      listener = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          console.error(`[${PLUGIN_NAME}] enqueue error:`, err);
        }
      };
      listeners.add(listener);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* stream closed */
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (listener) {
        listeners.delete(listener);
        listener = null;
      }
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

async function handlePermissionVerdict(req: Request): Promise<Response> {
  if (!checkSecret(req)) return jsonResponse(403, { error: "forbidden" });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json body" });
  }
  if (!body || typeof body !== "object") {
    return jsonResponse(400, { error: "body must be an object" });
  }
  const b = body as { request_id?: unknown; behavior?: unknown };
  const request_id = typeof b.request_id === "string" ? b.request_id : "";
  const behavior =
    b.behavior === "allow" || b.behavior === "deny" ? b.behavior : null;
  if (!request_id || !behavior) {
    return jsonResponse(400, {
      error: "request_id and behavior (allow|deny) required",
    });
  }
  const note: Notification = {
    method: "notifications/claude/channel/permission",
    params: { request_id, behavior },
  };
  await mcp.notification(note);
  broadcast({
    type: "permission_resolved",
    request_id,
    behavior,
    ts: Date.now(),
  });
  return jsonResponse(202, { ok: true });
}

function handleStatus(): Response {
  return jsonResponse(200, {
    ok: true,
    sessionId,
    pid: process.pid,
    version: VERSION,
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    try {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/inject") {
        return await handleInject(req);
      }
      if (req.method === "POST" && url.pathname === "/permission") {
        return await handlePermissionVerdict(req);
      }
      if (req.method === "GET" && url.pathname === "/events") {
        return handleEvents(req);
      }
      if (req.method === "GET" && url.pathname === "/status") {
        return handleStatus();
      }
      return jsonResponse(404, { error: "not found" });
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] fetch handler error:`, err);
      return jsonResponse(500, { error: "internal error" });
    }
  },
});

const port = server.port;

await mkdir(channelsDir, { recursive: true });
await writeFile(
  discoveryPath,
  JSON.stringify(
    {
      pid: process.pid,
      sessionId,
      port,
      secret,
      createdAt: Date.now(),
      version: VERSION,
    },
    null,
    2,
  ),
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[${PLUGIN_NAME}] shutting down (${signal})`);
  try {
    await unlink(discoveryPath);
  } catch {
    /* already gone */
  }
  try {
    server.stop(true);
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] server stop error:`, err);
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("exit", () => {
  try {
    unlinkSync(discoveryPath);
  } catch {
    /* already gone */
  }
});

try {
  await mcp.connect(new StdioServerTransport());
} catch (err) {
  console.error(`[${PLUGIN_NAME}] mcp connect failed:`, err);
  await shutdown("mcp-connect-failed");
}

console.error(
  `[${PLUGIN_NAME}] ready sessionId=${sessionId} port=${port} pid=${process.pid}`,
);
