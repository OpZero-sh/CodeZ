import { useEffect, useState } from "react";
import { X, BarChart3, Activity, DollarSign, Zap, TrendingUp } from "lucide-react";
import { api, ObservabilityStats, DailySnapshot } from "@/lib/api";

interface ObservabilityPanelProps {
  onClose: () => void;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ObservabilityPanel({ onClose }: ObservabilityPanelProps) {
  const [stats, setStats] = useState<ObservabilityStats | null>(null);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [statsData, stateData] = await Promise.all([
          api.getObservabilityStats(),
          api.getState(),
        ]);
        setStats(statsData);
        const obs = (stateData as { observability?: { dailySnapshots?: DailySnapshot[] } }).observability;
        setSnapshots(obs?.dailySnapshots ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const totalTokens = stats
    ? stats.totalInputTokens + stats.totalOutputTokens
    : 0;
  const liveSessions: number = 0;

  const recentSnapshots = snapshots.slice(-7);
  const maxCost = Math.max(
    ...recentSnapshots.map((s) => s.totalCost),
    0.01,
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Observability</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-xs">Loading...</div>
          </div>
        ) : error ? (
          <div className="text-center text-destructive text-sm">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Activity className="h-3 w-3" />
                  Sessions
                </div>
                <div className="text-lg font-semibold">
                  {stats?.totalSessions ?? 0}
                </div>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <DollarSign className="h-3 w-3" />
                  Cost
                </div>
                <div className="text-lg font-semibold">
                  {formatCost(stats?.totalCostUsd ?? 0)}
                </div>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3" />
                  Tokens
                </div>
                <div className="text-lg font-semibold">
                  {formatTokens(totalTokens)}
                </div>
              </div>
            </div>

            {liveSessions > 0 && (
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Zap className="h-3 w-3 text-primary" />
                  Fleet Pulse
                </div>
                <div className="text-sm">
                  <span className="text-primary font-semibold">
                    {liveSessions}
                  </span>{" "}
                  live session{liveSessions !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {recentSnapshots.length > 0 && (
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <TrendingUp className="h-3 w-3" />
                  Cost Over Time
                </div>
                <div className="flex items-end gap-0.5 h-16">
                  {recentSnapshots.map((s) => {
                    const height = maxCost > 0 ? (s.totalCost / maxCost) * 100 : 0;
                    return (
                      <div
                        key={s.date}
                        className="flex-1 flex flex-col items-center gap-1"
                      >
                        <div
                          className="w-full bg-primary/70 rounded-t"
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <div className="text-[8px] text-muted-foreground rotate-45">
                          {formatDate(s.date)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {stats && stats.projectBreakdown.length > 0 && (
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <BarChart3 className="h-3 w-3" />
                  Top Projects
                </div>
                <div className="space-y-2">
                  {stats.projectBreakdown.slice(0, 5).map((p) => (
                    <div
                      key={p.projectName}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="truncate flex-1 min-w-0">
                        {p.projectName}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-muted-foreground">
                          {p.sessions}
                        </span>
                        <span className="font-mono">
                          {formatCost(p.cost)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats && stats.recentActivity.length > 0 && (
              <div className="bg-secondary/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Activity className="h-3 w-3" />
                  Activity
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active projects</span>
                    <span>{stats.activeProjects.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Updated (7d)</span>
                    <span>{stats.recentActivity.length}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}