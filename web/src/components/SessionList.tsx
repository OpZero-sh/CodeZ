import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  EyeOff,
  Folder,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { store, useStore } from "@/lib/store";
import type { SidebarSort } from "@/lib/store";
import type { Project, Session } from "@/lib/types";

function slugDisplayName(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length <= 2) return parts.join("/") || slug;
  return parts.slice(-2).join("/");
}

function relTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const SORT_OPTIONS: { value: SidebarSort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "status", label: "Status" },
  { value: "name", label: "Name" },
];

const STATUS_ORDER: Record<string, number> = { live: 0, mirror: 1, idle: 2 };

function sortSessions(sessions: Session[], sort: SidebarSort): Session[] {
  const sorted = [...sessions];
  switch (sort) {
    case "recent":
      sorted.sort(
        (a, b) =>
          (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt),
      );
      break;
    case "status":
      sorted.sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt),
      );
      break;
    case "name":
      sorted.sort((a, b) =>
        (a.title ?? a.id).localeCompare(b.title ?? b.id),
      );
      break;
  }
  return sorted;
}

interface InlineRenameProps {
  sessionId: string;
  currentTitle: string;
  onDone: () => void;
}

function InlineRename({ sessionId, currentTitle, onDone }: InlineRenameProps) {
  const [value, setValue] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentTitle) {
      store.renameSession(sessionId, trimmed);
    }
    onDone();
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onDone();
      }}
      className="w-full text-sm bg-transparent border-b border-primary/60 text-foreground outline-none px-0 py-0"
      maxLength={120}
    />
  );
}

interface SessionRowProps {
  session: Session;
  projectSlug: string;
  active: boolean;
  flashing: boolean;
  onOpen: (slug: string, id: string) => void;
  onDispose: (id: string) => void;
}

function SessionRow({
  session: s,
  projectSlug,
  active,
  flashing,
  onOpen,
  onDispose,
}: SessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const displayTitle = s.title || s.id.slice(0, 8);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-[background-color,border-color,box-shadow] border-l-2",
        flashing &&
          "bg-primary/10 border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.25),0_0_18px_hsl(var(--primary)/0.18)]",
        active
          ? "bg-secondary/60 border-primary"
          : "border-transparent hover:bg-secondary/40",
      )}
      onClick={() => onOpen(projectSlug, s.id)}
    >
      <MessageSquare
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <InlineRename
            sessionId={s.id}
            currentTitle={displayTitle}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <div className="text-sm truncate text-foreground">{displayTitle}</div>
        )}
        <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
          <span className="truncate">
            {relTime(s.lastMessageAt ?? s.updatedAt)}
          </span>
          {s.status === "live" && (
            <span className="inline-flex items-center gap-1 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
              live
            </span>
          )}
          {s.status === "mirror" && (
            <span className="inline-flex items-center gap-1 text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              mirror
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          className="text-muted-foreground hover:text-primary p-0.5"
          aria-label="Rename session"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-destructive p-0.5"
              aria-label="Dispose session"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </DialogTrigger>
          <DialogContent className="glass glass-border">
            <DialogHeader>
              <DialogTitle>Dispose session?</DialogTitle>
              <DialogDescription>
                &ldquo;{displayTitle}&rdquo; will be closed. The JSONL file
                will be kept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Keep
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDispose(s.id);
                }}
              >
                Dispose
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

interface ProjectGroupProps {
  project: Project;
  sessions: Session[];
  flashingSessionIds: Set<string>;
  activeId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (slug: string, id: string) => void;
  onDispose: (id: string) => void;
}

function ProjectGroup({
  project,
  sessions,
  flashingSessionIds,
  activeId,
  expanded,
  onToggle,
  onOpen,
  onDispose,
}: ProjectGroupProps) {
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1 text-left font-semibold min-w-0">
          {project.repoName ?? slugDisplayName(project.slug)}
        </span>
        {project.worktreeLabel && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-secondary/60 text-muted-foreground shrink-0">
            {project.worktreeLabel}
          </span>
        )}
        <span className="text-[10px] opacity-60 shrink-0">
          {sessions.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              projectSlug={project.slug}
              active={s.id === activeId}
              flashing={flashingSessionIds.has(s.id)}
              onOpen={onOpen}
              onDispose={onDispose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NewSessionDialogProps {
  projects: Project[];
  defaultSlug: string | null;
}

function NewSessionDialog({ projects, defaultSlug }: NewSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState<string>(
    defaultSlug ?? projects[0]?.slug ?? "",
  );
  const [cwd, setCwd] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [permissionMode, setPermissionMode] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const selectedProject = projects.find((p) => p.slug === slug);

  function openDialog(next: boolean) {
    setOpen(next);
    if (next) {
      const s = defaultSlug ?? projects[0]?.slug ?? "";
      setSlug(s);
      const p = projects.find((x) => x.slug === s);
      setCwd(p?.path ?? "");
      setModel("");
      setPermissionMode("");
    }
  }

  async function submit() {
    if (!slug) return;
    setBusy(true);
    try {
      await store.createSession(
        slug,
        cwd.trim() || undefined,
        permissionMode || undefined,
      );
    } catch {
      // error surfaces via the global ErrorBanner
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start gap-2 bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>
      </DialogTrigger>
      <DialogContent className="glass glass-border">
        <DialogHeader>
          <DialogTitle className="gradient-text">New Session</DialogTitle>
          <DialogDescription>
            Spawn a fresh Claude Code session in the chosen project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Project
            </label>
            <select
              value={slug}
              onChange={(e) => {
                const v = e.target.value;
                setSlug(v);
                const p = projects.find((x) => x.slug === v);
                if (p) setCwd(p.path);
              }}
              className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.repoName ?? p.slug}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Working directory
            </label>
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={selectedProject?.path ?? "/path/to/project"}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Model (optional)
            </label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="leave blank for default"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Permission mode (optional)
            </label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Default</option>
              <option value="acceptedits">Accept Edits</option>
              <option value="auto">Auto</option>
              <option value="bypassPermissions">Bypass Permissions</option>
              <option value="dontAsk">Don&apos;t Ask</option>
              <option value="plan">Plan</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !slug}>
            {busy ? "Creating" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortControl() {
  const { sidebarSort, hideEmptyProjects } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded"
        aria-label="Sort sessions"
      >
        <ArrowDownUp className="h-3 w-3" />
        <span className="hidden sm:inline">
          {SORT_OPTIONS.find((o) => o.value === sidebarSort)?.label}
        </span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded-md glass glass-border shadow-lg">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  store.setSidebarSort(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-secondary/40 transition-colors",
                  sidebarSort === opt.value && "text-primary",
                )}
              >
                {sidebarSort === opt.value && (
                  <Check className="h-3 w-3 text-primary" />
                )}
                {sidebarSort !== opt.value && <span className="w-3" />}
                {opt.label}
              </button>
            ))}
            <div className="border-t border-border/40 my-1" />
            <button
              type="button"
              onClick={() => {
                store.setHideEmptyProjects(!hideEmptyProjects);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-secondary/40 transition-colors"
            >
              {hideEmptyProjects ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <span className="w-3" />
              )}
              <EyeOff className="h-3 w-3" />
              Hide empty
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SessionList() {
  const state = useStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [flashingSessionIds, setFlashingSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const previousStatusesRef = useRef<Record<string, Session["status"]>>({});
  const flashTimeoutsRef = useRef<Map<string, number>>(new Map());
  const hydratedRef = useRef(false);

  const grouped = useMemo(() => {
    return state.projects
      .map((p) => ({
        project: p,
        sessions: sortSessions(
          state.sessionsByProject[p.slug] ?? [],
          state.sidebarSort,
        ),
      }))
      .filter(
        (g) => !state.hideEmptyProjects || g.sessions.length > 0,
      );
  }, [
    state.projects,
    state.sessionsByProject,
    state.sidebarSort,
    state.hideEmptyProjects,
  ]);

  useEffect(() => {
    const nextStatuses: Record<string, Session["status"]> = {};
    const sessions = grouped.flatMap(
      ({ sessions: projectSessions }) => projectSessions,
    );

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      for (const session of sessions) {
        nextStatuses[session.id] = session.status;
      }
      previousStatusesRef.current = nextStatuses;
      return;
    }

    for (const session of sessions) {
      nextStatuses[session.id] = session.status;
      if (session.status !== "live") continue;
      if (previousStatusesRef.current[session.id] === "live") continue;

      setFlashingSessionIds((current) => {
        const next = new Set(current);
        next.add(session.id);
        return next;
      });

      const existingTimeout = flashTimeoutsRef.current.get(session.id);
      if (existingTimeout) window.clearTimeout(existingTimeout);
      const timeout = window.setTimeout(() => {
        setFlashingSessionIds((current) => {
          if (!current.has(session.id)) return current;
          const next = new Set(current);
          next.delete(session.id);
          return next;
        });
        flashTimeoutsRef.current.delete(session.id);
      }, 1800);
      flashTimeoutsRef.current.set(session.id, timeout);
    }

    previousStatusesRef.current = nextStatuses;
  }, [grouped]);

  useEffect(() => {
    return () => {
      for (const timeout of flashTimeoutsRef.current.values()) {
        window.clearTimeout(timeout);
      }
      flashTimeoutsRef.current.clear();
    };
  }, []);

  function toggle(slug: string) {
    setCollapsed((c) => ({ ...c, [slug]: !c[slug] }));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2">
        <NewSessionDialog
          projects={state.projects}
          defaultSlug={state.selected.slug}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
            Projects
          </span>
          <SortControl />
        </div>
      </div>
      <ScrollArea className="flex-1 px-2">
        <div className="pb-4">
          {grouped.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No projects yet.
            </div>
          )}
          {grouped.map(({ project, sessions }) => (
            <ProjectGroup
              key={project.slug}
              project={project}
              sessions={sessions}
              flashingSessionIds={flashingSessionIds}
              activeId={state.selected.sessionId}
              expanded={!collapsed[project.slug]}
              onToggle={() => toggle(project.slug)}
              onOpen={(slug, id) => store.openSession(slug, id)}
              onDispose={(id) => store.disposeSession(id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default SessionList;
