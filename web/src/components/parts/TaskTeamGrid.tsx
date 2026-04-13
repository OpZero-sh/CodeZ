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

interface TaskTeamGridProps {
  parts: ToolUsePart[];
}

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

function MiniStatus({ part }: { part: ToolUsePart }) {
  if (part.state === "running") {
    return (
      <div className="flex items-center gap-1 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-[#00F5FF]">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        <span>run</span>
      </div>
    );
  }
  if (part.state === "error") {
    return (
      <div className="flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-destructive">
        <AlertTriangle className="h-2.5 w-2.5" />
        <span>fail</span>
      </div>
    );
  }
  const elapsed = formatElapsed(part);
  return (
    <div className="flex items-center gap-1 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-[#00F5FF]">
      <CheckCircle2 className="h-2.5 w-2.5" />
      <span>{elapsed ?? "done"}</span>
    </div>
  );
}

function SyncedDot({ state }: { state: ToolUsePart["state"] }) {
  if (state === "error") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />;
  }
  if (state === "completed") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00F5FF]" />;
  }
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00F5FF]/60"
        style={{ animationDuration: "1.4s" }}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00F5FF] shadow-[0_0_6px_rgba(0,245,255,0.8)]" />
    </span>
  );
}

function TeamCell({ part }: { part: ToolUsePart }) {
  const [open, setOpen] = useState(false);
  const input = part.input ?? {};
  const subagent: string = input.subagent_type ?? "general-purpose";
  const description: string = input.description ?? "";
  const prompt: string = input.prompt ?? "";
  const running = part.state === "running";
  const errored = part.state === "error";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border border-border border-l-4 border-l-accent bg-card/80 p-3 card-glow transition-colors",
        running && "ring-1 ring-[#00F5FF]/20",
        errored && "border-l-destructive",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/15 text-accent",
            running && "animate-pulse",
          )}
        >
          <Bot className="h-3.5 w-3.5" />
        </div>
        <SyncedDot state={part.state} />
        <span className="truncate rounded bg-[#00F5FF]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF]">
          {subagent}
        </span>
        <div className="ml-auto">
          <MiniStatus part={part} />
        </div>
      </div>

      {description ? (
        <div className="mb-2 line-clamp-2 text-xs font-medium text-foreground sm:text-sm">
          {description}
        </div>
      ) : null}

      {prompt || part.resultText || errored ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-[#00F5FF]"
        >
          {open ? (
            <ChevronDown className="h-2.5 w-2.5" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5" />
          )}
          <span>{open ? "Hide details" : "Details"}</span>
        </button>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-2">
          {prompt ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                Prompt
              </div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/40 bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
                {prompt}
              </div>
            </div>
          ) : null}
          {errored ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
              <div className="mb-1 flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                <span className="font-mono text-[9px] uppercase tracking-wide text-destructive">
                  Error
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-destructive/90">
                {part.resultText ||
                  (typeof part.result === "string" ? part.result : "Subagent failed")}
              </pre>
            </div>
          ) : part.resultText ? (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5 text-accent" />
                <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                  Result
                </span>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
                {part.resultText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function TaskTeamGrid({ parts }: TaskTeamGridProps) {
  const count = parts.length;
  const runningCount = parts.filter((p) => p.state === "running").length;
  const errorCount = parts.filter((p) => p.state === "error").length;
  const doneCount = parts.filter((p) => p.state === "completed").length;

  return (
    <div className="my-2 space-y-2">
      {count >= 2 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1">
            <Bot className="h-3 w-3 text-accent" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-accent">
              Team &middot; {count}
            </span>
          </div>
          {runningCount > 0 ? (
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF]">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              <span>{runningCount} running</span>
            </div>
          ) : null}
          {doneCount > 0 ? (
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF]/80">
              <CheckCircle2 className="h-2.5 w-2.5" />
              <span>{doneCount} done</span>
            </div>
          ) : null}
          {errorCount > 0 ? (
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              <span>{errorCount} failed</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {parts.map((part) => (
          <TeamCell key={part.id} part={part} />
        ))}
      </div>
    </div>
  );
}
