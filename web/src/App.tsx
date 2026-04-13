import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Menu,
  X,
  AlertTriangle,
  Info,
  LogOut,
  Bookmark,
  HelpCircle,
  Bot,
  Grid,
  FlaskConical,
  GitFork,
  RefreshCw,
  Plug,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { CommandPalette } from "@/components/CommandPalette";
import MessageThread from "@/components/MessageThread";
import PermissionPrompts from "@/components/PermissionPrompts";
import PromptBox from "@/components/PromptBox";
import SessionList from "@/components/SessionList";
import SessionInfoSheet from "@/components/SessionInfoSheet";
import Login from "@/components/Login";
import MarkersPanel from "@/components/MarkersPanel";
import OpzeroPanel from "@/components/OpzeroPanel";
import UatPanel from "@/components/UatPanel";
import OnboardingSheet, { getOnboardingDone } from "@/components/OnboardingSheet";
import TeamDashboard from "@/components/TeamDashboard";
import { McpMonitorPanel } from "@/components/McpMonitorPanel";
import { Button } from "@/components/ui/button";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { store, useStore } from "@/lib/store";
import { useEventStream } from "@/hooks/useEventStream";
import { useUrlSync } from "@/hooks/useUrlSync";
import { authApi } from "@/lib/authClient";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function ErrorBanner() {
  const state = useStore();
  const entries = useMemo(() => {
    return Object.entries(state.errors)
      .filter(([, v]) => !!v)
      .slice(-3);
  }, [state.errors]);

  if (entries.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-destructive/40 bg-destructive/10">
      {entries.map(([key, message]) => (
        <div
          key={key}
          className="flex items-start gap-2 px-3 sm:px-4 py-2 text-xs"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0 text-destructive/90">
            <span className="font-mono text-destructive/60">{key}:</span>{" "}
            <span className="break-words">{message}</span>
          </div>
          <button
            type="button"
            onClick={() => store.clearError(key)}
            className="text-destructive/60 hover:text-destructive shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusPill({
  status,
  channelPresent,
}: {
  status: "live" | "mirror" | "idle" | undefined;
  channelPresent?: boolean;
}) {
  if (!status || status === "idle") return null;
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary font-mono">
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
        live
      </span>
    );
  }
  if (status === "mirror" && channelPresent) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          mirror
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
          channel
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent font-mono">
      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
      mirror
    </span>
  );
}

function Header({
  onOpenSidebar,
  onOpenInfo,
  onLogout,
  onOpenMarkers,
  onOpenOnboarding,
  onOpenTeamDashboard,
  onOpenOpzero,
  onOpenUat,
  onOpenMcpMonitor,
  teamDashboardCount,
  mcpCallCount,
}: {
  onOpenSidebar: () => void;
  onOpenInfo: () => void;
  onLogout: () => void;
  onOpenMarkers: () => void;
  onOpenOnboarding: () => void;
  onOpenTeamDashboard: () => void;
  onOpenOpzero: () => void;
  onOpenUat: () => void;
  onOpenMcpMonitor: () => void;
  teamDashboardCount: number;
  mcpCallCount: number;
}) {
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const state = useStore();
  const { connected } = useEventStream();
  const sessionId = state.selected.sessionId;
  const slug = state.selected.slug;

  const session = useMemo(() => {
    if (!slug || !sessionId) return null;
    const list = state.sessionsByProject[slug] ?? [];
    return list.find((s) => s.id === sessionId) ?? null;
  }, [slug, sessionId, state.sessionsByProject]);

  return (
    <header className="h-14 shrink-0 border-b border-border/40 glass px-2 sm:px-4 flex items-center gap-2">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="md:hidden h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-foreground"
        aria-label="Open sessions"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        {session ? (
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate flex items-center gap-2">
              <span className="truncate">
                {session.title || session.id.slice(0, 12)}
              </span>
              <StatusPill
                status={session.status}
                channelPresent={session?.channel?.present}
              />
            </div>
            <div className="text-[11px] text-muted-foreground font-mono truncate">
              {session.cwd}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground truncate">
            No session selected
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <div
          className={`hidden sm:flex items-center gap-1.5 text-[10px] uppercase tracking-wide ${
            connected ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-primary shadow-[0_0_8px_hsl(var(--primary))]"
                : "bg-muted-foreground"
            }`}
          />
          {connected ? "connected" : "offline"}
        </div>
        <span
          className={cn(
            "sm:hidden h-2 w-2 rounded-full",
            connected
              ? "bg-primary shadow-[0_0_6px_hsl(var(--primary))]"
              : "bg-muted-foreground",
          )}
          aria-label={connected ? "connected" : "offline"}
        />
        {session && (
          <button
            type="button"
            onClick={onOpenInfo}
            className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
            aria-label="Session info"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
        {session && (
          <button
            type="button"
            onClick={() => {
              if (session && slug) {
                store.forkSession(slug, session.id).catch(() => {});
              }
            }}
            className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
            aria-label="Fork session"
            title="Fork into new session"
          >
            <GitFork className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onOpenMarkers}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          aria-label="Markers"
        >
          <Bookmark className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenMcpMonitor}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 relative"
          aria-label="MCP Activity"
          title="MCP Activity"
        >
          <Plug className={cn(
            "h-4 w-4",
            mcpCallCount > 0 ? "text-amber-400" : "text-muted-foreground"
          )} />
          {mcpCallCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>
        <button
          type="button"
          onClick={onOpenTeamDashboard}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 relative"
          aria-label="Fleet"
          title="Fleet"
        >
          <Bot className={cn(
            "h-4 w-4",
            teamDashboardCount > 0 ? "text-[#00F5FF]" : "text-muted-foreground"
          )} />
          {teamDashboardCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#00F5FF] animate-pulse" />
          )}
        </button>
        <button
          type="button"
          onClick={onOpenOpzero}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          aria-label="Integrations"
          title="Integrations"
        >
          <Grid className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenUat}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          aria-label="UAT Testing"
          title="UAT Testing"
        >
          <FlaskConical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenOnboarding}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          aria-label="Help"
          title="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        {session && (
          <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="hidden sm:inline-flex">
                Disconnect
              </Button>
            </DialogTrigger>
            <DialogContent className="glass glass-border">
              <DialogHeader>
                <DialogTitle>Dispose session?</DialogTitle>
                <DialogDescription>
                  &ldquo;{session.title || session.id.slice(0, 12)}&rdquo; will be closed. The JSONL file will be kept.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" size="sm">Keep</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setDisposeOpen(false);
                    store.disposeSession(session.id);
                  }}
                >
                  Dispose
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              aria-label="Restart server"
              title="Restart server"
            >
              <RefreshCw className={cn("h-4 w-4", restarting && "animate-spin")} />
            </button>
          </DialogTrigger>
          <DialogContent className="glass glass-border">
            <DialogHeader>
              <DialogTitle>Restart server?</DialogTitle>
              <DialogDescription>
                The CodeZero server will restart. Active sessions will be disposed and the page will reconnect automatically.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </DialogClose>
              <Button
                variant="default"
                size="sm"
                disabled={restarting}
                onClick={async () => {
                  setRestarting(true);
                  setRestartOpen(false);
                  try {
                    await api.restartServer();
                  } catch {}
                  setTimeout(() => {
                    window.location.reload();
                  }, 3000);
                }}
              >
                {restarting ? "Restarting" : "Restart"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <button
          type="button"
          onClick={onLogout}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          aria-label="Log out"
          title="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function Sidebar() {
  const state = useStore();
  const loadingProjects =
    !state.projectsLoaded && !state.errors.projects;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="h-14 shrink-0 flex items-center px-4 border-b border-border/40">
        <BrandLogo size="md" showTagline />
      </div>
      <div className="flex-1 min-h-0">
        {loadingProjects ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Loading projects</span>
          </div>
        ) : (
          <SessionList />
        )}
      </div>
    </div>
  );
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [teamDashboardOpen, setTeamDashboardOpen] = useState(false);
  const [opzeroOpen, setOpzeroOpen] = useState(false);
  const [uatOpen, setUatOpen] = useState(false);
  const [mcpMonitorOpen, setMcpMonitorOpen] = useState(false);
  const state = useStore();
  const sessionId = state.selected.sessionId;
  const runningTaskCount = state.runningTasks.filter((t) => t.state === "running").length;
  const activeMcpCallCount = state.mcpCalls.filter((c) => c.state === "running").length;

  useUrlSync();

  useEffect(() => {
    store.loadProjects();
    store.loadMarkers();
  }, []);

  useEffect(() => {
    if (!getOnboardingDone()) {
      setOnboardingOpen(true);
    }
  }, []);

  useEffect(() => {
    if (sessionId) setDrawerOpen(false);
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function handleNewSession() {
    const firstProject = state.projects[0];
    if (firstProject) {
      store.createSession(firstProject.slug).catch(() => {});
    }
  }

  function handleToggleSidebar() {
    setDrawerOpen((v) => !v);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex bg-background text-foreground overflow-hidden"
        style={{
          height: "100dvh",
          width: "100vw",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <aside className="hidden md:flex w-[280px] shrink-0 flex-col border-r border-border/40 glass glass-border">
          <Sidebar />
        </aside>

        {drawerOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/60 z-40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside
              className="md:hidden fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[320px] flex flex-col border-r border-border/40 bg-card glass-border shadow-2xl"
              role="dialog"
              aria-label="Sessions"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="absolute top-3 right-3 h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground"
                aria-label="Close sessions"
              >
                <X className="h-4 w-4" />
              </button>
              <Sidebar />
            </aside>
          </>
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          <Header
            onOpenSidebar={() => setDrawerOpen(true)}
            onOpenInfo={() => setInfoOpen(true)}
            onLogout={onLogout}
            onOpenMarkers={() => setMarkersOpen(true)}
            onOpenOnboarding={() => setOnboardingOpen(true)}
            onOpenTeamDashboard={() => setTeamDashboardOpen(true)}
            onOpenOpzero={() => setOpzeroOpen(true)}
            onOpenUat={() => setUatOpen(true)}
            onOpenMcpMonitor={() => setMcpMonitorOpen(true)}
            teamDashboardCount={runningTaskCount}
            mcpCallCount={activeMcpCallCount}
          />
          <ErrorBanner />
          <PermissionPrompts />
          <MessageThread />
          <PromptBox />
        </main>

        <SessionInfoSheet open={infoOpen} onOpenChange={setInfoOpen} />

        <OnboardingSheet open={onboardingOpen} onOpenChange={setOnboardingOpen} />

        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          onNewSession={handleNewSession}
          onToggleSidebar={handleToggleSidebar}
          onOpenInfo={() => setInfoOpen(true)}
          onLogout={onLogout}
        />

        {markersOpen && (
          <div className="fixed bottom-0 left-0 right-0 h-[300px] bg-card border-t border-border shadow-xl z-30">
            <MarkersPanel onClose={() => setMarkersOpen(false)} />
          </div>
        )}

        {teamDashboardOpen && (
          <div className="fixed bottom-0 left-0 right-0 h-[400px] bg-card border-t border-border shadow-xl z-30">
            <TeamDashboard onClose={() => setTeamDashboardOpen(false)} />
          </div>
        )}

        {mcpMonitorOpen && (
          <div className="fixed bottom-0 left-0 right-0 h-[400px] bg-card border-t border-border shadow-xl z-30">
            <McpMonitorPanel onClose={() => setMcpMonitorOpen(false)} />
          </div>
        )}

        {opzeroOpen && (
          <div className="fixed bottom-0 left-0 right-0 h-[300px] bg-card border-t border-border shadow-xl z-30">
            <OpzeroPanel onClose={() => setOpzeroOpen(false)} />
          </div>
        )}

        {uatOpen && (
          <div className="fixed bottom-0 left-0 right-0 h-[400px] bg-card border-t border-border shadow-xl z-30">
            <UatPanel onClose={() => setUatOpen(false)} />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

type AuthState =
  | { phase: "checking" }
  | { phase: "unauthed" }
  | { phase: "authed"; sub: string };

function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: "checking" });
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (cancelled) return;
        setAuth(user ? { phase: "authed", sub: user.sub } : { phase: "unauthed" });
      })
      .catch(() => {
        if (!cancelled) setAuth({ phase: "unauthed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setAuth({ phase: "unauthed" });
  }

  if (auth.phase === "checking") {
    return (
      <div
        className="flex items-center justify-center bg-background text-muted-foreground"
        style={{ height: "100dvh", width: "100vw" }}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (auth.phase === "unauthed") {
    return (
      <>
        <Login
          onAuthed={async () => {
            const user = await authApi.me();
            if (user) setAuth({ phase: "authed", sub: user.sub });
          }}
          onOpenOnboarding={() => setOnboardingOpen(true)}
        />
        <OnboardingSheet open={onboardingOpen} onOpenChange={setOnboardingOpen} />
      </>
    );
  }

  return <MainApp onLogout={handleLogout} />;
}

export default App;
