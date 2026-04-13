import type { ResultPart, Usage } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

function formatCost(usd?: number): string {
  if (usd == null) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ResultPartView({ part }: { part: ResultPart }) {
  const variant = part.subtype === "error" ? "destructive" : "default";
  const cost = formatCost(part.costUsd);
  const duration = formatDuration(part.durationMs);
  const usage: Usage | undefined = part.usage;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;

  return (
    <div className="my-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {cost ? (
        <Badge variant={variant} className="font-mono">
          {cost}
        </Badge>
      ) : null}
      {duration ? (
        <Badge variant={variant} className="font-mono">
          {duration}
        </Badge>
      ) : null}
      {inputTokens != null ? (
        <span className="font-mono">in {inputTokens}</span>
      ) : null}
      {outputTokens != null ? (
        <span className="font-mono">out {outputTokens}</span>
      ) : null}
    </div>
  );
}
