import type { EventBus } from "../bus";
import type {
  Message,
  Part,
  ResultPart,
  Session,
  SessionMetadata,
  TextPart,
  ThinkingPart,
  ToolUsePart,
} from "../types";
import { recordMcpCall } from "../mcp-metrics";
import {
  parseLine,
  type AnthropicStreamEvent,
  type AssistantContentBlock,
  type StreamJsonEvent,
  type UserContentBlock,
} from "./protocol";
import { encodeProjectSlug } from "./paths";

export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

export type AuthMode = "oauth" | "apikey";

const AUTH_ERROR_PATTERNS = [
  /credit balance/i,
  /billing[_ ]?error/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /invalid.*api.?key/i,
  /expired.*token/i,
  /insufficient.*credits/i,
];

function isAuthError(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((p) => p.test(text));
}

let preferredAuthMode: AuthMode = "oauth";
let lastAuthFailure: { mode: AuthMode; time: number; error: string } | null =
  null;

export function getPreferredAuthMode(): AuthMode {
  return preferredAuthMode;
}

export function getAuthHealth(): {
  preferred: AuthMode;
  lastFailure: { mode: AuthMode; time: number; error: string } | null;
} {
  return { preferred: preferredAuthMode, lastFailure: lastAuthFailure };
}

export interface SessionProcessOptions {
  sessionId: string;
  cwd: string;
  model?: string;
  permissionMode?: PermissionMode;
  resume?: boolean;
  forkFrom?: string;
  authMode?: AuthMode;
}

function newPartId(): string {
  return `prt_${crypto.randomUUID().slice(0, 12)}`;
}

function newMessageId(): string {
  return `msg_${crypto.randomUUID().slice(0, 12)}`;
}

function now(): number {
  return Date.now();
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out.length ? out : undefined;
}

function asMcpServers(
  value: unknown,
): Array<{ name: string; status: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<{ name: string; status: string }> = [];
  for (const v of value) {
    if (v && typeof v === "object") {
      const o = v as { name?: unknown; status?: unknown };
      if (typeof o.name === "string") {
        out.push({
          name: o.name,
          status: typeof o.status === "string" ? o.status : "unknown",
        });
      }
    }
  }
  return out.length ? out : undefined;
}

function buildMetadataFromInit(init: {
  model?: unknown;
  permissionMode?: unknown;
  output_style?: unknown;
  tools?: unknown;
  agents?: unknown;
  skills?: unknown;
  slash_commands?: unknown;
  plugins?: unknown;
  mcp_servers?: unknown;
  claude_code_version?: unknown;
}): SessionMetadata {
  const md: SessionMetadata = {};
  if (typeof init.model === "string") md.model = init.model;
  if (typeof init.permissionMode === "string")
    md.permissionMode = init.permissionMode;
  if (typeof init.output_style === "string") md.outputStyle = init.output_style;
  const tools = asStringArray(init.tools);
  if (tools) md.tools = tools;
  const agents = asStringArray(init.agents);
  if (agents) md.agents = agents;
  const skills = asStringArray(init.skills);
  if (skills) md.skills = skills;
  const slashCommands = asStringArray(init.slash_commands);
  if (slashCommands) md.slashCommands = slashCommands;
  const plugins = asStringArray(init.plugins);
  if (plugins) md.plugins = plugins;
  const mcpServers = asMcpServers(init.mcp_servers);
  if (mcpServers) md.mcpServers = mcpServers;
  if (typeof init.claude_code_version === "string")
    md.claudeCodeVersion = init.claude_code_version;
  return md;
}

export class SessionProcess {
  readonly sessionId: string;
  readonly cwd: string;
  readonly model?: string;

  private child!: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private bus: EventBus;
  private session: Session;

  private currentMessageId: string | null = null;
  private currentMessage: Message | null = null;
  private partsByIndex = new Map<number, Part>();
  private toolCallIdByIndex = new Map<number, string>();
  private toolInputBuffers = new Map<number, string>();
  private toolUseOwners = new Map<
    string,
    { messageId: string; part: ToolUsePart }
  >();
  private toolStartTimes = new Map<string, number>();
  private mcpServerNames = new Set<string>();

  private stdoutTask!: Promise<void>;
  private stderrTask!: Promise<void>;
  private encoder = new TextEncoder();
  private closed = false;

  private opts: SessionProcessOptions;
  private savedApiKey: string | undefined;
  private authMode: AuthMode;
  private authRetried = false;
  private childGeneration = 0;
  private pendingAuthError: string | null = null;

  constructor(opts: SessionProcessOptions, bus: EventBus) {
    this.sessionId = opts.sessionId;
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.bus = bus;
    this.opts = opts;
    this.savedApiKey = process.env.ANTHROPIC_API_KEY;
    this.authMode = opts.authMode ?? preferredAuthMode;

    const createdAt = now();
    this.session = {
      id: opts.sessionId,
      projectSlug: encodeProjectSlug(opts.cwd),
      cwd: opts.cwd,
      createdAt,
      updatedAt: createdAt,
      status: "live",
      lastMessageAt: createdAt,
    };
    this.bus.emit({ type: "session.created", session: this.session });

    this.spawnChild();
  }

  private spawnChild(): void {
    const opts = this.opts;
    const args = [
      "claude",
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--replay-user-messages",
    ];
    if (opts.forkFrom) {
      args.push(
        "--resume",
        opts.forkFrom,
        "--fork-session",
        "--session-id",
        opts.sessionId,
      );
    } else if (opts.resume) {
      args.push("--resume", opts.sessionId);
    } else {
      args.push("--session-id", opts.sessionId);
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    } else if (opts.permissionMode) {
      args.push("--permission-mode", opts.permissionMode);
    }

    const env = { ...process.env };
    if (this.authMode === "oauth") {
      delete env.ANTHROPIC_API_KEY;
    } else if (this.savedApiKey) {
      env.ANTHROPIC_API_KEY = this.savedApiKey;
    }

    this.child = Bun.spawn(args, {
      cwd: opts.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const gen = ++this.childGeneration;
    this.stdoutTask = this.readStdout();
    this.stderrTask = this.readStderr();
    this.child.exited.then(() => {
      if (gen !== this.childGeneration) return;
      this.closed = true;
      this.session.status = "idle";
      this.session.updatedAt = now();
      this.bus.emit({ type: "session.updated", session: this.session });
    });
  }

  private async respawnWithFallbackAuth(error: string): Promise<void> {
    if (this.authRetried) return;
    this.authRetried = true;

    const failedMode = this.authMode;
    const nextMode: AuthMode = failedMode === "oauth" ? "apikey" : "oauth";

    if (nextMode === "apikey" && !this.savedApiKey) return;

    lastAuthFailure = { mode: failedMode, time: Date.now(), error };
    console.log(
      `[${this.sessionId}] auth failed (${failedMode}): ${error} — retrying with ${nextMode}`,
    );

    try {
      this.child.kill("SIGTERM");
    } catch {}
    try {
      await this.child.exited;
    } catch {}
    try {
      await this.stdoutTask;
    } catch {}
    try {
      await this.stderrTask;
    } catch {}

    this.closed = false;
    this.authMode = nextMode;
    this.currentMessageId = null;
    this.currentMessage = null;
    this.pendingAuthError = null;
    this.partsByIndex.clear();
    this.toolCallIdByIndex.clear();
    this.toolInputBuffers.clear();

    this.spawnChild();

    this.bus.emit({
      type: "session.error",
      sessionId: this.sessionId,
      error: `Auth fallback: ${failedMode} failed, retrying with ${nextMode}`,
    });
  }

  async sendUserPrompt(text: string, attachments?: Array<{ fileId: string; path: string }>): Promise<void> {
    if (this.closed) return;
    const blocks: UserContentBlock[] = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        try {
          const data = await Bun.file(att.path).arrayBuffer();
          const bytes = new Uint8Array(data);
          const base64 = Buffer.from(bytes).toString("base64");
          let mimeType = "image/png";
          if (att.path.endsWith(".jpg") || att.path.endsWith(".jpeg")) mimeType = "image/jpeg";
          else if (att.path.endsWith(".gif")) mimeType = "image/gif";
          else if (att.path.endsWith(".webp")) mimeType = "image/webp";
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64 },
          });
        } catch (err) {
          console.error(`[${this.sessionId}] failed to load attachment ${att.fileId}:`, err);
        }
      }
    }
    blocks.push({ type: "text", text });
    const line =
      JSON.stringify({
        type: "user",
        message: { role: "user", content: blocks },
      }) + "\n";
    const stdin = this.child.stdin;
    if (!stdin) return;
    stdin.write(this.encoder.encode(line));
    if (typeof stdin.flush === "function") {
      stdin.flush();
    }
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    try {
      this.child.kill("SIGINT");
    } catch {}
    try {
      await this.child.exited;
    } catch {}
    this.closed = true;
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      try {
        await this.stdoutTask;
      } catch {}
      try {
        await this.stderrTask;
      } catch {}
      return;
    }
    try {
      const stdin = this.child.stdin;
      if (stdin) stdin.end();
    } catch {}
    try {
      await this.child.exited;
    } catch {}
    try {
      await this.stdoutTask;
    } catch {}
    try {
      await this.stderrTask;
    } catch {}
    this.closed = true;
  }

  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    const stdout = this.child.stdout as ReadableStream<Uint8Array> | undefined;
    if (!stdout) return;
    const reader = stdout.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = parseLine(line);
          if (event) this.handleStreamJson(event);
        }
      }
      if (buffer.length) {
        const event = parseLine(buffer);
        if (event) this.handleStreamJson(event);
      }
    } catch (err) {
      this.bus.emit({
        type: "session.error",
        sessionId: this.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  private async readStderr(): Promise<void> {
    const decoder = new TextDecoder();
    const stderr = this.child.stderr as ReadableStream<Uint8Array> | undefined;
    if (!stderr) return;
    const reader = stderr.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const msg = decoder.decode(value);
        if (msg.trim()) {
          this.bus.emit({
            type: "session.error",
            sessionId: this.sessionId,
            error: msg.trim(),
          });
        }
      }
    } catch {
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  private handleStreamJson(event: StreamJsonEvent): void {
    switch (event.type) {
      case "system":
        if ((event as { subtype?: string }).subtype === "init") {
          const init = event as unknown as {
            cwd?: string;
            model?: string;
            session_id?: string;
            tools?: unknown;
            mcp_servers?: unknown;
            permissionMode?: unknown;
            slash_commands?: unknown;
            output_style?: unknown;
            agents?: unknown;
            skills?: unknown;
            plugins?: unknown;
            claude_code_version?: unknown;
          };
          if (typeof init.cwd === "string" && init.cwd) {
            this.session.cwd = init.cwd;
            this.session.projectSlug = encodeProjectSlug(init.cwd);
          }
          this.session.metadata = buildMetadataFromInit(init);
          if (this.authMode !== preferredAuthMode) {
            preferredAuthMode = this.authMode;
            console.log(
              `[${this.sessionId}] auth succeeded with ${this.authMode}, updating preferred mode`,
            );
          }
          if (this.session.metadata?.mcpServers) {
            this.mcpServerNames.clear();
            for (const s of this.session.metadata.mcpServers) {
              this.mcpServerNames.add(s.name);
            }
          }
          this.session.status = "live";
          this.session.updatedAt = now();
          this.bus.emit({ type: "session.updated", session: this.session });
        }
        return;
      case "user":
        this.handleUser(event);
        return;
      case "assistant": {
        const ae = event as { error?: string };
        if (ae.error && isAuthError(ae.error)) {
          this.pendingAuthError = ae.error;
        }
        return;
      }
      case "stream_event":
        this.handleStreamEvent(event.event);
        return;
      case "result":
        this.handleResult(event);
        return;
      case "rate_limit_event":
      case "hook_event":
      default:
        return;
    }
  }

  private handleUser(event: Extract<StreamJsonEvent, { type: "user" }>): void {
    const content = event.message.content;
    if (typeof content === "string") {
      const messageId = newMessageId();
      const part: TextPart = {
        id: newPartId(),
        messageId,
        sessionId: this.sessionId,
        type: "text",
        text: content,
        time: { start: now() },
      };
      const message: Message = {
        id: messageId,
        sessionId: this.sessionId,
        role: "user",
        time: { created: now() },
        parts: [part],
      };
      this.bus.emit({
        type: "message.created",
        sessionId: this.sessionId,
        message,
      });
      return;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "tool_result"
        ) {
          const b = block as {
            type: "tool_result";
            tool_use_id: string;
            content: unknown;
            is_error?: boolean;
          };
          const owner = this.toolUseOwners.get(b.tool_use_id);
          if (!owner) continue;
          owner.part.state = b.is_error ? "error" : "completed";
          const isMcp = owner.part.type === "tool_use" && this.mcpServerNames.has(owner.part.tool);
          if (isMcp) {
            const toolName = (owner.part as ToolUsePart).tool;
            const startTime = this.toolStartTimes.get(b.tool_use_id) ?? owner.part.time?.start ?? now();
            const durationMs = now() - startTime;
            this.toolStartTimes.delete(b.tool_use_id);
            recordMcpCall(toolName, durationMs, !!b.is_error);
          }
          owner.part.result = b.content;
          owner.part.resultText = this.toolResultText(b.content);
          if (owner.part.time) owner.part.time.end = now();
          if (owner.part.type === "tool_use" && (owner.part as ToolUsePart).tool === "Task") {
            this.bus.emit({
              type: "task.finished",
              sessionId: this.sessionId,
              partId: owner.part.id,
              toolUseId: b.tool_use_id,
              state: owner.part.state as "completed" | "error",
            });
          }
          this.bus.emit({
            type: "message.part.updated",
            sessionId: this.sessionId,
            messageId: owner.messageId,
            part: owner.part,
          });
        }
      }
    }
  }

  private toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const out: string[] = [];
      for (const b of content) {
        if (b && typeof b === "object") {
          const bb = b as { type?: string; text?: unknown };
          if (bb.type === "text" && typeof bb.text === "string") out.push(bb.text);
        }
      }
      return out.join("\n");
    }
    if (content == null) return "";
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  private handleStreamEvent(event: AnthropicStreamEvent): void {
    switch (event.type) {
      case "message_start": {
        const messageId = newMessageId();
        this.currentMessageId = messageId;
        this.currentMessage = {
          id: messageId,
          sessionId: this.sessionId,
          role: "assistant",
          time: { created: now() },
          parts: [],
        };
        this.partsByIndex.clear();
        this.toolCallIdByIndex.clear();
        this.toolInputBuffers.clear();
        this.bus.emit({
          type: "message.created",
          sessionId: this.sessionId,
          message: this.currentMessage,
        });
        return;
      }
      case "content_block_start": {
        if (!this.currentMessage || !this.currentMessageId) return;
        const block = event.content_block as AssistantContentBlock;
        const part = this.createPartFromBlock(block, this.currentMessageId);
        if (!part) return;
        this.partsByIndex.set(event.index, part);
        this.currentMessage.parts.push(part);
        if (block.type === "tool_use") {
          this.toolCallIdByIndex.set(event.index, block.id);
          this.toolInputBuffers.set(event.index, "");
          this.toolUseOwners.set(block.id, {
            messageId: this.currentMessageId,
            part: part as ToolUsePart,
          });
          const toolName = (block as { name?: string }).name ?? "";
          if (this.mcpServerNames.has(toolName)) {
            this.toolStartTimes.set(block.id, now());
          }
          if (toolName === "Task") {
            const input = block as { input?: unknown };
            const inp = input.input ?? {};
            const subagentType = (inp as { subagent_type?: string }).subagent_type ?? "general-purpose";
            const description = (inp as { description?: string }).description ?? "";
            this.bus.emit({
              type: "task.started",
              sessionId: this.sessionId,
              partId: (part as ToolUsePart).id,
              toolUseId: block.id,
              subagentType,
              description,
            });
          }
        }
        this.bus.emit({
          type: "message.part.updated",
          sessionId: this.sessionId,
          messageId: this.currentMessageId,
          part,
        });
        return;
      }
      case "content_block_delta": {
        if (!this.currentMessageId) return;
        const part = this.partsByIndex.get(event.index);
        if (!part) return;
        const delta = event.delta;
        if (delta.type === "text_delta" && part.type === "text") {
          part.text += delta.text;
          this.bus.emit({
            type: "message.part.delta",
            sessionId: this.sessionId,
            messageId: this.currentMessageId,
            partId: part.id,
            delta: delta.text,
          });
        } else if (delta.type === "thinking_delta" && part.type === "thinking") {
          part.text += delta.thinking;
          this.bus.emit({
            type: "message.part.delta",
            sessionId: this.sessionId,
            messageId: this.currentMessageId,
            partId: part.id,
            delta: delta.thinking,
          });
        } else if (delta.type === "input_json_delta") {
          const prev = this.toolInputBuffers.get(event.index) ?? "";
          this.toolInputBuffers.set(event.index, prev + delta.partial_json);
        }
        return;
      }
      case "content_block_stop": {
        if (!this.currentMessageId) return;
        const part = this.partsByIndex.get(event.index);
        if (!part) return;
        if (part.type === "tool_use") {
          const buf = this.toolInputBuffers.get(event.index) ?? "";
          if (buf.length > 0) {
            try {
              part.input = JSON.parse(buf);
            } catch {
              part.input = { _raw: buf };
            }
          }
        }
        if (part.time) part.time.end = now();
        this.bus.emit({
          type: "message.part.completed",
          sessionId: this.sessionId,
          messageId: this.currentMessageId,
          partId: part.id,
        });
        this.bus.emit({
          type: "message.part.updated",
          sessionId: this.sessionId,
          messageId: this.currentMessageId,
          part,
        });
        return;
      }
      case "message_delta":
      case "message_stop": {
        if (this.currentMessage) {
          this.currentMessage.time.updated = now();
        }
        return;
      }
    }
  }

  private createPartFromBlock(
    block: AssistantContentBlock,
    messageId: string,
  ): Part | null {
    const partId = newPartId();
    const time = { start: now() };
    switch (block.type) {
      case "text": {
        const p: TextPart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "text",
          text: block.text ?? "",
          time,
        };
        return p;
      }
      case "thinking": {
        const p: ThinkingPart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "thinking",
          text: block.thinking ?? "",
          time,
        };
        return p;
      }
      case "tool_use": {
        const p: ToolUsePart = {
          id: partId,
          messageId,
          sessionId: this.sessionId,
          type: "tool_use",
          tool: block.name,
          input: block.input ?? {},
          state: "running",
          time,
        };
        return p;
      }
      case "tool_result":
        return null;
    }
  }

  private handleResult(
    event: Extract<StreamJsonEvent, { type: "result" }>,
  ): void {
    const errorText = event.result ?? "";
    const isAuthFail =
      (event.is_error && isAuthError(errorText)) || !!this.pendingAuthError;

    if (isAuthFail && !this.authRetried) {
      const reason = this.pendingAuthError ?? errorText;
      this.respawnWithFallbackAuth(reason);
      return;
    }

    const messageId = this.currentMessageId ?? newMessageId();
    const result: ResultPart = {
      id: newPartId(),
      messageId,
      sessionId: this.sessionId,
      type: "result",
      subtype: event.subtype,
      costUsd: event.total_cost_usd,
      durationMs: event.duration_ms,
      usage: event.usage,
      time: { start: now() },
    };
    this.session.updatedAt = now();
    this.session.lastMessageAt = now();
    this.bus.emit({
      type: "session.idle",
      sessionId: this.sessionId,
      result,
    });
  }
}
