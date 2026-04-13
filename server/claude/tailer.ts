import { watch, type FSWatcher } from "fs";
import { open, stat } from "fs/promises";
import { join } from "path";
import type { EventBus } from "../bus";
import type {
  Message,
  Part,
  TextPart,
  ThinkingPart,
  ToolUsePart,
} from "../types";
import { claudeProjectsRoot } from "./paths";

interface JsonlRecord {
  type?: string;
  parentUuid?: string | null;
  sessionId?: string;
  uuid?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: "user" | "assistant";
    model?: string;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          thinking?: string;
          name?: string;
          id?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        }>;
    usage?: unknown;
  };
}

export class SessionTailer {
  readonly sessionId: string;
  readonly slug: string;
  readonly path: string;

  private bus: EventBus;
  private watcher: FSWatcher | null = null;
  private position = 0;
  private buffer = "";
  private disposed = false;
  private reading = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(slug: string, sessionId: string, bus: EventBus) {
    this.slug = slug;
    this.sessionId = sessionId;
    this.bus = bus;
    this.path = join(claudeProjectsRoot(), slug, `${sessionId}.jsonl`);
  }

  async start(): Promise<void> {
    try {
      const st = await stat(this.path);
      this.position = st.size;
    } catch {
      this.position = 0;
    }
    this.attachWatcher();
  }

  private attachWatcher(): void {
    if (this.disposed || this.watcher) return;
    try {
      this.watcher = watch(
        this.path,
        { persistent: false },
        (eventType) => {
          if (this.disposed) return;
          if (eventType === "change" || eventType === "rename") {
            void this.readNew();
          }
        },
      );
      this.watcher.on("error", () => {
        this.detachWatcher();
        this.scheduleRetry();
      });
    } catch {
      this.scheduleRetry();
    }
  }

  private detachWatcher(): void {
    try {
      this.watcher?.close();
    } catch {}
    this.watcher = null;
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.readNew();
      this.attachWatcher();
    }, 2000);
  }

  private async readNew(): Promise<void> {
    if (this.reading || this.disposed) return;
    this.reading = true;
    try {
      const st = await stat(this.path).catch(() => null);
      if (!st) return;
      if (st.size < this.position) {
        this.position = 0;
        this.buffer = "";
      }
      if (st.size === this.position) return;
      const fh = await open(this.path, "r");
      try {
        const len = st.size - this.position;
        const buf = new Uint8Array(len);
        await fh.read(buf, 0, len, this.position);
        this.position = st.size;
        this.buffer += new TextDecoder().decode(buf);
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      } finally {
        await fh.close();
      }
    } catch {
      // ignore transient read errors; the next watch event will retry
    } finally {
      this.reading = false;
    }
  }

  private handleLine(line: string): void {
    let rec: JsonlRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    if (!rec.type || !rec.uuid) return;

    if (rec.type === "user" && rec.message?.role === "user") {
      const content = rec.message.content;
      if (typeof content === "string" && content.length > 0) {
        this.emitUserMessage(rec.uuid, content, rec.timestamp);
      }
      return;
    }

    if (rec.type === "assistant" && Array.isArray(rec.message?.content)) {
      const content = rec.message!.content as Array<{
        type: string;
        text?: string;
        thinking?: string;
        name?: string;
        id?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: unknown;
        is_error?: boolean;
      }>;
      this.emitAssistantMessage(
        rec.uuid,
        content,
        rec.message!.model,
        rec.timestamp,
      );
      return;
    }
  }

  private emitUserMessage(uuid: string, text: string, timestamp?: string): void {
    const messageId = `msg_tail_${uuid.slice(0, 12)}`;
    const part: TextPart = {
      id: `prt_tail_${uuid.slice(0, 12)}`,
      messageId,
      sessionId: this.sessionId,
      type: "text",
      text,
    };
    const message: Message = {
      id: messageId,
      sessionId: this.sessionId,
      role: "user",
      time: {
        created: timestamp ? Date.parse(timestamp) : Date.now(),
      },
      parts: [part],
    };
    this.bus.emit({
      type: "message.created",
      sessionId: this.sessionId,
      message,
    });
  }

  private emitAssistantMessage(
    uuid: string,
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      id?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>,
    model: string | undefined,
    timestamp?: string,
  ): void {
    const messageId = `msg_tail_${uuid.slice(0, 12)}`;
    const parts: Part[] = [];
    let idx = 0;
    for (const block of content) {
      const partId = `prt_tail_${uuid.slice(0, 12)}_${idx++}`;
      if (block.type === "text" && typeof block.text === "string") {
        const p: TextPart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "text",
          text: block.text,
        };
        parts.push(p);
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string"
      ) {
        const p: ThinkingPart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "thinking",
          text: block.thinking,
        };
        parts.push(p);
      } else if (block.type === "tool_use") {
        const p: ToolUsePart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "tool_use",
          tool: block.name ?? "",
          input: block.input ?? {},
          state: "completed",
        };
        parts.push(p);
      }
    }
    if (parts.length === 0) return;
    const message: Message = {
      id: messageId,
      sessionId: this.sessionId,
      role: "assistant",
      model,
      time: {
        created: timestamp ? Date.parse(timestamp) : Date.now(),
      },
      parts,
    };
    this.bus.emit({
      type: "message.created",
      sessionId: this.sessionId,
      message,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.detachWatcher();
  }
}
