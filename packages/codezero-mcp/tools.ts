import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CodeZClient } from "./client.ts";
import type { EventPoller } from "./events.ts";

export interface ToolCallEvent {
  callId: string;
  tool: string;
  phase: "started" | "finished";
  durationMs?: number;
  isError?: boolean;
  sessionId?: string;
}

const TOOLS = [
  {
    name: "list_projects",
    description:
      "List all Claude Code projects with their slugs and session counts",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_sessions",
    description: "List all sessions for a project by its slug",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "Project slug (URL-encoded path)",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_session",
    description:
      "Get full session details including all messages and parts",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        slug: { type: "string", description: "Project slug" },
      },
      required: ["session_id", "slug"],
    },
  },
  {
    name: "create_session",
    description: "Create a new live Claude Code session in a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Project slug" },
        cwd: {
          type: "string",
          description: "Working directory for the session",
        },
        model: {
          type: "string",
          description: "Model to use (e.g. claude-sonnet-4-20250514)",
        },
        permission_mode: {
          type: "string",
          description:
            "Permission mode: default, auto, bypassPermissions, plan",
        },
      },
      required: ["slug", "cwd"],
    },
  },
  {
    name: "send_prompt",
    description:
      "Send a user prompt to a session. Resumes idle sessions or injects via channel for mirror sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        text: { type: "string", description: "The prompt text to send" },
        cwd: {
          type: "string",
          description: "Working directory (required if no slug)",
        },
        slug: {
          type: "string",
          description: "Project slug (alternative to cwd)",
        },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "abort_session",
    description: "Abort the currently running turn in a session",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "dispose_session",
    description: "Kill and dispose a live session process",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "fork_session",
    description:
      "Fork an existing session to create a new branch of the conversation",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "Session UUID to fork from",
        },
        slug: {
          type: "string",
          description: "Project slug for the forked session",
        },
      },
      required: ["session_id", "slug"],
    },
  },
  {
    name: "respond_permission",
    description:
      "Respond to a tool permission request from a channel session (allow or deny)",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        request_id: {
          type: "string",
          description: "Permission request ID",
        },
        behavior: {
          type: "string",
          enum: ["allow", "deny"],
          description: "Allow or deny the tool use",
        },
      },
      required: ["session_id", "request_id", "behavior"],
    },
  },
  {
    name: "get_project_memory",
    description: "Read the .claude/ memory files for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Project slug" },
      },
      required: ["slug"],
    },
  },
  {
    name: "search_sessions",
    description: "Full-text search across all session content",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (min 2 chars)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "poll_events",
    description:
      "Poll for real-time SSE events from CodeZ. Returns buffered events since last poll. Use to monitor session activity, message streaming, and task progress.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "Filter events to this session only",
        },
        timeout_ms: {
          type: "number",
          description:
            "Max wait time in ms if no events buffered (default 5000)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_health",
    description: "Check CodeZ server health",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_health_details",
    description:
      "Get detailed health info including self-heal log and subsystem status",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_state",
    description:
      "Get CodeZ application state (markers, preferences, recent cwds)",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "update_state",
    description:
      "Update CodeZ application state (merge markers, preferences)",
    inputSchema: {
      type: "object" as const,
      properties: {
        patch: {
          type: "object",
          description:
            "State fields to merge (markers, preferences, recentCwds)",
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "get_observability",
    description:
      "Get usage and cost statistics across all projects and sessions",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  client: CodeZClient,
  poller: EventPoller,
): Promise<unknown> {
  switch (name) {
    case "list_projects":
      return client.listProjects();
    case "list_sessions":
      return client.listSessions(args.slug as string);
    case "get_session":
      return client.getSession(
        args.session_id as string,
        args.slug as string,
      );
    case "create_session":
      return client.createSession(args.slug as string, {
        cwd: args.cwd as string,
        model: args.model as string | undefined,
        permissionMode: args.permission_mode as string | undefined,
      });
    case "send_prompt":
      return client.sendPrompt(args.session_id as string, {
        text: args.text as string,
        cwd: args.cwd as string | undefined,
        slug: args.slug as string | undefined,
      });
    case "abort_session":
      return client.abortSession(args.session_id as string);
    case "dispose_session":
      return client.disposeSession(args.session_id as string);
    case "fork_session":
      return client.forkSession(args.session_id as string, {
        slug: args.slug as string,
      });
    case "respond_permission":
      return client.respondPermission(args.session_id as string, {
        request_id: args.request_id as string,
        behavior: args.behavior as "allow" | "deny",
      });
    case "get_project_memory":
      return client.getProjectMemory(args.slug as string);
    case "search_sessions":
      return client.search(args.query as string);
    case "poll_events":
      return poller.poll(
        args.session_id as string | undefined,
        typeof args.timeout_ms === "number" ? args.timeout_ms : undefined,
      );
    case "get_health":
      return client.getHealth();
    case "get_health_details":
      return client.getHealthDetails();
    case "get_state":
      return client.getState();
    case "update_state":
      return client.updateState(args.patch as Record<string, unknown>);
    case "get_observability":
      return client.getObservability();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function registerTools(
  server: Server,
  client: CodeZClient,
  poller: EventPoller,
  onToolCall?: (event: ToolCallEvent) => void,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const callId = crypto.randomUUID();
    const sessionId = (args?.session_id as string) || undefined;
    const startedAt = Date.now();

    onToolCall?.({ callId, tool: name, phase: "started", sessionId });

    try {
      const result = await dispatch(name, args ?? {}, client, poller);
      onToolCall?.({
        callId,
        tool: name,
        phase: "finished",
        durationMs: Date.now() - startedAt,
        isError: false,
        sessionId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      onToolCall?.({
        callId,
        tool: name,
        phase: "finished",
        durationMs: Date.now() - startedAt,
        isError: true,
        sessionId,
      });
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  });
}
