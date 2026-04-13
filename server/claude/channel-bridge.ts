import type { EventBus } from "../bus";
import type { ChannelDiscovery } from "./channels";
import { readChannelDiscovery } from "./channels";

interface BridgeHandle {
  sessionId: string;
  abort: AbortController;
  started: number;
}

export class ChannelBridgePool {
  private map = new Map<string, BridgeHandle>();

  constructor(private bus: EventBus) {}

  ensure(sessionId: string, discovery: ChannelDiscovery): void {
    if (this.map.has(sessionId)) return;
    const abort = new AbortController();
    const handle: BridgeHandle = {
      sessionId,
      abort,
      started: Date.now(),
    };
    this.map.set(sessionId, handle);
    void this.run(handle, discovery).catch((err) => {
      console.error(`[channel-bridge:${sessionId}] fatal:`, err);
      this.map.delete(sessionId);
    });
  }

  stop(sessionId: string): void {
    const h = this.map.get(sessionId);
    if (!h) return;
    h.abort.abort();
    this.map.delete(sessionId);
  }

  stopAll(): void {
    for (const h of this.map.values()) {
      try {
        h.abort.abort();
      } catch {}
    }
    this.map.clear();
  }

  private async run(
    handle: BridgeHandle,
    discovery: ChannelDiscovery,
  ): Promise<void> {
    const { sessionId, abort } = handle;
    const url = `http://127.0.0.1:${discovery.port}/events`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-OPZero-Secret": discovery.secret },
        signal: abort.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      console.error(`[channel-bridge:${sessionId}] connect failed:`, err);
      this.map.delete(sessionId);
      return;
    }
    if (!res.ok || !res.body) {
      console.error(
        `[channel-bridge:${sessionId}] bad response ${res.status}`,
      );
      this.map.delete(sessionId);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!abort.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(sessionId, frame);
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.error(`[channel-bridge:${sessionId}] stream error:`, err);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
      this.map.delete(sessionId);
    }
  }

  private handleFrame(sessionId: string, frame: string): void {
    const event = parseChannelFrame(sessionId, frame);
    if (event) this.bus.emit(event);
  }
}

export function parseChannelFrame(
  sessionId: string,
  frame: string,
): { type: "channel.permission_request"; sessionId: string; request: { requestId: string; toolName: string; description: string; inputPreview: string } } | { type: "channel.permission_resolved"; sessionId: string; requestId: string } | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { type?: unknown };
  if (obj.type === "permission_request") {
    const p = parsed as {
      request_id?: unknown;
      tool_name?: unknown;
      description?: unknown;
      input_preview?: unknown;
    };
    if (
      typeof p.request_id !== "string" ||
      typeof p.tool_name !== "string" ||
      typeof p.description !== "string" ||
      typeof p.input_preview !== "string"
    ) {
      return null;
    }
    return {
      type: "channel.permission_request",
      sessionId,
      request: {
        requestId: p.request_id,
        toolName: p.tool_name,
        description: p.description,
        inputPreview: p.input_preview,
      },
    };
  } else if (obj.type === "permission_resolved") {
    const p = parsed as { request_id?: unknown };
    if (typeof p.request_id !== "string") return null;
    return {
      type: "channel.permission_resolved",
      sessionId,
      requestId: p.request_id,
    };
  }
  return null;
}

export async function discoverAndBridge(
  pool: ChannelBridgePool,
  sessionId: string,
): Promise<ChannelDiscovery | null> {
  const discovery = await readChannelDiscovery(sessionId);
  if (!discovery) return null;
  pool.ensure(sessionId, discovery);
  return discovery;
}
