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
      "List all Claude Code projects with their slugs and session counts. Returns an array of {slug, path, sessionCount, repoName?, worktreeLabel?}. Use the slug value from results as input to list_sessions, create_session, and get_project_memory.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_sessions",
    description:
      "List all sessions for a project by its slug. Returns an array of {id, projectSlug, title, cwd, createdAt, updatedAt, status, lastMessageAt, metadata?}. Status is 'live' (owned process), 'mirror' (externally owned, read-only), or 'idle' (archived, safe to resume). Use session id values as input to get_session, send_prompt, abort_session, dispose_session, and fork_session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "Project slug from list_projects results",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_session",
    description:
      "Get full session details including all messages, parts, metadata, channel status, and current status. Returns {session: {id, slug, status, metadata, channel}, messages: Message[]}. Each message has role (user/assistant/system) and parts (text, thinking, tool_use, tool_result). Use after send_and_wait or poll_events to read the full conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID from list_sessions" },
        slug: { type: "string", description: "Project slug from list_projects" },
      },
      required: ["session_id", "slug"],
    },
  },
  {
    name: "create_session",
    description:
      "Create a new live Claude Code session in a project. Spawns a claude CLI subprocess. Returns {sessionId, cwd}. Each new session costs ~$0.10 in context cache warm-up. Prefer resuming idle sessions with send_prompt when prior context is useful. Use Sonnet for routine file ops/edits/git; reserve Opus for complex multi-step reasoning.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Project slug from list_projects" },
        cwd: {
          type: "string",
          description: "Working directory for the session (absolute path)",
        },
        model: {
          type: "string",
          description: "Model to use (e.g. claude-sonnet-4-20250514). Defaults to the CLI default.",
        },
        permission_mode: {
          type: "string",
          description:
            "Permission mode: default, auto, bypassPermissions, plan, acceptEdits, dontAsk",
        },
      },
      required: ["slug", "cwd"],
    },
  },
  {
    name: "send_prompt",
    description:
      "Send a user prompt to a session. Returns {ok: true, via: 'channel'|'resume'} with status 202. The response streams asynchronously — use poll_events to watch for events, then check for a session.idle event to know the turn is complete. For a blocking alternative, use send_and_wait. Idle sessions are auto-resumed; mirror sessions are injected via channel if available.",
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
          description: "Project slug (alternative to cwd for path resolution)",
        },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "send_and_wait",
    description:
      "Send a prompt and block until the session goes idle, returning the assistant response. Combines send_prompt + poll_events + get_session into a single call. Returns {ok: true, via: 'channel'|'resume', messages: Message[], timedOut?: boolean}. Use this for simple request/response interactions. For streaming or monitoring intermediate events, use send_prompt + poll_events instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        text: { type: "string", description: "The prompt text to send" },
        slug: {
          type: "string",
          description: "Project slug (used for cwd resolution and session read)",
        },
        cwd: {
          type: "string",
          description: "Working directory (alternative to slug)",
        },
        timeout_ms: {
          type: "number",
          description: "Max wait time in ms (default 120000 / 2 minutes)",
        },
      },
      required: ["session_id", "text", "slug"],
    },
  },
  {
    name: "abort_session",
    description:
      "Abort the currently running turn in a session. Only works on live sessions. Returns 204 on success. Use when a session is taking too long or headed in the wrong direction.",
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
    description:
      "Kill and dispose a live session process. The JSONL file is retained on disk. Returns 204 on success. Use to free resources when done with a session.",
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
      "Fork an existing session to create a new branch of the conversation. Returns {sessionId, forkedFrom}. Use to try alternative approaches without losing the original conversation.",
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
      "Respond to a tool permission request from a channel session (allow or deny). Returns {ok: true} on success. Only works for sessions connected via the channel plugin. Permission requests appear as permission_request events in poll_events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session UUID" },
        request_id: {
          type: "string",
          description: "Permission request ID from the permission_request event",
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
    description:
      "Read the ~/.claude/projects/<slug>/memory/ files for a project. Returns an array of {filename, content}. Returns an empty array if no memory files exist. These are Claude Code's auto-memory files, not CodeZ's application state (use get_state for that).",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Project slug from list_projects" },
      },
      required: ["slug"],
    },
  },
  {
    name: "search_sessions",
    description:
      "Full-text search across all session content (user and assistant messages). Returns up to 20 matches sorted by recency, each with {sessionId, slug, title, snippet, updatedAt}. Query must be at least 2 characters.",
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
      "Poll for real-time SSE events from CodeZ. Returns buffered events since last poll. Key event types: message.created (new message), message.updated (streaming delta), session.idle (turn complete — assistant is done), session.error, task.started/task.finished (subagent lifecycle), permission_request (needs respond_permission). Workflow: send_prompt -> poll_events in a loop -> stop when you see session.idle.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "Filter events to this session only (recommended)",
        },
        timeout_ms: {
          type: "number",
          description:
            "Max wait time in ms if no events buffered (default 5000, max 30000)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_health",
    description:
      "Check CodeZ server health. Returns {ok: true, uptime, sessions, version}. Use as a connectivity check before other operations.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_health_details",
    description:
      "Get detailed health info including self-heal log, subsystem status (sessions, bridges, auth), and recent reconciliation actions. Returns {status: SubsystemStatus[], log: SelfHealLogEntry[]}. Use for debugging connectivity or session lifecycle issues.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_state",
    description:
      "Get CodeZ application state. Returns {markers: Record<sessionId, Marker[]>, preferences: Record<string, unknown>, recentCwds: string[]}. Markers have {id, sessionId, messageId, label?, note?, createdAt, resolved?}. This is CodeZ's own state, not Claude Code's auto-memory (use get_project_memory for that).",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "update_state",
    description:
      "Update CodeZ application state via shallow merge. Pass only the fields to update. Example: {markers: {<sessionId>: [...]}} merges into existing markers. Preferences and recentCwds work the same way.",
    inputSchema: {
      type: "object" as const,
      properties: {
        patch: {
          type: "object",
          description:
            "State fields to merge: markers (Record<sessionId, Marker[]>), preferences (Record<string, unknown>), recentCwds (string[])",
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "get_observability",
    description:
      "Get usage and cost statistics across all projects and sessions. Returns daily snapshots with totalCost, totalSessions, totalInputTokens, totalOutputTokens. Use to monitor spend and identify heavy sessions.",
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
    case "send_and_wait": {
      const sendResult = await client.sendPrompt(args.session_id as string, {
        text: args.text as string,
        cwd: args.cwd as string | undefined,
        slug: args.slug as string | undefined,
      });
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 120000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = Math.min(deadline - Date.now(), 10000);
        if (remaining <= 0) break;
        const events = await poller.poll(args.session_id as string, remaining);
        const idle = events.find((e: any) => e.type === "session.idle" || e.type === "session.error");
        if (idle) break;
      }
      const slug = args.slug as string;
      const session = await client.getSession(args.session_id as string, slug);
      const timedOut = Date.now() >= deadline;
      return { ...sendResult, messages: session.messages, timedOut };
    }
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
