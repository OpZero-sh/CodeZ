import type { EventBus } from "../bus";
import type { SSEEvent } from "../types";

/**
 * Provider-agnostic agent-session seam.
 *
 * CodeZero currently drives exactly one backend: the `claude` CLI in
 * stream-json duplex mode (`server/claude/process.ts::SessionProcess`). This
 * interface names the five capabilities that backend exposes so a second
 * backend — a Codex adapter, a remote hub-driven agent, a mock for tests —
 * can drop in behind the same contract without the pool, routes, or SSE layer
 * having to know which provider answered.
 *
 * The five capabilities, mapped to the existing Claude-Code implementation:
 *   1. spawn       — `new SessionProcess(opts, bus)` boots the child process
 *   2. prompt      — `SessionProcess.sendUserPrompt(text, attachments)`
 *   3. stream      — emits `SSEEvent`s into the `EventBus` (no per-adapter API)
 *   4. permissions — `channel.permission_request` events + a verdict callback
 *                    (see `server/routes/sessions.ts` permission relay)
 *   5. abort       — `SessionProcess.abort()` / `SessionProcess.dispose()`
 *
 * This is ADDITIVE: it does not replace `SessionProcess`. It describes the
 * shape the working Claude-Code path already satisfies (see
 * `server/agent/claude-adapter.ts`), so future work can program against the
 * interface instead of the concrete class.
 */

export type AgentProvider = "claude-code" | "codex" | string;

/** Permission decision for a tool the agent wants to run. */
export type PermissionBehavior = "allow" | "deny";

/**
 * A pending permission request surfaced by the agent. Mirrors the
 * `channel.permission_request` SSE event payload so the two stay interchangeable.
 */
export interface AgentPermissionRequest {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

/** Verdict an adapter relays back to the agent for a pending request. */
export interface AgentPermissionVerdict {
  requestId: string;
  behavior: PermissionBehavior;
}

/** Image / file blocks attached to a prompt turn. Provider-neutral. */
export interface AgentPromptAttachment {
  fileId: string;
  path: string;
}

/**
 * Options for spawning an agent session. Superset-shaped: every field the
 * Claude-Code path accepts (`SessionProcessOptions`) plus a `provider`
 * discriminator so the pool can pick an adapter factory. Adapters ignore
 * fields they don't understand.
 */
export interface AgentSpawnOptions {
  provider?: AgentProvider;
  sessionId: string;
  cwd: string;
  model?: string;
  /** Provider-specific permission mode string (e.g. Claude's `PermissionMode`). */
  permissionMode?: string;
  resume?: boolean;
  forkFrom?: string;
}

/**
 * The seam a future Codex adapter implements and that `SessionProcess`
 * already nominally satisfies. Each method is one of the five capabilities;
 * `stream` is implicit — adapters emit `SSEEvent`s into the `EventBus` they
 * were constructed with, so consumers subscribe once and never branch on
 * provider.
 */
export interface AgentSessionAdapter {
  /** Stable id this adapter session is keyed by in the pool. */
  readonly sessionId: string;
  /** Working directory the agent runs in. */
  readonly cwd: string;
  /** Model identifier, if the provider exposes one. */
  readonly model?: string;
  /** Which backend answers for this session. */
  readonly provider: AgentProvider;

  /** (2) Send a user turn. Attachments are optional image/file blocks. */
  sendUserPrompt(
    text: string,
    attachments?: AgentPromptAttachment[],
  ): Promise<void>;

  /** (4) Relay a permission verdict for a pending tool request. */
  respondPermission?(verdict: AgentPermissionVerdict): Promise<void>;

  /** (5) Interrupt the current turn without tearing the session down. */
  abort(): Promise<void>;

  /** (5) Tear the session down and release the underlying process/connection. */
  dispose(): Promise<void>;
}

/**
 * (1) Spawn capability. A provider registers a factory; the pool calls it to
 * mint an adapter. The adapter wires its own `stream` into `bus` — that's why
 * `bus` is passed at construction rather than returned per-event.
 */
export type AgentSessionFactory = (
  opts: AgentSpawnOptions,
  bus: EventBus,
) => AgentSessionAdapter;

/** Narrow an arbitrary `SSEEvent` to a permission request, for adapters/UI. */
export function isPermissionRequestEvent(
  event: SSEEvent,
): event is Extract<SSEEvent, { type: "channel.permission_request" }> {
  return event.type === "channel.permission_request";
}
