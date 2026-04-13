import { homedir } from "os";
import { resolve } from "path";

const STATE_FILE = resolve(homedir(), ".config/opzero-claude/state.json");

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

await loadState();

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