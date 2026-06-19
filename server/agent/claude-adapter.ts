import type { SessionProcess } from "../claude/process";
import type { AgentSessionAdapter, AgentProvider } from "./adapter";

/**
 * Compile-time evidence that the working Claude-Code session driver
 * (`server/claude/process.ts::SessionProcess`) already implements the
 * capability surface of `AgentSessionAdapter`, without touching that class.
 *
 * `SessionProcess` predates the adapter seam, so it carries no `provider`
 * discriminator and exposes `sendUserPrompt` / `abort` / `dispose` directly.
 * The remaining gap is purely nominal: pair the concrete driver with a
 * provider tag and it satisfies the interface. This file asserts that and
 * does nothing at runtime — it is the "Claude-Code path nominally satisfies
 * the interface" checkpoint for the D1 seam.
 */

export const CLAUDE_CODE_PROVIDER: AgentProvider = "claude-code";

/**
 * The slice of `AgentSessionAdapter` that `SessionProcess` already provides
 * 1:1 (every capability except the `provider` tag, which `SessionProcess`
 * does not carry). Kept as a type-level assertion so a future refactor that
 * breaks the shared shape fails `tsc` here instead of silently.
 */
type ClaudeAdapterSurface = Pick<
  AgentSessionAdapter,
  "sessionId" | "cwd" | "model" | "sendUserPrompt" | "abort" | "dispose"
>;

type AssertAssignable<T extends U, U> = T;

/**
 * If `SessionProcess` ever stops matching the adapter's core capability
 * surface, this alias stops type-checking. Pure compile-time guard.
 */
export type ClaudeProcessIsAdapterCompatible = AssertAssignable<
  SessionProcess,
  ClaudeAdapterSurface
>;

/**
 * Wrap a live `SessionProcess` as a full `AgentSessionAdapter` by attaching
 * the `provider` tag. Additive helper — call sites that want the
 * provider-agnostic type can adopt it incrementally; existing pool/route code
 * keeps using `SessionProcess` directly and is unaffected.
 */
export function asAgentSessionAdapter(
  proc: SessionProcess,
): AgentSessionAdapter {
  return {
    sessionId: proc.sessionId,
    cwd: proc.cwd,
    model: proc.model,
    provider: CLAUDE_CODE_PROVIDER,
    sendUserPrompt: (text, attachments) =>
      proc.sendUserPrompt(text, attachments),
    abort: () => proc.abort(),
    dispose: () => proc.dispose(),
  };
}
