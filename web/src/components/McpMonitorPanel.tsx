import { useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

interface McpServer {
  name: string;
  command: string;
  args: string[];
}

interface McpMetric {
  name: string;
  totalCalls: number;
  errorCount: number;
  avgLatencyMs: number;
  lastSeen: number;
}

function ErrorBar({ rate }: { rate: number }) {
  const color =
    rate < 5 ? "bg-green-500" : rate < 20 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
      <div className={color} style={{ width: `${Math.min(rate, 100)}%` }} />
    </div>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
      <h2 className="font-semibold text-sm">MCP Monitor</h2>
      <button
        type="button"
        onClick={onClose}
        className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ActiveCalls() {
  const state = useStore();
  const [, setTick] = useState(0);
  const active = state.mcpCalls.filter((c) => c.state === "running");
  const recent = state.mcpCalls
    .filter((c) => c.state !== "running")
    .slice(-10)
    .reverse();

  useEffect(() => {
    if (active.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [active.length]);

  if (active.length === 0 && recent.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No MCP tool calls recorded yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {active.map((c) => (
        <div
          key={c.callId}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-400/10 border border-amber-400/20 text-xs"
        >
          <Loader2 className="h-3 w-3 animate-spin text-amber-400 shrink-0" />
          <span className="font-mono truncate">{c.tool}</span>
          <span className="text-muted-foreground ml-auto shrink-0">
            {c.clientId} &middot; {formatElapsed(c.startedAt)}
          </span>
        </div>
      ))}
      {recent.map((c) => (
        <div
          key={c.callId}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 text-xs"
        >
          {c.state === "error" ? (
            <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          )}
          <span className="font-mono truncate">{c.tool}</span>
          <span className="text-muted-foreground ml-auto shrink-0">
            {c.clientId}
            {c.durationMs != null && <> &middot; {c.durationMs}ms</>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function McpMonitorPanel({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [metrics, setMetrics] = useState<McpMetric[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [srv, met] = await Promise.all([
        api.getMcpServers(),
        api.getMcpMetrics(),
      ]);
      setServers(srv.servers);
      setMetrics(met.metrics);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader onClose={onClose} />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Active Calls
            </h3>
            <ActiveCalls />
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Servers
            </h3>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="h-7 px-2 flex items-center gap-1.5 text-xs rounded-md hover:bg-secondary/50 text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {servers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No MCP servers configured
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Command</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {servers.map((srv) => (
                    <tr key={srv.name}>
                      <td className="px-3 py-2 font-mono">{srv.name}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                        {srv.command}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Live Metrics
            </h3>

            {metrics.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No metrics recorded yet
              </p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Server</th>
                      <th className="text-left px-3 py-2 font-medium">Calls</th>
                      <th className="text-left px-3 py-2 font-medium">Errors</th>
                      <th className="text-left px-3 py-2 font-medium">Latency</th>
                      <th className="text-left px-3 py-2 font-medium">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {metrics.map((m) => {
                      const errorRate =
                        m.totalCalls > 0
                          ? (m.errorCount / m.totalCalls) * 100
                          : 0;
                      const colorClass =
                        errorRate < 5
                          ? "text-green-500"
                          : errorRate < 20
                            ? "text-yellow-500"
                            : "text-red-500";
                      const lastSeenStr = m.lastSeen
                        ? new Date(m.lastSeen).toLocaleTimeString()
                        : "-";
                      return (
                        <tr key={m.name}>
                          <td className="px-3 py-2 font-mono">{m.name}</td>
                          <td className="px-3 py-2">{m.totalCalls}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <ErrorBar rate={errorRate} />
                              <span className={colorClass}>
                                {errorRate.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {m.avgLatencyMs > 0
                              ? `${m.avgLatencyMs.toFixed(0)}ms`
                              : "-"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {lastSeenStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}