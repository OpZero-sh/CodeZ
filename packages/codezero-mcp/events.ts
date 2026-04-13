/**
 * Bridges the CodeZ SSE event stream into a pollable buffer for MCP tools.
 * MCP tools are request/response, so they can't hold open a streaming connection
 * during a single tool call. EventPoller maintains the SSE connection in the
 * background and lets tools drain buffered events on demand.
 */
export class EventPoller {
  private baseUrl: string;
  private buffer: any[] = [];
  private connected = false;
  private backoff = 1000;
  private waiters: Array<() => void> = [];

  constructor(baseUrl: string = "http://127.0.0.1:4097") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.startStream();
  }

  async poll(sessionId?: string, timeoutMs: number = 5000): Promise<any[]> {
    const drain = (): any[] => {
      if (!sessionId) {
        const events = this.buffer.splice(0);
        return events;
      }
      const matching: any[] = [];
      const remaining: any[] = [];
      for (const e of this.buffer) {
        if (e.sessionId === sessionId || e.type === "server.connected") {
          matching.push(e);
        } else {
          remaining.push(e);
        }
      }
      this.buffer = remaining;
      return matching;
    };

    const immediate = drain();
    if (immediate.length > 0 || timeoutMs <= 0) return immediate;

    // Block until an event arrives or the timeout fires
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, timeoutMs);
    });

    return drain();
  }

  disconnect(): void {
    this.connected = false;
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }

  // --- Internal ---

  private async startStream(): Promise<void> {
    while (this.connected) {
      try {
        const res = await fetch(`${this.baseUrl}/api/events`);
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        this.backoff = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let partial = "";

        while (this.connected) {
          const { done, value } = await reader.read();
          if (done) break;
          partial += decoder.decode(value, { stream: true });
          // SSE frames are delimited by double newlines
          const frames = partial.split("\n\n");
          partial = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(6));
              this.pushEvent(event);
            } catch {
              /* malformed JSON, skip */
            }
          }
        }
        reader.cancel().catch(() => {});
      } catch {
        if (!this.connected) break;
        await new Promise((r) => setTimeout(r, this.backoff));
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    }
  }

  private pushEvent(event: any): void {
    this.buffer.push(event);
    // Prevent unbounded growth if nobody is polling
    if (this.buffer.length > 1000) {
      this.buffer = this.buffer.slice(-1000);
    }
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
}
