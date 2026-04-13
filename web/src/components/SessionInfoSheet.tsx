import * as React from "react";
import {
  Check,
  Copy,
  DollarSign,
  FileText,
  FolderOpen,
  Hash,
  Plug,
  Server,
  Settings2,
  Sparkles,
  Terminal,
  Users,
  Wand2,
  Wrench,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { api, type MemoryFile } from "@/lib/api";
import type { Session, SessionStatus } from "@/lib/types";

export interface SessionInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTimestamp(ms?: number): string {
  if (!ms) return "unknown";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "unknown";
  }
}

function formatRelative(ms?: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }
      }}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/40 bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary",
        className,
      )}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function StatusChip({ status }: { status: SessionStatus }) {
  const styles: Record<SessionStatus, string> = {
    live: "bg-primary/10 text-primary border-primary/40",
    mirror: "bg-accent/10 text-accent border-accent/40",
    idle: "bg-secondary/40 text-muted-foreground border-border/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        styles[status],
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "live" && "bg-primary animate-pulse shadow-[0_0_6px_hsl(var(--primary))]",
          status === "mirror" && "bg-accent",
          status === "idle" && "bg-muted-foreground/60",
        )}
      />
      {status}
    </span>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/40 bg-secondary/40 px-2 py-0.5 font-mono text-[11px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function McpStatusChip({ name, status }: { name: string; status: string }) {
  const s = status.toLowerCase();
  const connected =
    s === "connected" || s === "ok" || s === "ready" || s === "healthy";
  const needsAuth =
    s === "needs-auth" ||
    s === "needs_auth" ||
    s === "unauthorized" ||
    s === "auth-required" ||
    s === "needsauth";
  const failing =
    s === "error" || s === "failed" || s === "disconnected" || s === "down";

  const tone = connected
    ? "border-primary/40 bg-primary/10 text-primary"
    : needsAuth
      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
      : failing
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border/40 bg-secondary/40 text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-background/40 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-[11px] text-foreground">
          {name}
        </span>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
          tone,
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected && "bg-primary animate-pulse",
            needsAuth && "bg-amber-300",
            failing && "bg-destructive",
            !connected && !needsAuth && !failing && "bg-muted-foreground/60",
          )}
        />
        {status}
      </span>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass-border rounded-lg border border-border/40 bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-primary/80" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  copyValue,
  truncate,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  copyValue?: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "text-[12px] text-foreground",
            mono && "font-mono text-[11px]",
            truncate && "truncate",
          )}
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </span>
        {copyValue && <CopyButton value={copyValue} />}
      </div>
    </div>
  );
}

function ChipList({
  items,
  prefix,
  empty = "none",
}: {
  items?: string[];
  prefix?: string;
  empty?: string;
}) {
  if (!items || items.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground/70">{empty}</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Chip key={item}>
          {prefix}
          {item}
        </Chip>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="rounded-full border border-border/40 bg-secondary/40 p-3">
        <Terminal className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">No session selected</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Select a session from the sidebar to see its runtime details, tools,
        and connected MCP servers.
      </p>
    </div>
  );
}

export function SessionInfoSheet({
  open,
  onOpenChange,
}: SessionInfoSheetProps) {
  const state = useStore();
  const session: Session | null =
    state.selected.slug && state.selected.sessionId
      ? ((state.sessionsByProject[state.selected.slug] ?? []).find(
          (s) => s.id === state.selected.sessionId,
        ) ?? null)
      : null;

  const messages = session ? (state.messages[session.id] ?? []) : [];
  const messageCount = messages.length;

  const meta = session?.metadata;

  const [memory, setMemory] = React.useState<MemoryFile[] | null>(null);
  const [memoryLoading, setMemoryLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !session?.projectSlug) {
      setMemory(null);
      return;
    }
    setMemoryLoading(true);
    api
      .getMemory(session.projectSlug)
      .then((data) => {
        setMemory(data);
        setMemoryLoading(false);
      })
      .catch(() => {
        setMemory(null);
        setMemoryLoading(false);
      });
  }, [open, session?.projectSlug]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col p-0 sm:max-h-[80vh]"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          aria-hidden
        />
        <SheetHeader className="border-b border-border/40 px-5 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,245,255,0.25)]">
              <Sparkles className="h-3 w-3" />
            </span>
            <SheetTitle className="gradient-text text-base">
              Session Info
            </SheetTitle>
            {session && <StatusChip status={session.status} />}
          </div>
          <SheetDescription className="truncate pr-8">
            {session?.title ?? "Details about the currently selected session"}
          </SheetDescription>
        </SheetHeader>

        {!session ? (
          <EmptyState />
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <SectionCard icon={Hash} title="Identity">
              <div className="space-y-0.5">
                <Row
                  label="session id"
                  value={
                    <span className="truncate">{session.id.slice(0, 18)}…</span>
                  }
                  mono
                  truncate
                  copyValue={session.id}
                />
                <Row label="project" value={session.projectSlug} mono />
                <Row
                  label="created"
                  value={`${formatTimestamp(session.createdAt)} · ${formatRelative(session.createdAt)}`}
                />
                <Row
                  label="updated"
                  value={`${formatTimestamp(session.updatedAt)} · ${formatRelative(session.updatedAt)}`}
                />
                {session.lastMessageAt ? (
                  <Row
                    label="last message"
                    value={formatRelative(session.lastMessageAt)}
                  />
                ) : null}
              </div>
            </SectionCard>

            <SectionCard icon={Settings2} title="Runtime">
              <div className="space-y-0.5">
                <div className="flex items-start justify-between gap-3 py-1">
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    cwd
                  </span>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span
                      className="truncate font-mono text-[11px] text-foreground"
                      title={session.cwd}
                    >
                      {session.cwd}
                    </span>
                    <CopyButton value={session.cwd} />
                  </div>
                </div>
                <Row
                  label="model"
                  value={meta?.model ?? "(not captured)"}
                  mono
                />
                <Row
                  label="permission mode"
                  value={meta?.permissionMode ?? "(not captured)"}
                  mono
                />
                <Row
                  label="output style"
                  value={meta?.outputStyle ?? "(not captured)"}
                  mono
                />
                <Row
                  label="claude code"
                  value={meta?.claudeCodeVersion ?? "(not captured)"}
                  mono
                />
              </div>
            </SectionCard>

            <SectionCard
              icon={Wrench}
              title="Tools"
              action={
                meta?.tools?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    {meta.tools.length}
                  </span>
                ) : null
              }
            >
              <ChipList items={meta?.tools} empty="no tools captured" />
            </SectionCard>

            <SectionCard
              icon={Users}
              title="Agents"
              action={
                meta?.agents?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    {meta.agents.length}
                  </span>
                ) : null
              }
            >
              <ChipList items={meta?.agents} empty="no subagents" />
            </SectionCard>

            <SectionCard
              icon={Wand2}
              title="Skills"
              action={
                meta?.skills?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    {meta.skills.length}
                  </span>
                ) : null
              }
            >
              <ChipList items={meta?.skills} prefix="/" empty="no skills" />
            </SectionCard>

            {meta?.slashCommands && meta.slashCommands.length > 0 && (
              <SectionCard
                icon={Terminal}
                title="Slash commands"
                action={
                  <span className="text-[10px] text-muted-foreground">
                    {meta.slashCommands.length}
                  </span>
                }
              >
                <ChipList items={meta.slashCommands} prefix="/" />
              </SectionCard>
            )}

            <SectionCard
              icon={Plug}
              title="Plugins"
              action={
                meta?.plugins?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    {meta.plugins.length}
                  </span>
                ) : null
              }
            >
              <ChipList items={meta?.plugins} empty="none" />
            </SectionCard>

            <SectionCard
              icon={Server}
              title="MCP servers"
              action={
                meta?.mcpServers?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    {meta.mcpServers.length}
                  </span>
                ) : null
              }
            >
              {meta?.mcpServers && meta.mcpServers.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {meta.mcpServers.map((s) => (
                    <McpStatusChip
                      key={s.name}
                      name={s.name}
                      status={s.status}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] italic text-muted-foreground/70">
                  no mcp servers connected
                </p>
              )}
            </SectionCard>

            <SectionCard icon={DollarSign} title="Usage">
              <div className="space-y-0.5">
                <Row label="messages" value={messageCount} mono />
                <Row
                  label="turns"
                  value={state.usageTotals[session.id]?.turnCount ?? 0}
                  mono
                />
                <Row
                  label="total cost"
                  value={
                    state.usageTotals[session.id]?.totalCostUsd != null
                      ? `$${state.usageTotals[session.id].totalCostUsd.toFixed(4)}`
                      : "$0.0000"
                  }
                  mono
                />
                <Row
                  label="input tokens"
                  value={
                    state.usageTotals[session.id]?.totalInputTokens != null
                      ? state.usageTotals[session.id].totalInputTokens.toLocaleString()
                      : "0"
                  }
                  mono
                />
                <Row
                  label="output tokens"
                  value={
                    state.usageTotals[session.id]?.totalOutputTokens != null
                      ? state.usageTotals[session.id].totalOutputTokens.toLocaleString()
                      : "0"
                  }
                  mono
                />
                <Row
                  label="total duration"
                  value={
                    state.usageTotals[session.id]?.totalDurationMs != null
                      ? `${(state.usageTotals[session.id].totalDurationMs / 1000).toFixed(1)}s`
                      : "0s"
                  }
                  mono
                />
                <p className="pt-1 text-[10px] italic text-muted-foreground/60">
                  {session.status === "live"
                    ? "(live session)"
                    : "(mirror session — no usage data)"}
                </p>
              </div>
            </SectionCard>

            <SectionCard icon={FileText} title="Memory">
              {memoryLoading ? (
                <p className="text-[11px] italic text-muted-foreground/70">
                  loading...
                </p>
              ) : memory && memory.length > 0 ? (
                <div className="space-y-2">
                  {memory.map((f) => (
                    <div
                      key={f.filename}
                      className="rounded border border-border/30 bg-background/40 p-2"
                    >
                      <div className="mb-1 font-mono text-[10px] text-primary/80">
                        {f.filename}
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                        {f.content}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] italic text-muted-foreground/70">
                  (no memory files)
                </p>
              )}
            </SectionCard>

            <div className="h-2" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default SessionInfoSheet;
