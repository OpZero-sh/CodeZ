import { listProjects, listSessionsForProject } from "../claude/history";
import { claudeProjectsRoot } from "../claude/paths";
// fs/promises removed — stat not used in current impl
import { join } from "path";
import { stateStore } from "../state";

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ResultPart {
  type: "result";
  subtype: "success" | "error";
  costUsd?: number;
  durationMs?: number;
  usage?: Usage;
}

interface JsonlRecord {
  type?: string;
  message?: {
    content?: unknown;
  };
  timestamp?: string;
}

interface DailySnapshot {
  date: string;
  totalCost: number;
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface ObservabilityStats {
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

const CACHE_TTL_MS = 5 * 60 * 1000;
let statsCache: {
  data: ObservabilityStats;
  cachedAt: number;
} | null = null;

async function readJsonlTail(
  filePath: string,
  maxLines: number,
): Promise<string[]> {
  try {
    const file = Bun.file(filePath);
    const size = file.size;
    if (size === 0) return [];

    const chunkSize = 64 * 1024;
    const startPos = Math.max(0, size - chunkSize);
    const slice = file.slice(startPos, size);
    const text = await slice.text();
    const lines = text.split("\n").filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function parseUsageFromRecord(rec: JsonlRecord): { costUsd: number; usage?: Usage } | null {
  if (rec.type !== "result") return null;
  const result = rec as unknown as ResultPart;
  if (result.type !== "result") return null;
  return {
    costUsd: result.costUsd ?? 0,
    usage: result.usage,
  };
}

// getProjectUsage removed — was unused; restore from git if needed

async function computeStats(): Promise<ObservabilityStats> {
  const projects = await listProjects();
  let totalSessions = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const activeProjects: string[] = [];
  const recentActivity: ObservabilityStats["recentActivity"] = [];
  const projectBreakdown: ObservabilityStats["projectBreakdown"] = [];

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  for (const project of projects) {
    totalSessions += project.sessionCount;
    if (project.sessionCount > 0) {
      activeProjects.push(project.slug);
    }

    const sessions = await listSessionsForProject(project.slug);
    let projectCost = 0;
    let projectTokens = 0;
    let lastActive = 0;
    let recentCount = 0;

    for (const session of sessions) {
      const filePath = join(claudeProjectsRoot(), project.slug, `${session.id}.jsonl`);
      const lines = await readJsonlTail(filePath, 100);

      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as JsonlRecord;
          const parsed = parseUsageFromRecord(rec);
          if (parsed) {
            projectCost += parsed.costUsd;
            if (parsed.usage) {
              projectTokens +=
                parsed.usage.input_tokens + parsed.usage.output_tokens;
            }
          }
        } catch {
          continue;
        }
      }

      if (session.updatedAt > lastActive) {
        lastActive = session.updatedAt;
      }
      if (session.updatedAt > oneDayAgo) {
        recentCount++;
      }
    }

    totalCostUsd += projectCost;
    projectBreakdown.push({
      projectName: project.repoName ?? project.slug,
      sessions: project.sessionCount,
      cost: projectCost,
      tokens: projectTokens,
    });

    if (lastActive > sevenDaysAgo) {
      recentActivity.push({
        slug: project.slug,
        sessionCount: project.sessionCount,
        totalCost: projectCost,
        lastActive,
      });
    }
  }

  totalCostUsd = Number(totalCostUsd.toFixed(4));

  projectBreakdown.sort((a, b) => b.cost - a.cost);
  recentActivity.sort((a, b) => b.lastActive - a.lastActive);

  return {
    totalSessions,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    activeProjects,
    recentActivity,
    projectBreakdown,
  };
}

async function takeSnapshot(): Promise<DailySnapshot> {
  const stats = await computeStats();
  const today = new Date().toISOString().split("T")[0];
  return {
    date: today,
    totalCost: stats.totalCostUsd,
    totalSessions: stats.totalSessions,
    totalInputTokens: stats.totalInputTokens,
    totalOutputTokens: stats.totalOutputTokens,
  };
}

export async function observabilityRoutes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "api" || parts[1] !== "observability") {
    return new Response("Not Found", { status: 404 });
  }

  try {
    if (parts.length === 3 && parts[2] === "stats" && req.method === "GET") {
      if (
        statsCache &&
        Date.now() - statsCache.cachedAt < CACHE_TTL_MS
      ) {
        return Response.json(statsCache.data);
      }

      const stats = await computeStats();
      statsCache = { data: stats, cachedAt: Date.now() };
      return Response.json(stats);
    }

    if (parts.length === 3 && parts[2] === "snapshot" && req.method === "POST") {
      const snapshot = await takeSnapshot();
      const state = stateStore.getAll() as {
        observability?: { dailySnapshots?: DailySnapshot[] };
      };
      const obs = state.observability ?? {};
      let snapshots = obs.dailySnapshots ?? [];

      const today = snapshot.date;
      snapshots = snapshots.filter((s) => s.date !== today);
      snapshots.push(snapshot);

      if (snapshots.length > 30) {
        snapshots = snapshots.slice(-30);
      }

      stateStore.set("observability" as keyof typeof state, {
        ...obs,
        dailySnapshots: snapshots,
      });
      await stateStore.save();

      return Response.json(snapshot);
    }

    return new Response("Not Found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export type { ObservabilityStats, DailySnapshot };