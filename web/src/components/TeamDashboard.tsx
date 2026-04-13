import { useEffect, useState } from "react";
import { Bot, ChevronRight, Loader2, X } from "lucide-react";
import { store, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface TeamDashboardProps {
  onClose: () => void;
}

function formatElapsed(startedAt: number): string {
  const secs = Math.max(0, (Date.now() - startedAt) / 1000);
  if (secs < 1) return "<1s";
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function getSessionTitle(state: ReturnType<typeof useStore>, sessionId: string): string {
  for (const [_slug, sessions] of Object.entries(state.sessionsByProject)) {
    for (const session of sessions) {
      if (session.id === sessionId) {
        return session.title || session.id.slice(0, 12);
      }
    }
  }
  return sessionId.slice(0, 12);
}

export default function TeamDashboard({ onClose }: TeamDashboardProps) {
  const state = useStore();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const running = state.runningTasks.filter((t) => t.state === "running");
  const done = state.runningTasks.filter((t) => t.state !== "running");

  function handleTaskClick(sessionId: string) {
    for (const [slug, sessions] of Object.entries(state.sessionsByProject)) {
      for (const session of sessions) {
        if (session.id === sessionId) {
          store.openSession(slug, sessionId);
          onClose();
          return;
        }
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Fleet</span>
          {running.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#00F5FF]">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {running.length} running
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground"
          aria-label="Close team dashboard"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {state.runningTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <Bot className="h-8 w-8 opacity-30" />
            <p className="text-xs">No active tasks across sessions</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {running.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2 px-1">
                  Running ({running.length})
                </div>
                {running.map((task) => {
                  const title = getSessionTitle(state, task.sessionId);
                  return (
                    <button
                      key={task.partId}
                      type="button"
                      onClick={() => handleTaskClick(task.sessionId)}
                      className="w-full text-left rounded-lg border border-border border-l-4 border-l-[#00F5FF] bg-card/80 p-3 mb-2 hover:bg-secondary/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#00F5FF]/40 bg-[#00F5FF]/10">
                          <Bot className="h-3 w-3 text-[#00F5FF]" />
                        </div>
                        <span className="truncate rounded bg-[#00F5FF]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF]">
                          {task.subagentType}
                        </span>
                        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-[#00F5FF]">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          {formatElapsed(task.startedAt)}
                        </span>
                      </div>
                      {task.description && (
                        <div className="mb-1 text-xs text-foreground line-clamp-2 pl-7">
                          {task.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1 pl-7 text-[10px] text-muted-foreground">
                        <ChevronRight className="h-2.5 w-2.5" />
                        <span className="truncate">{title}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {done.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2 px-1">
                  Completed ({done.length})
                </div>
                {done.map((task) => {
                  const title = getSessionTitle(state, task.sessionId);
                  return (
                    <button
                      key={task.partId}
                      type="button"
                      onClick={() => handleTaskClick(task.sessionId)}
                      className="w-full text-left rounded-lg border border-border/40 bg-card/40 p-2 mb-1.5 hover:bg-secondary/20 transition-colors opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/40 bg-muted/20">
                          <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                        </div>
                        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {task.subagentType}
                        </span>
                        <span
                          className={cn(
                            "ml-auto font-mono text-[10px] uppercase",
                            task.state === "error" ? "text-destructive" : "text-[#00F5FF]/60",
                          )}
                        >
                          {task.state}
                        </span>
                        <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-[10px] text-muted-foreground">{title}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
