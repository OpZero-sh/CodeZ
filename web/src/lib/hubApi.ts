import type { Message, Project, Session } from "./types";

export const HUB_BASE_URL =
  (import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://code.open0p.com";

export interface HubMachine {
  machineId: string;
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
  memoryGB: number;
  codezVersion: string;
  online: boolean;
  lastSeenAt: number;
  createdAt: number;
  repos: Array<{ path: string; remote?: string }>;
  activeSessionCount: number;
}

async function req<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HUB_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (body) message = body;
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const hubApi = {
  listMachines: (token: string) => req<{ machines: HubMachine[] }>(token, "/api/machines"),
  listProjects: (token: string, machineId: string) =>
    req<{ projects: Project[] }>(token, `/api/machines/${encodeURIComponent(machineId)}/projects`),
  listSessions: (token: string, machineId: string, slug: string) =>
    req<{ sessions: Session[] }>(
      token,
      `/api/machines/${encodeURIComponent(machineId)}/projects/${encodeURIComponent(slug)}/sessions`,
    ),
  getSession: (token: string, machineId: string, slug: string, sessionId: string) =>
    req<{ session: Session; messages: Message[] }>(
      token,
      `/api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(sessionId)}?slug=${encodeURIComponent(slug)}`,
    ),
  prompt: (token: string, machineId: string, sessionId: string, text: string, slug: string) =>
    req<{ ok: true }>(token, `/api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, slug }),
    }),
  abort: (token: string, machineId: string, sessionId: string) =>
    req<void>(token, `/api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
    }),
};
