import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface ChannelDiscovery {
  pid: number;
  sessionId: string;
  port: number;
  secret: string;
  createdAt: number;
  version: string;
}

export function channelsDir(): string {
  return join(homedir(), ".opzero-claude", "channels");
}

export function channelDiscoveryPath(sessionId: string): string {
  return join(channelsDir(), `${sessionId}.json`);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readChannelDiscovery(
  sessionId: string,
): Promise<ChannelDiscovery | null> {
  const path = channelDiscoveryPath(sessionId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    console.error(`[channels] failed to read ${path}:`, err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[channels] failed to parse ${path}:`, err);
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    console.error(`[channels] invalid discovery shape at ${path}`);
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const pid = obj.pid;
  const port = obj.port;
  const secret = obj.secret;
  if (
    typeof pid !== "number" ||
    typeof port !== "number" ||
    typeof secret !== "string"
  ) {
    console.error(`[channels] missing required fields in ${path}`);
    return null;
  }

  if (!isPidAlive(pid)) {
    try {
      await unlink(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`[channels] failed to unlink stale ${path}:`, err);
      }
    }
    return null;
  }

  return {
    pid,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : sessionId,
    port,
    secret,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : 0,
    version: typeof obj.version === "string" ? obj.version : "0.0.0",
  };
}

export async function injectToChannel(
  discovery: ChannelDiscovery,
  body: { content: string; meta?: Record<string, string>; chat_id?: string },
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${discovery.port}/inject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OPZero-Secret": discovery.secret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`inject ${res.status}: ${text}`);
  }
}

export async function postPermissionVerdict(
  discovery: ChannelDiscovery,
  body: { request_id: string; behavior: "allow" | "deny" },
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${discovery.port}/permission`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OPZero-Secret": discovery.secret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`permission ${res.status}: ${text}`);
  }
}
