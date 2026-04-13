export interface Project {
  slug: string;
  path: string;
  sessionCount: number;
  repoName?: string;
  worktreeLabel?: string;
}

export interface SessionMetadata {
  model?: string;
  permissionMode?: string;
  outputStyle?: string;
  tools?: string[];
  agents?: string[];
  skills?: string[];
  slashCommands?: string[];
  plugins?: string[];
  mcpServers?: Array<{ name: string; status: string }>;
  claudeCodeVersion?: string;
}

export type SessionStatus = "live" | "mirror" | "idle";

export interface ChannelInfo {
  present: boolean;
  port?: number;
  pid?: number;
}

export interface Session {
  id: string;
  projectSlug: string;
  title?: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  lastMessageAt?: number;
  metadata?: SessionMetadata;
  channel?: ChannelInfo;
}

export type PartType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "system"
  | "result";

export interface BasePart {
  id: string;
  messageId: string;
  sessionId: string;
  type: PartType;
  time?: { start: number; end?: number };
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ThinkingPart extends BasePart {
  type: "thinking";
  text: string;
}

export interface ToolUsePart extends BasePart {
  type: "tool_use";
  tool: string;
  input: any;
  state: "running" | "completed" | "error";
  result?: any;
  resultText?: string;
}

export interface ToolResultPart extends BasePart {
  type: "tool_result";
  toolUseId: string;
  content: any;
  isError?: boolean;
}

export interface SystemPart extends BasePart {
  type: "system";
  subtype: string;
  data: any;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ResultPart extends BasePart {
  type: "result";
  subtype: "success" | "error";
  costUsd?: number;
  durationMs?: number;
  usage?: Usage;
}

export type Part =
  | TextPart
  | ThinkingPart
  | ToolUsePart
  | ToolResultPart
  | SystemPart
  | ResultPart;

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  model?: string;
  time: { created: number; updated?: number };
  parts: Part[];
}

export type SSEEvent =
  | { type: "server.connected" }
  | { type: "session.created"; session: Session }
  | { type: "session.updated"; session: Session }
  | { type: "session.idle"; sessionId: string; result?: ResultPart }
  | { type: "session.error"; sessionId: string; error: string }
  | { type: "message.created"; sessionId: string; message: Message }
  | {
      type: "message.part.updated";
      sessionId: string;
      messageId: string;
      part: Part;
    }
  | {
      type: "message.part.delta";
      sessionId: string;
      messageId: string;
      partId: string;
      delta: string;
    }
  | {
      type: "message.part.completed";
      sessionId: string;
      messageId: string;
      partId: string;
    }
  | {
      type: "channel.permission_request";
      sessionId: string;
      request: {
        requestId: string;
        toolName: string;
        description: string;
        inputPreview: string;
      };
    }
  | {
      type: "channel.permission_resolved";
      sessionId: string;
      requestId: string;
    }
  | {
      type: "task.started";
      sessionId: string;
      partId: string;
      toolUseId: string;
      subagentType: string;
      description: string;
    }
  | {
      type: "task.finished";
      sessionId: string;
      partId: string;
      toolUseId: string;
      state: "completed" | "error";
    }
  | {
      type: "mcp.tool_call.started";
      callId: string;
      tool: string;
      clientId: string;
      sessionId?: string;
      startedAt: number;
    }
  | {
      type: "mcp.tool_call.finished";
      callId: string;
      tool: string;
      clientId: string;
      sessionId?: string;
      durationMs: number;
      isError: boolean;
    };

export interface RunningTask {
  partId: string;
  toolUseId: string;
  sessionId: string;
  subagentType: string;
  description: string;
  startedAt: number;
  state: "running" | "completed" | "error";
}

export interface McpToolCall {
  callId: string;
  tool: string;
  clientId: string;
  sessionId?: string;
  startedAt: number;
  state: "running" | "completed" | "error";
  durationMs?: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
  receivedAt: number;
}

export interface Marker {
  id: string;
  sessionId: string;
  messageId: string;
  partId?: string;
  label?: string;
  note?: string;
  createdAt: number;
  resolved?: boolean;
}
