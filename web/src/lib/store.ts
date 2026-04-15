import { useSyncExternalStore } from "react";
import { api } from "./api";
import {
  applyDelta,
  applyMessageCreated,
  applyPartUpdate,
} from "./parts";
import type {
  Message,
  PermissionRequest,
  Project,
  ResultPart,
  SSEEvent,
  Session,
  Marker,
  McpToolCall,
  RunningTask,
} from "./types";

export interface UsageTotal {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  totalDurationMs: number;
}

export type SidebarSort = "recent" | "status" | "name";

export interface StoreState {
  projects: Project[];
  sessionsByProject: Record<string, Session[]>;
  selected: { slug: string | null; sessionId: string | null };
  messages: Record<string, Message[]>;
  sending: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  connected: boolean;
  projectsLoaded: boolean;
  permissionRequests: Record<string, PermissionRequest[]>;
  usageTotals: Record<string, UsageTotal>;
  markers: Record<string, Marker[]>;
  runningTasks: RunningTask[];
  mcpCalls: McpToolCall[];
  sidebarSort: SidebarSort;
  hideEmptyProjects: boolean;
}

type Listener = () => void;

let state: StoreState = {
  projects: [],
  sessionsByProject: {},
  selected: { slug: null, sessionId: null },
  messages: {},
  sending: {},
  errors: {},
  connected: false,
  projectsLoaded: false,
  permissionRequests: {},
  usageTotals: {},
  markers: {},
  runningTasks: [],
  mcpCalls: [],
  sidebarSort: "recent",
  hideEmptyProjects: true,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): StoreState {
  return state;
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  emit();
}

function upsertSessionIn(
  map: Record<string, Session[]>,
  session: Session,
): Record<string, Session[]> {
  const list = map[session.projectSlug] ?? [];
  const idx = list.findIndex((s) => s.id === session.id);
  const next =
    idx >= 0
      ? list.map((s) => (s.id === session.id ? session : s))
      : [session, ...list];
  return { ...map, [session.projectSlug]: next };
}

export const store = {
  subscribe,
  getSnapshot,

  async loadProjects() {
    try {
      const projects = await api.listProjects();
      setState({ projects, projectsLoaded: true });
      for (const p of projects) {
        if (!state.sessionsByProject[p.slug]) {
          this.loadSessions(p.slug).catch(() => {});
        }
      }
    } catch (err) {
      setState({
        projectsLoaded: true,
        errors: { ...state.errors, projects: (err as Error).message },
      });
    }
  },

  async loadSessions(slug: string) {
    try {
      const sessions = await api.listSessions(slug);
      setState({
        sessionsByProject: { ...state.sessionsByProject, [slug]: sessions },
      });
    } catch (err) {
      setState({
        errors: {
          ...state.errors,
          [`sessions:${slug}`]: (err as Error).message,
        },
      });
    }
  },

  selectSession(slug: string | null, sessionId: string | null) {
    setState({ selected: { slug, sessionId } });
  },

  async openSession(slug: string, id: string) {
    this.selectSession(slug, id);
    if (!state.messages[id]) {
      setState({ messages: { ...state.messages, [id]: [] } });
    }
    try {
      const { session, messages } = await api.getSession(slug, id);
      const usageTotals = seedUsageTotals(messages, id);
      setState({
        sessionsByProject: upsertSessionIn(state.sessionsByProject, session),
        messages: { ...state.messages, [id]: messages },
        usageTotals: { ...state.usageTotals, [id]: usageTotals },
      });
    } catch (err) {
      setState({
        errors: {
          ...state.errors,
          [`session:${id}`]: (err as Error).message,
        },
      });
    }
  },

  async createSession(slug: string, cwd?: string, permissionMode?: string) {
    try {
      const { sessionId } = await api.createSession(slug, cwd, permissionMode);
      await this.loadSessions(slug);
      await this.openSession(slug, sessionId);
      return sessionId;
    } catch (err) {
      setState({
        errors: {
          ...state.errors,
          [`create:${slug}`]: (err as Error).message,
        },
      });
      throw err;
    }
  },

  async forkSession(slug: string, sessionId: string) {
    try {
      const { sessionId: newId } = await api.fork(sessionId, slug);
      await this.loadSessions(slug);
      await this.openSession(slug, newId);
      return newId;
    } catch (err) {
      setState({
        errors: { ...state.errors, [`fork:${sessionId}`]: (err as Error).message },
      });
      throw err;
    }
  },

  async sendPrompt(text: string, attachments?: Array<{ fileId: string; path: string }>) {
    const { slug, sessionId } = state.selected;
    if (!slug || !sessionId) return;
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    setState({ sending: { ...state.sending, [sessionId]: true } });
    try {
      await api.prompt(sessionId, text, slug, attachments);
    } catch (err) {
      setState({
        sending: { ...state.sending, [sessionId]: false },
      });
      throw err;
    }
  },

  async abortCurrent() {
    const { sessionId } = state.selected;
    if (!sessionId) return;
    try {
      await api.abort(sessionId);
    } catch {
      // ignore
    }
  },

  async disposeSession(id: string) {
    try {
      await api.dispose(id);
    } catch {
      // ignore
    }
    const nextMessages = { ...state.messages };
    delete nextMessages[id];
    const nextSending = { ...state.sending };
    delete nextSending[id];
    const nextByProject: Record<string, Session[]> = {};
    for (const [slug, list] of Object.entries(state.sessionsByProject)) {
      nextByProject[slug] = list.filter((s) => s.id !== id);
    }
    const selected =
      state.selected.sessionId === id
        ? { slug: state.selected.slug, sessionId: null }
        : state.selected;
    setState({
      messages: nextMessages,
      sending: nextSending,
      sessionsByProject: nextByProject,
      selected,
    });
  },

  dispatch(event: SSEEvent) {
    switch (event.type) {
      case "server.connected": {
        setState({ connected: true });
        break;
      }
      case "session.created":
      case "session.updated": {
        setState({
          sessionsByProject: upsertSessionIn(
            state.sessionsByProject,
            event.session,
          ),
        });
        break;
      }
      case "session.idle": {
        const patch: Partial<StoreState> = {
          sending: { ...state.sending, [event.sessionId]: false },
        };
        if (event.result) {
          const msgs = state.messages[event.sessionId] ?? [];
          if (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            const parts = [...last.parts, event.result];
            patch.messages = {
              ...state.messages,
              [event.sessionId]: [...msgs.slice(0, -1), { ...last, parts }],
            };
          }
          patch.usageTotals = accumulateUsage(
            state.usageTotals,
            event.sessionId,
            event.result,
          );
        }
        setState(patch);
        break;
      }
      case "session.error": {
        setState({
          sending: { ...state.sending, [event.sessionId]: false },
          errors: {
            ...state.errors,
            [`session:${event.sessionId}`]: event.error,
          },
        });
        break;
      }
      case "message.created": {
        const prev = state.messages[event.sessionId] ?? [];
        setState({
          messages: {
            ...state.messages,
            [event.sessionId]: applyMessageCreated(prev, event),
          },
        });
        break;
      }
      case "message.part.updated": {
        const prev = state.messages[event.sessionId] ?? [];
        setState({
          messages: {
            ...state.messages,
            [event.sessionId]: applyPartUpdate(prev, event),
          },
        });
        break;
      }
      case "message.part.delta": {
        const prev = state.messages[event.sessionId] ?? [];
        setState({
          messages: {
            ...state.messages,
            [event.sessionId]: applyDelta(prev, event),
          },
        });
        break;
      }
      case "message.part.completed": {
        emit();
        break;
      }
      case "channel.permission_request": {
        const list = state.permissionRequests[event.sessionId] ?? [];
        if (list.some((r) => r.requestId === event.request.requestId)) break;
        const entry: PermissionRequest = {
          requestId: event.request.requestId,
          toolName: event.request.toolName,
          description: event.request.description,
          inputPreview: event.request.inputPreview,
          receivedAt: Date.now(),
        };
        setState({
          permissionRequests: {
            ...state.permissionRequests,
            [event.sessionId]: [...list, entry],
          },
        });
        break;
      }
      case "channel.permission_resolved": {
        const list = state.permissionRequests[event.sessionId] ?? [];
        const next = list.filter((r) => r.requestId !== event.requestId);
        if (next.length === list.length) break;
        setState({
          permissionRequests: {
            ...state.permissionRequests,
            [event.sessionId]: next,
          },
        });
        break;
      }
      case "task.started": {
        const task: RunningTask = {
          partId: event.partId,
          toolUseId: event.toolUseId,
          sessionId: event.sessionId,
          subagentType: event.subagentType,
          description: event.description,
          startedAt: Date.now(),
          state: "running",
        };
        setState({ runningTasks: [...state.runningTasks, task] });
        break;
      }
      case "task.finished": {
        setState({
          runningTasks: state.runningTasks.map((t) =>
            t.partId === event.partId ? { ...t, state: event.state } : t,
          ),
        });
        break;
      }
      case "mcp.tool_call.started": {
        const call: McpToolCall = {
          callId: event.callId,
          tool: event.tool,
          clientId: event.clientId,
          sessionId: event.sessionId,
          startedAt: event.startedAt,
          state: "running",
        };
        setState({ mcpCalls: [...state.mcpCalls, call] });
        break;
      }
      case "mcp.tool_call.finished": {
        const PRUNE_AGE_MS = 30_000;
        const now = Date.now();
        const updated = state.mcpCalls
          .map((c) =>
            c.callId === event.callId
              ? {
                  ...c,
                  state: (event.isError ? "error" : "completed") as McpToolCall["state"],
                  durationMs: event.durationMs,
                }
              : c,
          )
          .filter((c) => c.state === "running" || now - c.startedAt < PRUNE_AGE_MS);
        setState({ mcpCalls: updated });
        break;
      }
    }
  },

  async resolvePermission(
    sessionId: string,
    requestId: string,
    behavior: "allow" | "deny",
  ) {
    const list = state.permissionRequests[sessionId] ?? [];
    const next = list.filter((r) => r.requestId !== requestId);
    setState({
      permissionRequests: {
        ...state.permissionRequests,
        [sessionId]: next,
      },
    });
    try {
      await api.resolvePermission(sessionId, requestId, behavior);
    } catch (err) {
      setState({
        errors: {
          ...state.errors,
          [`permission:${sessionId}:${requestId}`]: (err as Error).message,
        },
      });
    }
  },

  async renameSession(sessionId: string, title: string) {
    const nextByProject: Record<string, Session[]> = {};
    for (const [slug, list] of Object.entries(state.sessionsByProject)) {
      nextByProject[slug] = list.map((s) =>
        s.id === sessionId ? { ...s, title } : s,
      );
    }
    setState({ sessionsByProject: nextByProject });
    try {
      await api.renameSession(sessionId, title);
    } catch (err) {
      setState({
        errors: {
          ...state.errors,
          [`rename:${sessionId}`]: (err as Error).message,
        },
      });
    }
  },

  setSidebarSort(sort: SidebarSort) {
    setState({ sidebarSort: sort });
  },

  setHideEmptyProjects(hide: boolean) {
    setState({ hideEmptyProjects: hide });
  },

  setConnected(connected: boolean) {
    setState({ connected });
  },

clearError(key: string) {
    if (!(key in state.errors)) return;
    const next = { ...state.errors };
    delete next[key];
    setState({ errors: next });
  },

  async loadMarkers() {
    try {
      const { markers } = await api.getState();
      setState({ markers });
    } catch (err) {
      console.error("Failed to load markers:", err);
    }
  },

  async addMarker(marker: Omit<Marker, "id" | "createdAt">) {
    const newMarker: Marker = {
      ...marker,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const sessionMarkers = state.markers[marker.sessionId] ?? [];
    const nextMarkers = { ...state.markers, [marker.sessionId]: [...sessionMarkers, newMarker] };
    setState({ markers: nextMarkers });
    try {
      await api.updateState({ markers: nextMarkers });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to save marker:", err);
    }
  },

  async removeMarker(sessionId: string, markerId: string) {
    const sessionMarkers = state.markers[sessionId] ?? [];
    const nextMarkers = { ...state.markers, [sessionId]: sessionMarkers.filter((m) => m.id !== markerId) };
    setState({ markers: nextMarkers });
    try {
      await api.updateState({ markers: nextMarkers });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to remove marker:", err);
    }
  },

  async toggleMarkerResolved(sessionId: string, markerId: string) {
    const sessionMarkers = state.markers[sessionId] ?? [];
    const nextMarkers = {
      ...state.markers,
      [sessionId]: sessionMarkers.map((m) =>
        m.id === markerId ? { ...m, resolved: !m.resolved } : m
      ),
    };
    setState({ markers: nextMarkers });
    try {
      await api.updateState({ markers: nextMarkers });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to toggle marker:", err);
    }
  },
};

function seedUsageTotals(messages: Message[], _sessionId: string): UsageTotal {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turnCount = 0;
  let totalDurationMs = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "result") {
        const r = part as ResultPart;
        totalCostUsd += r.costUsd ?? 0;
        totalDurationMs += r.durationMs ?? 0;
        turnCount++;
        if (r.usage) {
          totalInputTokens += r.usage.input_tokens ?? 0;
          totalOutputTokens += r.usage.output_tokens ?? 0;
        }
      }
    }
  }
  return { totalCostUsd, totalInputTokens, totalOutputTokens, turnCount, totalDurationMs };
}

function accumulateUsage(
  totals: Record<string, UsageTotal>,
  sessionId: string,
  result: ResultPart,
): Record<string, UsageTotal> {
  const prev = totals[sessionId] ?? {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turnCount: 0,
    totalDurationMs: 0,
  };
  return {
    ...totals,
    [sessionId]: {
      totalCostUsd: prev.totalCostUsd + (result.costUsd ?? 0),
      totalInputTokens: prev.totalInputTokens + (result.usage?.input_tokens ?? 0),
      totalOutputTokens: prev.totalOutputTokens + (result.usage?.output_tokens ?? 0),
      turnCount: prev.turnCount + 1,
      totalDurationMs: prev.totalDurationMs + (result.durationMs ?? 0),
    },
  };
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
