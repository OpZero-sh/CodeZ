interface McpMetric {
  totalCalls: number;
  errorCount: number;
  totalLatencyMs: number;
  lastSeen: number;
}

const metrics = new Map<string, McpMetric>();

export function recordMcpCall(
  name: string,
  latencyMs: number,
  error: boolean,
): void {
  const existing = metrics.get(name) ?? {
    totalCalls: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    lastSeen: 0,
  };
  existing.totalCalls += 1;
  existing.totalLatencyMs += latencyMs;
  if (error) existing.errorCount += 1;
  existing.lastSeen = Date.now();
  metrics.set(name, existing);
}

export interface McpMetricOutput {
  name: string;
  totalCalls: number;
  errorCount: number;
  avgLatencyMs: number;
  lastSeen: number;
}

export function getMcpMetrics(): McpMetricOutput[] {
  const out: McpMetricOutput[] = [];
  for (const [name, m] of metrics) {
    out.push({
      name,
      totalCalls: m.totalCalls,
      errorCount: m.errorCount,
      avgLatencyMs: m.totalCalls > 0 ? m.totalLatencyMs / m.totalCalls : 0,
      lastSeen: m.lastSeen,
    });
  }
  return out.sort((a, b) => b.totalCalls - a.totalCalls);
}