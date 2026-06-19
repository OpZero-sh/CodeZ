import type {
  Message,
  Part,
  ResultPart,
  SessionMetadata,
  SSEEvent,
  Usage,
} from "../types";
import type { AgentProvider } from "./adapter";

/**
 * Provider-agnostic event / transcript schema.
 *
 * The live stream today is `SSEEvent` (`server/types.ts`) and the persisted
 * conversation is `Message[]` made of `Part`s. Both are Claude-Code-shaped:
 * the SSE union name-checks `channel.permission_request`, `task.*`, and
 * `mcp.tool_call.*`; `Part` mirrors Anthropic content blocks. That coupling
 * is fine for one backend, but UAT verification (replaying a run and asserting
 * on it) and token-5-0 vaulting (archiving a run's token/cost ledger) need a
 * shape that does not assume the producer was Claude Code.
 *
 * This file defines that shape as a STRICT SUPERSET of the existing types:
 * every normalized record carries `provider` + `sessionId` + `seq` + `at`,
 * and the payload variants are the existing `Part` / `ResultPart` / `Usage` /
 * permission shapes re-exported verbatim — not re-guessed. A Claude-Code run
 * maps onto this losslessly (see `normalizeFromSse`'s field list); a future
 * Codex run fills the same envelope. Additive: nothing here is wired into the
 * bus yet.
 */

/** Discriminator for every normalized record kind. */
export type AgentEventKind =
  | "session.started"
  | "session.idle"
  | "session.error"
  | "message"
  | "part"
  | "permission.request"
  | "permission.resolved"
  | "task.started"
  | "task.finished"
  | "result";

/**
 * Envelope every normalized event carries. `seq` gives a total order within a
 * session (the existing SSE stream has none — it relies on arrival order),
 * which is what a replay/verification pass and a vault archive both need.
 */
export interface AgentEventEnvelope {
  provider: AgentProvider;
  sessionId: string;
  /** Monotonic per-session sequence number; assigned at normalization time. */
  seq: number;
  /** epoch ms the event was observed. */
  at: number;
  kind: AgentEventKind;
}

/** Permission request, lifted from the `channel.permission_request` payload. */
export interface AgentPermissionRequestEvent extends AgentEventEnvelope {
  kind: "permission.request";
  request: {
    requestId: string;
    toolName: string;
    description: string;
    inputPreview: string;
  };
}

export interface AgentPermissionResolvedEvent extends AgentEventEnvelope {
  kind: "permission.resolved";
  requestId: string;
}

/** A subagent (Task tool) lifecycle pair, generalized off the `task.*` SSE events. */
export interface AgentTaskStartedEvent extends AgentEventEnvelope {
  kind: "task.started";
  partId: string;
  toolUseId: string;
  subagentType: string;
  description: string;
}

export interface AgentTaskFinishedEvent extends AgentEventEnvelope {
  kind: "task.finished";
  partId: string;
  toolUseId: string;
  state: "completed" | "error";
}

/** A whole assistant/user/system message, reusing the existing `Message`. */
export interface AgentMessageEvent extends AgentEventEnvelope {
  kind: "message";
  message: Message;
}

/** A single content part update, reusing the existing `Part` union. */
export interface AgentPartEvent extends AgentEventEnvelope {
  kind: "part";
  messageId: string;
  part: Part;
}

export interface AgentSessionStartedEvent extends AgentEventEnvelope {
  kind: "session.started";
  cwd: string;
  metadata?: SessionMetadata;
}

export interface AgentSessionIdleEvent extends AgentEventEnvelope {
  kind: "session.idle";
  result?: ResultPart;
}

export interface AgentSessionErrorEvent extends AgentEventEnvelope {
  kind: "session.error";
  error: string;
}

/** Terminal turn result, reusing `ResultPart`'s cost/usage fields. */
export interface AgentResultEvent extends AgentEventEnvelope {
  kind: "result";
  subtype: "success" | "error";
  costUsd?: number;
  durationMs?: number;
  usage?: Usage;
}

/** The normalized event union UAT verification + vaulting consume. */
export type AgentEvent =
  | AgentSessionStartedEvent
  | AgentSessionIdleEvent
  | AgentSessionErrorEvent
  | AgentMessageEvent
  | AgentPartEvent
  | AgentPermissionRequestEvent
  | AgentPermissionResolvedEvent
  | AgentTaskStartedEvent
  | AgentTaskFinishedEvent
  | AgentResultEvent;

/**
 * A complete, provider-agnostic transcript of one session — the unit a
 * verification pass replays and a vault archives. `metadata` reuses the
 * existing `SessionMetadata`; `tokenLedger` is the rolled-up `Usage` totals
 * the token-5-0 vaulting feature would persist.
 */
export interface AgentTranscript {
  provider: AgentProvider;
  sessionId: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  metadata?: SessionMetadata;
  events: AgentEvent[];
  /** Aggregate token/cost ledger across all `result` events. */
  tokenLedger: AgentTokenLedger;
}

/**
 * Superset of `Usage` plus cost, summed over a run. This is the shape the
 * token-5-0 vault stores per session.
 */
export interface AgentTokenLedger {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

export function emptyTokenLedger(): AgentTokenLedger {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCostUsd: 0,
  };
}

/** Fold a `result` event's usage/cost into a running ledger. */
export function accumulateLedger(
  ledger: AgentTokenLedger,
  result: AgentResultEvent,
): AgentTokenLedger {
  const u = result.usage;
  return {
    inputTokens: ledger.inputTokens + (u?.input_tokens ?? 0),
    outputTokens: ledger.outputTokens + (u?.output_tokens ?? 0),
    cacheCreationInputTokens:
      ledger.cacheCreationInputTokens + (u?.cache_creation_input_tokens ?? 0),
    cacheReadInputTokens:
      ledger.cacheReadInputTokens + (u?.cache_read_input_tokens ?? 0),
    totalCostUsd: ledger.totalCostUsd + (result.costUsd ?? 0),
  };
}

/**
 * Lift one live `SSEEvent` into the normalized `AgentEvent` schema, proving
 * the schema is a true superset of today's Claude-Code stream rather than a
 * parallel guess. The caller owns ordering (`seq`) and the clock (`at`) so the
 * same record can be replayed deterministically by a verification pass.
 *
 * SSE variants with no transcript meaning (`server.connected`, the bus-only
 * `session.created`/`session.updated`, the per-token `message.part.delta` /
 * `message.part.completed`, and the cross-cutting `mcp.tool_call.*` telemetry)
 * return `null` — they are stream plumbing, not transcript content.
 */
export function normalizeFromSse(
  event: SSEEvent,
  ctx: { provider: AgentProvider; seq: number; at: number },
): AgentEvent | null {
  const base = { provider: ctx.provider, seq: ctx.seq, at: ctx.at };
  switch (event.type) {
    case "session.idle":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "session.idle",
        result: event.result,
      };
    case "session.error":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "session.error",
        error: event.error,
      };
    case "message.created":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "message",
        message: event.message,
      };
    case "message.part.updated":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "part",
        messageId: event.messageId,
        part: event.part,
      };
    case "channel.permission_request":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "permission.request",
        request: event.request,
      };
    case "channel.permission_resolved":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "permission.resolved",
        requestId: event.requestId,
      };
    case "task.started":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "task.started",
        partId: event.partId,
        toolUseId: event.toolUseId,
        subagentType: event.subagentType,
        description: event.description,
      };
    case "task.finished":
      return {
        ...base,
        sessionId: event.sessionId,
        kind: "task.finished",
        partId: event.partId,
        toolUseId: event.toolUseId,
        state: event.state,
      };
    default:
      return null;
  }
}
