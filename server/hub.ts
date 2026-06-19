import { hostname, arch, cpus, totalmem, platform } from "node:os";
import { readdir, stat, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HubMachineAgent,
  type HubAgentConfig,
  type CommandHandler,
  type RepoInfo,
  type SessionInfo,
} from "@opzero/codez-hub-client";
import type { SessionPool } from "./claude/pool";
import type { EventBus } from "./bus";
import { encodeProjectSlug, listProjects, listSessionsForProject } from "./claude/history";
import type { Config } from "./config";
import { loadConfig, getConfigDir } from "./config";
import { getAccessToken, createTokenRefresher, createAuthRecovery, readStoredAuth } from "./hub-auth";

const DEFAULT_HUB_URL = "https://code.opzero.sh";

export interface HubConfig {
  url: string;
  token: string;
}

function tokenPath(): string {
  return join(getConfigDir(), "hub-token");
}

function machineIdPath(): string {
  return join(getConfigDir(), "machine-id");
}

function userIdPath(): string {
  return join(getConfigDir(), "hub-user-id");
}

async function readKnownUserId(): Promise<string | undefined> {
  try {
    const existing = (await readFile(userIdPath(), "utf-8")).trim();
    return existing || undefined;
  } catch {
    return undefined;
  }
}

async function persistUserId(userId: string): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(userIdPath(), `${userId}\n`, { mode: 0o600 });
}

export async function loadHubConfig(): Promise<HubConfig | null> {
  let url = process.env.CODEZ_HUB_URL;
  if (!url) {
    try {
      const cfg = await loadConfig();
      url = cfg.hubUrl;
    } catch {
      // fall through
    }
  }
  if (!url) url = DEFAULT_HUB_URL;

  // Priority: env var > existing stored token > OAuth flow (only if already provisioned) > token file
  let token = process.env.CODEZ_HUB_TOKEN;

  // Only attempt OAuth flow if we have stored creds; otherwise running
  // `getAccessToken` would trigger an interactive browser login at startup.
  if (!token) {
    const stored = await readStoredAuth();
    if (stored) {
      try {
        token = await getAccessToken();
      } catch (err) {
        console.error("[hub] token refresh failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  if (!token) {
    try {
      token = (await readFile(tokenPath(), "utf-8")).trim();
    } catch {
      return null;
    }
  }

  if (!token) return null;
  return { url, token };
}

async function collectRepos(): Promise<RepoInfo[]> {
  const homeDir = process.env.HOME ?? "/root";
  const searchDirs = [
    join(homeDir, "opz"),
    join(homeDir, "opz", "opzero-sh"),
  ];

  const repos: RepoInfo[] = [];
  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const repoPath = join(dir, entry.name);
        try {
          await stat(join(repoPath, ".git"));
          let remote: string | undefined;
          try {
            const configFile = await readFile(
              join(repoPath, ".git", "config"),
              "utf-8",
            );
            const match = configFile.match(
              /\[remote "origin"\][^[]*url\s*=\s*(.+)/,
            );
            if (match) remote = match[1].trim();
          } catch {}
          repos.push({ path: repoPath, remote });
        } catch {
          // Not a git repo
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }
  return repos;
}

async function collectSessions(pool: SessionPool): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();

  // Live sessions from pool
  for (const proc of pool.list()) {
    seen.add(proc.sessionId);
    sessions.push({
      id: proc.sessionId,
      slug: encodeProjectSlug(proc.cwd),
      status: "live",
    });
  }

  // Recent sessions from disk
  try {
    const projects = await listProjects();
    for (const project of projects.slice(0, 20)) {
      const projectSessions = await listSessionsForProject(project.slug);
      for (const s of projectSessions.slice(0, 10)) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        sessions.push({
          id: s.id,
          slug: project.slug,
          status: "idle",
        });
      }
    }
  } catch {
    // Non-critical: disk scan can fail
  }

  return sessions;
}

export async function getStableMachineId(): Promise<string> {
  const path = machineIdPath();
  try {
    const existing = (await readFile(path, "utf-8")).trim();
    if (existing) return existing;
  } catch {
    // Fall through and create one.
  }

  const machineId = crypto.randomUUID();
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(path, `${machineId}\n`, { mode: 0o600 });
  return machineId;
}

function createCommandHandler(
  _pool: SessionPool,
  config: Config,
): CommandHandler {
  const baseUrl = `http://127.0.0.1:${config.port}`;

  return async (action, params) => {
    switch (action) {
      case "list_projects": {
        const res = await fetch(`${baseUrl}/api/projects`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return { projects: await res.json() as Record<string, unknown>[] };
      }

      case "list_sessions": {
        const slug = params.slug as string;
        const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(slug)}/sessions`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return { sessions: await res.json() as Record<string, unknown>[] };
      }

      case "create_session": {
        const slug = params.slug as string;
        const cwd = (params.cwd as string) ?? undefined;
        const permissionMode = (params.permissionMode as string) ?? undefined;
        const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(slug)}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, permissionMode }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return await res.json() as Record<string, unknown>;
      }

      case "send_prompt": {
        const sessionId = params.sessionId as string;
        const prompt = params.prompt as string;
        const slug = params.slug as string | undefined;
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt, slug }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return await res.json() as Record<string, unknown>;
      }

      case "get_session": {
        const sessionId = params.sessionId as string;
        const slug = params.slug as string | undefined;
        const qs = slug ? `?slug=${encodeURIComponent(slug)}` : "";
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}${qs}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return await res.json() as Record<string, unknown>;
      }

      case "abort_session": {
        const sessionId = params.sessionId as string;
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return { ok: true };
      }

      case "dispose_session": {
        const sessionId = params.sessionId as string;
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 204) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return { ok: true };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  };
}

function shouldRefreshSessions(event: { type: string }): boolean {
  return event.type === "session.created" || event.type === "session.updated" || event.type === "session.idle";
}

export async function startHubAgent(
  hubConfig: HubConfig | null,
  appConfig: Config,
  pool: SessionPool,
  bus: EventBus,
): Promise<HubMachineAgent | null> {
  if (!hubConfig || !hubConfig.url || !hubConfig.token) {
    console.warn("[hub] skipping — no credentials configured (run 'codez hub login')");
    return null;
  }
  const repos = await collectRepos();
  const sessions = await collectSessions(pool);
  const cpuInfo = cpus();
  const machineId = await getStableMachineId();
  const knownUserId = await readKnownUserId();

  const wakeUrl = process.env.CODEZ_WAKE_URL;
  const capabilities: Record<string, unknown> = {};
  if (wakeUrl) {
    capabilities.wakeUrl = wakeUrl;
  }

  const agentConfig: HubAgentConfig = {
    hubUrl: hubConfig.url,
    token: hubConfig.token,
    machineId,
    machineInfo: {
      machineId,
      hostname: hostname(),
      os: platform(),
      arch: arch(),
      cpus: cpuInfo.length,
      memoryGB: Math.round(totalmem() / (1024 * 1024 * 1024)),
      codezVersion: "0.1.0",
    },
    repos,
    codezApiUrl: `http://127.0.0.1:${appConfig.port}`,
    onTokenRefresh: createTokenRefresher(),
    onAuthRecovery: createAuthRecovery(),
    ...(knownUserId ? { knownUserId } : {}),
    onUserIdResolved: (userId) => {
      persistUserId(userId).catch((err) => {
        console.error("[hub] failed to persist user_id:", err instanceof Error ? err.message : err);
      });
    },
    onStateChange: (event) => {
      console.log(
        `[hub] state ${event.previous} -> ${event.state} (attempt ${event.attempt}): ${event.reason}`,
      );
    },
    ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
  };

  const handler = createCommandHandler(pool, appConfig);
  const agent = new HubMachineAgent(agentConfig, handler);

  agent.updateSessions(sessions);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  bus.subscribe((event) => {
    if (!shouldRefreshSessions(event)) return;
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      collectSessions(pool)
        .then((nextSessions) => agent.updateSessions(nextSessions))
        .catch((err) => {
          console.error("[hub] failed to refresh sessions:", err instanceof Error ? err.message : err);
        });
    }, 1000);
  });
  await agent.connect();

  console.log("[hub] connected to CodeZ Hub");
  return agent;
}
