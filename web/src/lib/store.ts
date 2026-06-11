import { useSyncExternalStore } from "react";
import { api } from "./api";
import { hubApi, type HubMachine } from "./hubApi";
import {
  applyDelta,
  applyMessageCreated,
  applyPartUpdate,
} from "./parts";
import type {
  Marker,
  McpToolCall,
  Message,
  PermissionRequest,
  Project,
  ResultPart,
  RunningTask,
  SSEEvent,
  Session,
} from "./types";

export interface UsageTotal {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  totalDurationMs: number;
}

export type SidebarSort = "recent" | "status" | "name";
export type SessionSource = "local" | string;

export interface RemoteMachineState {
  machine: HubMachine;
  projects: Project[];
  sessionsByProject: Record<string, Session[]>;
}

export interface SelectedSession {
  source: SessionSource | null;
  machineId: string | null;
  slug: string | null;
  sessionId: string | null;
}

export interface StoreState {
  projects: Project[];
  sessionsByProject: Record<string, Session[]>;
  remote: Record<string, RemoteMachineState>;
  selected: SelectedSession;
  messages: Record<string, Message[]>;
  sending: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  connected: boolean;
  hubConnected: boolean;
  projectsLoaded: boolean;
  permissionRequests: Record<string, PermissionRequest[]>;
  usageTotals: Record<string, UsageTotal>;
  markers: Record<string, Marker[]>;
  runningTasks: RunningTask[];
  mcpCalls: McpToolCall[];
  sidebarSort: SidebarSort;
  hideEmptyProjects: boolean;
  hubEnabled: boolean;
  hubToken: string | null;
  localMachineId: string | null;
}

type Listener = () => void;

let state: StoreState = {
  projects: [],
  sessionsByProject: {},
  remote: {},
  selected: { source: null, machineId: null, slug: null, sessionId: null },
  messages: {},
  sending: {},
  errors: {},
  connected: false,
  hubConnected: false,
  projectsLoaded: false,
  permissionRequests: {},
  usageTotals: {},
  markers: {},
  runningTasks: [],
  mcpCalls: [],
  sidebarSort: "recent",
  hideEmptyProjects: true,
  hubEnabled: false,
  hubToken: null,
  localMachineId: null,
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

export function getSessionKey(source: SessionSource | null, sessionId: string | null): string | null {
  if (!source || !sessionId) return null;
  return source === "local" ? `local:${sessionId}` : `${source}:${sessionId}`;
}

export function getSelectedSessionKey(selected: SelectedSession): string | null {
  return getSessionKey(selected.source, selected.sessionId);
}

export function getSessionsForSource(
  snapshot: StoreState,
  source: SessionSource,
  slug: string,
): Session[] {
  if (source === "local") {
    return snapshot.sessionsByProject[slug] ?? [];
  }
  return snapshot.remote[source]?.sessionsByProject[slug] ?? [];
}

export function findSession(
  snapshot: StoreState,
  source: SessionSource | null,
  slug: string | null,
  sessionId: string | null,
): Session | null {
  if (!source || !slug || !sessionId) return null;
  return getSessionsForSource(snapshot, source, slug).find((s) => s.id === sessionId) ?? null;
}

function upsertSessionIn(
  map: Record<string, Session[]>,
  session: Session,
): Record<string, Session[]> {
  const list = map[session.projectSlug] ?? [];
  const idx = list.findIndex((s) => s.id === session.id);
  const next = idx >= 0
    ? list.map((s) => (s.id === session.id ? session : s))
    : [session, ...list];
  return { ...map, [session.projectSlug]: next };
}

function setRemoteMachine(machineId: string, patch: Partial<RemoteMachineState>) {
  const current = state.remote[machineId];
  if (!current && !patch.machine) return;
  setState({
    remote: {
      ...state.remote,
      [machineId]: {
        machine: patch.machine ?? current!.machine,
        projects: patch.projects ?? current?.projects ?? [],
        sessionsByProject: patch.sessionsByProject ?? current?.sessionsByProject ?? {},
      },
    },
  });
}

async function withFreshHubToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  let token = state.hubToken;
  if (!token) {
    throw new Error("Hub token unavailable");
  }

  try {
    return await fn(token);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status !== 401) throw err;
    const refreshed = await apiHubToken();
    if (!refreshed) throw err;
    token = refreshed;
    return fn(token);
  }
}

async function apiHubToken(): Promise<string | null> {
  const res = await fetch("/api/hub/token", { credentials: "include" });
  if (!res.ok) {
    setState({ hubEnabled: false, hubToken: null, remote: {}, hubConnected: false });
    return null;
  }
  const json = await res.json() as { accessToken?: string; machineId?: string };
  if (!json.accessToken) return null;
  setState({
    hubEnabled: true,
    hubToken: json.accessToken,
    localMachineId: json.machineId ?? state.localMachineId,
  });
  return json.accessToken;
}

function seedUsageTotals(messages: Message[]): UsageTotal {
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
  sessionKey: string,
  result: ResultPart,
): Record<string, UsageTotal> {
  const prev = totals[sessionKey] ?? {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turnCount: 0,
    totalDurationMs: 0,
  };
  return {
    ...totals,
    [sessionKey]: {
      totalCostUsd: prev.totalCostUsd + (result.costUsd ?? 0),
      totalInputTokens: prev.totalInputTokens + (result.usage?.input_tokens ?? 0),
      totalOutputTokens: prev.totalOutputTokens + (result.usage?.output_tokens ?? 0),
      turnCount: prev.turnCount + 1,
      totalDurationMs: prev.totalDurationMs + (result.durationMs ?? 0),
    },
  };
}

function getEventSessionId(event: SSEEvent): string | null {
  return "sessionId" in event && typeof event.sessionId === "string"
    ? event.sessionId
    : null;
}

function dispatchEvent(source: SessionSource, event: SSEEvent) {
  const sessionKey = getSessionKey(source, getEventSessionId(event));
  switch (event.type) {
    case "server.connected": {
      if (source === "local") {
        setState({ connected: true });
      }
      break;
    }
    case "session.created":
    case "session.updated": {
      if (source === "local") {
        setState({ sessionsByProject: upsertSessionIn(state.sessionsByProject, event.session) });
      } else {
        setRemoteMachine(source, {
          sessionsByProject: upsertSessionIn(state.remote[source]?.sessionsByProject ?? {}, event.session),
        });
      }
      break;
    }
    case "session.idle": {
      if (!sessionKey) break;
      const patch: Partial<StoreState> = {
        sending: { ...state.sending, [sessionKey]: false },
      };
      if (event.result) {
        const msgs = state.messages[sessionKey] ?? [];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1]!;
          const parts = [...last.parts, event.result];
          patch.messages = {
            ...state.messages,
            [sessionKey]: [...msgs.slice(0, -1), { ...last, parts }],
          };
        }
        patch.usageTotals = accumulateUsage(state.usageTotals, sessionKey, event.result);
      }
      setState(patch);
      break;
    }
    case "session.error": {
      if (!sessionKey) break;
      setState({
        sending: { ...state.sending, [sessionKey]: false },
        errors: { ...state.errors, [`session:${sessionKey}`]: event.error },
      });
      break;
    }
    case "message.created": {
      if (!sessionKey) break;
      const prev = state.messages[sessionKey] ?? [];
      setState({
        messages: { ...state.messages, [sessionKey]: applyMessageCreated(prev, event) },
      });
      break;
    }
    case "message.part.updated": {
      if (!sessionKey) break;
      const prev = state.messages[sessionKey] ?? [];
      setState({
        messages: { ...state.messages, [sessionKey]: applyPartUpdate(prev, event) },
      });
      break;
    }
    case "message.part.delta": {
      if (!sessionKey) break;
      const prev = state.messages[sessionKey] ?? [];
      setState({
        messages: { ...state.messages, [sessionKey]: applyDelta(prev, event) },
      });
      break;
    }
    case "message.part.completed": {
      emit();
      break;
    }
    case "channel.permission_request": {
      if (!sessionKey) break;
      const list = state.permissionRequests[sessionKey] ?? [];
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
          [sessionKey]: [...list, entry],
        },
      });
      break;
    }
    case "channel.permission_resolved": {
      if (!sessionKey) break;
      const list = state.permissionRequests[sessionKey] ?? [];
      const next = list.filter((r) => r.requestId !== event.requestId);
      if (next.length === list.length) break;
      setState({
        permissionRequests: { ...state.permissionRequests, [sessionKey]: next },
      });
      break;
    }
    case "task.started": {
      const task: RunningTask = {
        partId: event.partId,
        toolUseId: event.toolUseId,
        sessionId: sessionKey ?? event.sessionId,
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
}

export const store = {
  subscribe,
  getSnapshot,

  setHubAuth(hubEnabled: boolean, token: string | null, localMachineId?: string | null) {
    setState({
      hubEnabled,
      hubToken: token,
      ...(localMachineId !== undefined ? { localMachineId } : {}),
    });
  },

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
      setState({ sessionsByProject: { ...state.sessionsByProject, [slug]: sessions } });
    } catch (err) {
      setState({ errors: { ...state.errors, [`sessions:${slug}`]: (err as Error).message } });
    }
  },

  async loadRemoteMachines() {
    if (!state.hubEnabled || !state.hubToken) return;
    try {
      const { machines } = await withFreshHubToken((token) => hubApi.listMachines(token));
      const nextRemote: Record<string, RemoteMachineState> = {};
      for (const machine of machines) {
        const current = state.remote[machine.machineId];
        nextRemote[machine.machineId] = {
          machine,
          projects: current?.projects ?? [],
          sessionsByProject: current?.sessionsByProject ?? {},
        };
      }
      setState({ remote: nextRemote });
      for (const machine of machines) {
        this.loadRemoteProjects(machine.machineId).catch(() => {});
      }
    } catch (err) {
      setState({ errors: { ...state.errors, remoteMachines: (err as Error).message } });
    }
  },

  async loadRemoteProjects(machineId: string) {
    try {
      const { projects } = await withFreshHubToken((token) => hubApi.listProjects(token, machineId));
      setRemoteMachine(machineId, { projects });
      for (const project of projects) {
        this.loadRemoteSessions(machineId, project.slug).catch(() => {});
      }
    } catch (err) {
      setState({ errors: { ...state.errors, [`remoteProjects:${machineId}`]: (err as Error).message } });
    }
  },

  async loadRemoteSessions(machineId: string, slug: string) {
    try {
      const { sessions } = await withFreshHubToken((token) => hubApi.listSessions(token, machineId, slug));
      setRemoteMachine(machineId, {
        sessionsByProject: {
          ...(state.remote[machineId]?.sessionsByProject ?? {}),
          [slug]: sessions,
        },
      });
    } catch (err) {
      setState({ errors: { ...state.errors, [`remoteSessions:${machineId}:${slug}`]: (err as Error).message } });
    }
  },

  selectSession(source: SessionSource | null, slug: string | null, sessionId: string | null) {
    setState({
      selected: {
        source,
        machineId: source && source !== "local" ? source : null,
        slug,
        sessionId,
      },
    });
  },

  async openSession(slug: string, id: string, source: SessionSource = "local") {
    this.selectSession(source, slug, id);
    const sessionKey = getSessionKey(source, id);
    if (!sessionKey) return;
    if (!state.messages[sessionKey]) {
      setState({ messages: { ...state.messages, [sessionKey]: [] } });
    }
    try {
      const result = source === "local"
        ? await api.getSession(slug, id)
        : await withFreshHubToken((token) => hubApi.getSession(token, source, slug, id));
      const usageTotals = seedUsageTotals(result.messages);
      if (source === "local") {
        setState({
          sessionsByProject: upsertSessionIn(state.sessionsByProject, result.session),
          messages: { ...state.messages, [sessionKey]: result.messages },
          usageTotals: { ...state.usageTotals, [sessionKey]: usageTotals },
        });
      } else {
        setRemoteMachine(source, {
          sessionsByProject: upsertSessionIn(state.remote[source]?.sessionsByProject ?? {}, result.session),
        });
        setState({
          messages: { ...state.messages, [sessionKey]: result.messages },
          usageTotals: { ...state.usageTotals, [sessionKey]: usageTotals },
        });
      }
    } catch (err) {
      setState({ errors: { ...state.errors, [`session:${sessionKey}`]: (err as Error).message } });
    }
  },

  async createSession(slug: string, cwd?: string, permissionMode?: string) {
    try {
      const { sessionId } = await api.createSession(slug, cwd, permissionMode);
      await this.loadSessions(slug);
      await this.openSession(slug, sessionId, "local");
      return sessionId;
    } catch (err) {
      setState({ errors: { ...state.errors, [`create:${slug}`]: (err as Error).message } });
      throw err;
    }
  },

  async createRemoteSession(machineId: string, slug: string, cwd?: string, permissionMode?: string) {
    try {
      const { sessionId } = await withFreshHubToken((token) =>
        hubApi.createSession(token, machineId, slug, cwd, permissionMode),
      );
      await this.loadRemoteSessions(machineId, slug);
      await this.openSession(slug, sessionId, machineId);
      return sessionId;
    } catch (err) {
      setState({ errors: { ...state.errors, [`create:${machineId}:${slug}`]: (err as Error).message } });
      throw err;
    }
  },

  async forkSession(slug: string, sessionId: string) {
    if (state.selected.source !== "local") {
      throw new Error("Remote fork is not supported yet");
    }
    try {
      const { sessionId: newId } = await api.fork(sessionId, slug);
      await this.loadSessions(slug);
      await this.openSession(slug, newId, "local");
      return newId;
    } catch (err) {
      setState({ errors: { ...state.errors, [`fork:${sessionId}`]: (err as Error).message } });
      throw err;
    }
  },

  async sendPrompt(text: string, attachments?: Array<{ fileId: string; path: string }>) {
    const { slug, sessionId, source } = state.selected;
    const sessionKey = getSelectedSessionKey(state.selected);
    if (!slug || !sessionId || !source || !sessionKey) return;
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (source !== "local" && (attachments?.length ?? 0) > 0) {
      throw new Error("Remote attachments are not supported yet");
    }
    setState({ sending: { ...state.sending, [sessionKey]: true } });
    try {
      if (source === "local") {
        await api.prompt(sessionId, text, slug, attachments);
      } else {
        await withFreshHubToken((token) => hubApi.prompt(token, source, sessionId, text, slug));
      }
    } catch (err) {
      setState({ sending: { ...state.sending, [sessionKey]: false } });
      throw err;
    }
  },

  async abortCurrent() {
    const { source, sessionId } = state.selected;
    if (!source || !sessionId) return;
    try {
      if (source === "local") {
        await api.abort(sessionId);
      } else {
        await withFreshHubToken((token) => hubApi.abort(token, source, sessionId));
      }
    } catch {
      // ignore
    }
  },

  async disposeSession(id: string) {
    if (state.selected.source !== "local") {
      return;
    }
    try {
      await api.dispose(id);
    } catch {
      // ignore
    }
    const nextMessages = { ...state.messages };
    delete nextMessages[`local:${id}`];
    const nextSending = { ...state.sending };
    delete nextSending[`local:${id}`];
    const nextByProject: Record<string, Session[]> = {};
    for (const [slug, list] of Object.entries(state.sessionsByProject)) {
      nextByProject[slug] = list.filter((s) => s.id !== id);
    }
    const selected = state.selected.sessionId === id && state.selected.source === "local"
      ? { source: "local" as const, machineId: null, slug: state.selected.slug, sessionId: null }
      : state.selected;
    setState({ messages: nextMessages, sending: nextSending, sessionsByProject: nextByProject, selected });
  },

  dispatch(event: SSEEvent) {
    dispatchEvent("local", event);
  },

  dispatchRemote(machineId: string, event: SSEEvent) {
    dispatchEvent(machineId, event);
  },

  setRemoteMachineStatus(machineId: string, online: boolean) {
    const current = state.remote[machineId];
    if (!current) return;
    setRemoteMachine(machineId, { machine: { ...current.machine, online, lastSeenAt: Date.now() } });
  },

  async resolvePermission(sessionKey: string, requestId: string, behavior: "allow" | "deny") {
    const colonIdx = sessionKey.indexOf(":");
    const source = colonIdx >= 0 ? sessionKey.slice(0, colonIdx) : sessionKey;
    const sessionId = colonIdx >= 0 ? sessionKey.slice(colonIdx + 1) : "";
    const list = state.permissionRequests[sessionKey] ?? [];
    const next = list.filter((r) => r.requestId !== requestId);
    setState({ permissionRequests: { ...state.permissionRequests, [sessionKey]: next } });
    if (source !== "local") return;
    try {
      await api.resolvePermission(sessionId, requestId, behavior);
    } catch (err) {
      setState({ errors: { ...state.errors, [`permission:${sessionKey}:${requestId}`]: (err as Error).message } });
    }
  },

  async renameSession(sessionId: string, title: string) {
    if (state.selected.source !== "local") return;
    const nextByProject: Record<string, Session[]> = {};
    for (const [slug, list] of Object.entries(state.sessionsByProject)) {
      nextByProject[slug] = list.map((s) => (s.id === sessionId ? { ...s, title } : s));
    }
    setState({ sessionsByProject: nextByProject });
    try {
      await api.renameSession(sessionId, title);
    } catch (err) {
      setState({ errors: { ...state.errors, [`rename:${sessionId}`]: (err as Error).message } });
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

  setHubConnected(connected: boolean) {
    setState({ hubConnected: connected });
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
      const next: Record<string, Marker[]> = {};
      for (const [sessionId, list] of Object.entries(markers)) {
        next[`local:${sessionId}`] = list.map((marker) => ({ ...marker, sessionId: `local:${marker.sessionId}` }));
      }
      setState({ markers: next });
    } catch (err) {
      console.error("Failed to load markers:", err);
    }
  },

  async addMarker(marker: Omit<Marker, "id" | "createdAt">) {
    if (!marker.sessionId.startsWith("local:")) return;
    const localSessionId = marker.sessionId.slice("local:".length);
    const newMarker: Marker = { ...marker, id: crypto.randomUUID(), createdAt: Date.now() };
    const sessionMarkers = state.markers[marker.sessionId] ?? [];
    const nextMarkers = { ...state.markers, [marker.sessionId]: [...sessionMarkers, newMarker] };
    setState({ markers: nextMarkers });
    try {
      const outbound: Record<string, Marker[]> = {};
      for (const [key, value] of Object.entries(nextMarkers)) {
        if (key.startsWith("local:")) {
          outbound[key.slice("local:".length)] = value.map((entry) => ({ ...entry, sessionId: entry.sessionId.slice("local:".length) }));
        }
      }
      await api.updateState({ markers: outbound });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to save marker:", err, localSessionId);
    }
  },

  async removeMarker(sessionKey: string, markerId: string) {
    if (!sessionKey.startsWith("local:")) return;
    const sessionMarkers = state.markers[sessionKey] ?? [];
    const nextMarkers = { ...state.markers, [sessionKey]: sessionMarkers.filter((m) => m.id !== markerId) };
    setState({ markers: nextMarkers });
    try {
      const outbound: Record<string, Marker[]> = {};
      for (const [key, value] of Object.entries(nextMarkers)) {
        if (key.startsWith("local:")) {
          outbound[key.slice("local:".length)] = value.map((entry) => ({ ...entry, sessionId: entry.sessionId.slice("local:".length) }));
        }
      }
      await api.updateState({ markers: outbound });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to remove marker:", err);
    }
  },

  async toggleMarkerResolved(sessionKey: string, markerId: string) {
    if (!sessionKey.startsWith("local:")) return;
    const sessionMarkers = state.markers[sessionKey] ?? [];
    const nextMarkers = {
      ...state.markers,
      [sessionKey]: sessionMarkers.map((m) => (m.id === markerId ? { ...m, resolved: !m.resolved } : m)),
    };
    setState({ markers: nextMarkers });
    try {
      const outbound: Record<string, Marker[]> = {};
      for (const [key, value] of Object.entries(nextMarkers)) {
        if (key.startsWith("local:")) {
          outbound[key.slice("local:".length)] = value.map((entry) => ({ ...entry, sessionId: entry.sessionId.slice("local:".length) }));
        }
      }
      await api.updateState({ markers: outbound });
    } catch (err) {
      setState({ markers: state.markers });
      console.error("Failed to toggle marker:", err);
    }
  },
};

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
