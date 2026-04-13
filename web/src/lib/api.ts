import type { Message, Project, Session, Marker } from "./types";

export interface ObservabilityStats {
  totalSessions: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  activeProjects: string[];
  recentActivity: Array<{
    slug: string;
    sessionCount: number;
    totalCost: number;
    lastActive: number;
  }>;
  projectBreakdown: Array<{
    projectName: string;
    sessions: number;
    cost: number;
    tokens: number;
  }>;
}

export interface DailySnapshot {
  date: string;
  totalCost: number;
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpMetric {
  name: string;
  totalCalls: number;
  errorCount: number;
  avgLatencyMs: number;
  lastSeen: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.error === "string") message = parsed.error;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface MemoryFile {
  filename: string;
  content: string;
}

export type UatAction = "navigate" | "click" | "fill" | "wait" | "snapshot" | "screenshot";

export interface UatStep {
  action: UatAction;
  selector?: string;
  value?: string;
}

export type UatEvent =
  | { type: "step.started"; stepIndex: number; action: string }
  | { type: "step.passed"; stepIndex: number }
  | { type: "step.failed"; stepIndex: number; error: string }
  | { type: "complete"; passed: number; failed: number };

export interface UploadResult {
  fileId: string;
  path: string;
}

async function uploadReq<T>(url: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(url, {
    credentials: "include",
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.error === "string") message = parsed.error;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => req<Project[]>("/api/projects"),
  listSessions: (slug: string) =>
    req<Session[]>(`/api/projects/${encodeURIComponent(slug)}/sessions`),
  getSession: (slug: string, id: string) =>
    req<{ session: Session; messages: Message[] }>(
      `/api/sessions/${id}?slug=${encodeURIComponent(slug)}`,
    ),
  createSession: (slug: string, cwd?: string, permissionMode?: string) =>
    req<{ sessionId: string; cwd: string }>(
      `/api/projects/${encodeURIComponent(slug)}/sessions`,
      { method: "POST", body: JSON.stringify({ cwd, permissionMode }) },
    ),
  prompt: (id: string, text: string, slug: string, attachments?: Array<{ fileId: string; path: string }>) =>
    req<{ ok: true }>(`/api/sessions/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, slug, attachments }),
    }),
  uploadFile: (sessionId: string, file: File) =>
    uploadReq<UploadResult>(`/api/sessions/${sessionId}/upload`, file),
  fork: (id: string, slug: string) =>
    req<{ sessionId: string; forkedFrom: string }>(
      `/api/sessions/${id}/fork`,
      { method: "POST", body: JSON.stringify({ slug }) },
    ),
  abort: (id: string) =>
    req<void>(`/api/sessions/${id}/abort`, { method: "POST" }),
  dispose: (id: string) =>
    req<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  resolvePermission: (
    id: string,
    requestId: string,
    behavior: "allow" | "deny",
  ) =>
    req<{ ok: true }>(`/api/sessions/${id}/permission`, {
      method: "POST",
      body: JSON.stringify({ request_id: requestId, behavior }),
    }),
  getMemory: (slug: string) =>
    req<MemoryFile[]>(`/api/projects/${encodeURIComponent(slug)}/memory`),
  getState: () =>
    req<{ markers: Record<string, Marker[]>; preferences: Record<string, unknown>; recentCwds: string[] }>("/api/state"),
  updateState: (patch: { markers?: Record<string, Marker[]>; preferences?: Record<string, unknown>; recentCwds?: string[] }) =>
    req<{ markers: Record<string, Marker[]>; preferences: Record<string, unknown>; recentCwds: string[] }>("/api/state", { method: "PATCH", body: JSON.stringify(patch) }),
  searchSessions: (q: string) =>
    req<{ results: Array<{ sessionId: string; slug: string; title: string; cwd: string; snippet: string; mtimeMs: number }> }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
  listOpzeroProjects: () =>
    req<{ localProjects: Array<{ name: string; path: string; hasGit: boolean }>; githubProjects: Array<{ name: string; path: string; hasGit: boolean }> }>("/api/opzero/projects"),
  runUat: (url: string, steps: UatStep[]) => {
    const controller = new AbortController();
    const res = fetch("/api/uat/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, steps }),
      signal: controller.signal,
      credentials: "include",
    });
    return {
      response: res,
      controller,
      stream: (async function*() {
        const r = await res;
        if (!r.ok) {
          const text = await r.text();
          throw new Error(text || `${r.status} ${r.statusText}`);
        }
        const reader = r.body?.getReader();
        if (!reader) throw new Error("no response body");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                yield JSON.parse(line.slice(5)) as UatEvent;
              } catch {
                // skip
              }
            }
          }
        }
      })(),
    };
  },
  getMcpServers: () =>
    req<{ servers: McpServerConfig[] }>("/api/mcp/servers"),
  getMcpMetrics: () =>
    req<{ metrics: McpMetric[] }>("/api/mcp/metrics"),
  getObservabilityStats: () =>
    req<ObservabilityStats>("/api/observability/stats"),
  restartServer: () =>
    req<{ ok: true; restarting: true }>("/api/server/restart", { method: "POST" }),
};
