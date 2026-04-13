export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  cwd: string;
  model: string;
  tools?: string[];
  permissionMode?: string;
  agents?: unknown;
  skills?: unknown;
  mcp_servers?: unknown;
  claude_code_version?: string;
  output_style?: string;
  uuid?: string;
}

export interface SystemOtherEvent {
  type: "system";
  subtype: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface UserStreamEvent {
  type: "user";
  message: {
    role: "user";
    content: string | UserContentBlock[];
  };
  session_id: string;
  isReplay?: boolean;
  timestamp?: string;
  uuid?: string;
}

export type UserContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

export interface AssistantEvent {
  type: "assistant";
  message: AssistantMessage;
  session_id: string;
  uuid?: string;
  timestamp?: string;
  error?: string;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  model: string;
  content: AssistantContentBlock[];
  usage?: unknown;
  stop_reason?: string | null;
}

export type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

export interface StreamEventEnvelope {
  type: "stream_event";
  event: AnthropicStreamEvent;
  session_id: string;
  uuid?: string;
}

export type AnthropicStreamEvent =
  | { type: "message_start"; message: unknown }
  | {
      type: "content_block_start";
      index: number;
      content_block: AssistantContentBlock;
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "signature_delta"; signature: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | {
      type: "message_delta";
      delta: { stop_reason?: string; [k: string]: unknown };
      usage?: unknown;
    }
  | { type: "message_stop" };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ResultEvent {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  duration_ms: number;
  duration_api_ms?: number;
  num_turns: number;
  result?: string;
  stop_reason?: string;
  session_id: string;
  total_cost_usd?: number;
  usage?: Usage;
}

export interface RateLimitEvent {
  type: "rate_limit_event";
  rate_limit_info: unknown;
}

export interface HookEvent {
  type: "hook_event";
  [key: string]: unknown;
}

export type StreamJsonEvent =
  | SystemInitEvent
  | SystemOtherEvent
  | UserStreamEvent
  | AssistantEvent
  | StreamEventEnvelope
  | ResultEvent
  | RateLimitEvent
  | HookEvent;

export function parseLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as StreamJsonEvent;
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
