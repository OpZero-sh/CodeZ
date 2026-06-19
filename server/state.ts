import { join } from "path";
import { readdir, stat } from "fs/promises";
import { getConfigDir } from "./config";
import { claudeProjectsRoot } from "./claude/paths";

const STATE_FILE = join(getConfigDir(), "state.json");

interface ObservabilityState {
  dailySnapshots: Array<{
    date: string;
    totalCost: number;
    totalSessions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>;
}

interface State {
  markers: Record<string, Marker[]>;
  preferences: Record<string, unknown>;
  recentCwds: string[];
  observability?: ObservabilityState;
}

interface Marker {
  id: string;
  sessionId: string;
  messageId: string;
  partId?: string;
  label?: string;
  note?: string;
  createdAt: number;
  resolved?: boolean;
}

let state: State = {
  markers: {},
  preferences: {},
  recentCwds: [],
};

async function loadState(): Promise<void> {
  const file = Bun.file(STATE_FILE);
  const exists = await file.exists();
  if (exists) {
    try {
      const data = await file.json();
      state = {
        markers: data.markers ?? {},
        preferences: data.preferences ?? {},
        recentCwds: data.recentCwds ?? [],
        observability: data.observability ?? { dailySnapshots: [] },
      };
    } catch {
      state = { markers: {}, preferences: {}, recentCwds: [], observability: { dailySnapshots: [] } };
    }
  }
}

async function saveState(): Promise<void> {
  const file = Bun.file(STATE_FILE);
  await file.write(JSON.stringify(state, null, 2));
}

function get<T>(key: keyof State): T {
  return state[key] as T;
}

function set<K extends keyof State>(key: K, value: State[K]): void {
  state[key] = value;
}

async function seedRecentCwds(): Promise<void> {
  if (state.recentCwds.length > 0) return;
  const projectsRoot = claudeProjectsRoot();
  try {
    const slugs = await readdir(projectsRoot);
    const cwds = new Set<string>();
    for (const slug of slugs) {
      if (!slug.startsWith("-")) continue;
      const dir = join(projectsRoot, slug);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch { continue; }
      const jsonl = files.filter((f) => f.endsWith(".jsonl"));
      if (jsonl.length === 0) continue;
      // Read cwd from the most recent JSONL
      const sorted = await Promise.all(
        jsonl.slice(0, 5).map(async (f) => {
          const p = join(dir, f);
          const s = await stat(p).catch(() => null);
          return { path: p, mtime: s?.mtimeMs ?? 0 };
        }),
      );
      sorted.sort((a, b) => b.mtime - a.mtime);
      for (const { path: filePath } of sorted.slice(0, 1)) {
        try {
          const file = Bun.file(filePath);
          const head = await file.slice(0, 4096).text();
          for (const line of head.split("\n")) {
            if (!line) continue;
            try {
              const rec = JSON.parse(line);
              if (typeof rec.cwd === "string" && rec.cwd.startsWith("/")) {
                cwds.add(rec.cwd);
                break;
              }
            } catch { continue; }
          }
        } catch { continue; }
      }
      if (cwds.size >= 20) break;
    }
    if (cwds.size > 0) {
      state.recentCwds = Array.from(cwds).slice(0, 20);
      await saveState();
    }
  } catch {}
}

await loadState();
await seedRecentCwds();

export const stateStore = {
  get,
  set,
  save: saveState,
  getAll: () => state,
};

export type { Marker, State };

export interface ProjectCacheEntry {
  repoName: string;
  projectSlug: string;
  cachedAt: number;
}

export const projectCache: Record<string, ProjectCacheEntry> = {};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getCachedRepo(absPath: string): ProjectCacheEntry | null {
  const entry = projectCache[absPath];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    delete projectCache[absPath];
    return null;
  }
  return entry;
}

export function setCachedRepo(
  absPath: string,
  repoName: string,
  projectSlug: string,
): void {
  projectCache[absPath] = {
    repoName,
    projectSlug,
    cachedAt: Date.now(),
  };
}