import { hostname, arch, cpus, totalmem, platform } from "node:os";
import { readdir, stat, readFile } from "node:fs/promises";
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
import { listProjects, listSessionsForProject } from "./claude/history";
import type { Config } from "./config";
import { loadConfig, getConfigDir } from "./config";
import { getAccessToken, createTokenRefresher, readStoredAuth } from "./hub-auth";

const DEFAULT_HUB_URL = "https://code.open0p.com";

export interface HubConfig {
  url: string;
  token: string;
}

function tokenPath(): string {
  return join(getConfigDir(), "hub-token");
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
      slug: "",
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

function createCommandHandler(
  _pool: SessionPool,
  config: Config,
): CommandHandler {
  const baseUrl = `http://127.0.0.1:${config.port}`;

  return async (action, params) => {
    switch (action) {
      case "create_session": {
        const slug = params.slug as string;
        const cwd = (params.cwd as string) ?? undefined;
        const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(slug)}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
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

function generateMachineId(): string {
  const host = hostname();
  const plat = platform();
  return `${host}-${plat}-${arch()}`;
}

export async function startHubAgent(
  hubConfig: HubConfig | null,
  appConfig: Config,
  pool: SessionPool,
  _bus: EventBus,
): Promise<HubMachineAgent | null> {
  if (!hubConfig || !hubConfig.url || !hubConfig.token) {
    console.warn("[hub] skipping — no credentials configured (run 'codez hub login')");
    return null;
  }
  const repos = await collectRepos();
  const sessions = await collectSessions(pool);
  const cpuInfo = cpus();

  const agentConfig: HubAgentConfig = {
    hubUrl: hubConfig.url,
    token: hubConfig.token,
    machineId: generateMachineId(),
    machineInfo: {
      machineId: generateMachineId(),
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
  };

  const handler = createCommandHandler(pool, appConfig);
  const agent = new HubMachineAgent(agentConfig, handler);

  agent.updateSessions(sessions);
  await agent.connect();

  console.log("[hub] connected to CodeZ Hub");
  return agent;
}
