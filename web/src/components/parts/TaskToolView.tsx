import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { ToolUsePart } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatElapsed(part: ToolUsePart): string | null {
  const start = part.time?.start;
  const end = part.time?.end ?? (part.state === "running" ? Date.now() : undefined);
  if (!start || !end) return null;
  const secs = Math.max(0, (end - start) / 1000);
  if (secs < 1) return `${Math.round(secs * 1000)}ms`;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function StatusPill({ part }: { part: ToolUsePart }) {
  const elapsed = formatElapsed(part);
  if (part.state === "running") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[#00F5FF]">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>dispatching</span>
      </div>
    );
  }
  if (part.state === "error") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-destructive">
        <AlertTriangle className="h-3 w-3" />
        <span>failed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[#00F5FF]">
      <CheckCircle2 className="h-3 w-3" />
      <span>{elapsed ?? "done"}</span>
    </div>
  );
}

function RadarDot() {
  return (
    <span className="pointer-events-none absolute right-3 top-3 flex h-3 w-3 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00F5FF]/60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00F5FF] shadow-[0_0_8px_rgba(0,245,255,0.9)]" />
    </span>
  );
}

function ResultBlock({ text }: { text: string }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 500;
  const needsTruncate = text.length > LIMIT;
  const display = showAll || !needsTruncate ? text : text.slice(0, LIMIT) + "...";
  return (
    <div className="mt-3 border-t border-border/40 pt-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Result
        </span>
      </div>
      <div className="rounded-md border border-border/40 bg-background/40 p-3">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
          {display}
        </pre>
        {needsTruncate ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF] hover:underline"
          >
            {showAll ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TaskToolView({ part }: { part: ToolUsePart }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const input = part.input ?? {};
  const subagent: string = input.subagent_type ?? "general-purpose";
  const description: string = input.description ?? "";
  const prompt: string = input.prompt ?? "";
  const running = part.state === "running";
  const errored = part.state === "error";
  const errorText =
    errored && (part.resultText || (typeof part.result === "string" ? part.result : ""));

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border border-l-4 border-l-accent bg-card/80 p-4 card-glow",
        running && "animate-pulse ring-1 ring-[#00F5FF]/20",
      )}
    >
      {running ? <RadarDot /> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/15 text-accent",
            running && "animate-pulse",
          )}
        >
          <Bot className="h-4 w-4" />
        </div>
        <span className="rounded bg-[#00F5FF]/15 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-[#00F5FF]">
          {subagent}
        </span>
        <div className="ml-auto flex items-center gap-2 pr-5">
          <StatusPill part={part} />
        </div>
      </div>

      {description ? (
        <div className="mb-3 line-clamp-2 text-sm font-medium text-foreground">
          {description}
        </div>
      ) : null}

      {prompt ? (
        <div>
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-[#00F5FF]"
          >
            {promptOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>{promptOpen ? "Hide prompt" : "View prompt"}</span>
          </button>
          {promptOpen ? (
            <div className="mt-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border/40 bg-background/40 p-3 font-mono text-xs text-muted-foreground">
              {prompt}
            </div>
          ) : null}
        </div>
      ) : null}

      {errored ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-destructive">
              Error
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive/90">
            {errorText || "Subagent failed"}
          </pre>
        </div>
      ) : null}

      {!errored && part.resultText ? <ResultBlock text={part.resultText} /> : null}
    </div>
  );
}

export default TaskToolView;
