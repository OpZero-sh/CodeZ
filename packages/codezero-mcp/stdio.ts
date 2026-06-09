#!/usr/bin/env bun
/**
 * codezero-mcp stdio transport — Claude Code plugin entry point.
 *
 * Configure in ~/.claude.json:
 *   "mcpServers": {
 *     "codez": {
 *       "command": "bun",
 *       "args": ["run", "/path/to/CodeZ/packages/codezero-mcp/stdio.ts"],
 *       "env": {
 *         "CODEZ_HUB_URL": "wss://code.open0p.com/ws",
 *         "CODEZ_HUB_TOKEN": "mat_..."
 *       }
 *     }
 *   }
 *
 * When Claude Code starts, it spawns this process which:
 * 1. Checks if the CodeZ server is already running
 * 2. If not, spawns it as a managed background process
 * 3. Speaks MCP over stdio, proxying tool calls to CodeZ's HTTP API
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CodeZClient } from "./client.ts";
import { EventPoller } from "./events.ts";
import { registerTools } from "./tools.ts";
import { spawn, type Subprocess } from "bun";
import { resolve, dirname } from "node:path";

const CODEZERO_URL = process.env.CODEZERO_URL || "http://127.0.0.1:4097";
const HEALTH_ENDPOINT = `${CODEZERO_URL}/api/health`;
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 500;

// Resolve the CodeZ server entry point relative to this file
const CODEZERO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_ENTRY = resolve(CODEZERO_ROOT, "server/index.ts");

let managedProcess: Subprocess | null = null;

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_ENDPOINT, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerRunning()) return;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`CodeZ server did not start within ${timeoutMs}ms`);
}

async function ensureServerRunning(): Promise<void> {
  if (await isServerRunning()) {
    process.stderr.write("[codezero-mcp] server already running\n");
    return;
  }

  process.stderr.write(`[codezero-mcp] starting CodeZ server from ${SERVER_ENTRY}\n`);

  // Pass through hub env vars so the server connects to the hub
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  managedProcess = spawn({
    cmd: ["bun", "run", SERVER_ENTRY],
    cwd: CODEZERO_ROOT,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });

  try {
    await waitForServer(STARTUP_TIMEOUT_MS);
    process.stderr.write("[codezero-mcp] server started successfully\n");
  } catch (err) {
    managedProcess.kill();
    managedProcess = null;
    throw err;
  }
}

function cleanup(): void {
  if (managedProcess) {
    process.stderr.write("[codezero-mcp] stopping managed server\n");
    managedProcess.kill();
    managedProcess = null;
  }
}

// --- Main ---

await ensureServerRunning();

const client = new CodeZClient(CODEZERO_URL);
const poller = new EventPoller(CODEZERO_URL);
poller.connect();

const server = new Server(
  { name: "codez", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerTools(server, client, poller);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
