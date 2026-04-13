import { useEffect, useMemo, useState, useRef } from "react";
import { Plus, PanelLeft, Info, LogOut, Search, Folder, MessageSquare, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { store, useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  type: "action" | "session" | "search-result";
  icon: React.ReactNode;
  action: () => void;
  projectSlug?: string;
  snippet?: string;
}

interface CommandGroup {
  title: string;
  items: CommandItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewSession: () => void;
  onToggleSidebar: () => void;
  onOpenInfo: () => void;
  onLogout: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewSession,
  onToggleSidebar,
  onOpenInfo,
  onLogout,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<Array<{ sessionId: string; slug: string; title: string; cwd: string; snippet: string; mtimeMs: number }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const state = useStore();

  const allItems = useMemo<CommandGroup[]>(() => {
    const actions: CommandItem[] = [
      {
        id: "new-session",
        label: "New Session",
        type: "action",
        icon: <Plus className="h-4 w-4" />,
        action: () => {
          onOpenChange(false);
          onNewSession();
        },
      },
      {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        type: "action",
        icon: <PanelLeft className="h-4 w-4" />,
        action: () => {
          onOpenChange(false);
          onToggleSidebar();
        },
      },
      {
        id: "open-info",
        label: "Open Session Info",
        type: "action",
        icon: <Info className="h-4 w-4" />,
        action: () => {
          onOpenChange(false);
          onOpenInfo();
        },
      },
      {
        id: "logout",
        label: "Logout",
        type: "action",
        icon: <LogOut className="h-4 w-4" />,
        action: () => {
          onOpenChange(false);
          onLogout();
        },
      },
    ];

    const sessionItems: CommandItem[] = [];
    for (const [slug, sessions] of Object.entries(state.sessionsByProject)) {
      for (const session of sessions) {
        sessionItems.push({
          id: `session-${session.id}`,
          label: session.title || session.id.slice(0, 12),
          type: "session",
          icon: <MessageSquare className="h-4 w-4" />,
          action: () => {
            store.openSession(slug, session.id);
            onOpenChange(false);
          },
          projectSlug: slug,
        });
      }
    }

    const searchResultItems: CommandItem[] = searchResults.map((r) => ({
      id: `search-${r.sessionId}`,
      label: r.title,
      type: "search-result" as const,
      icon: <MessageSquare className="h-4 w-4" />,
      action: () => {
        store.openSession(r.slug, r.sessionId);
        onOpenChange(false);
      },
      projectSlug: r.slug,
      snippet: r.snippet,
    }));

    const groups: CommandGroup[] = [];
    if (actions.length > 0) groups.push({ title: "Actions", items: actions });
    if (searchResultItems.length > 0) groups.push({ title: "Search Results", items: searchResultItems });
    else if (sessionItems.length > 0) groups.push({ title: "Sessions", items: sessionItems });
    return groups;
  }, [state.sessionsByProject, searchResults, onNewSession, onToggleSidebar, onOpenInfo, onLogout, onOpenChange]);

  const flatItems = useMemo(() => {
    return allItems.flatMap((g) => g.items);
  }, [allItems]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return flatItems;
    if (searchResults.length > 0) return flatItems;
    const q = query.toLowerCase();
    return flatItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [flatItems, query, searchResults]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setSearchResults([]);
      setSearchLoading(false);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await api.searchSessions(query);
        setSearchResults(data.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % filteredItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filteredItems[selectedIndex];
      if (item) item.action();
    }
  }

  const groupedFiltered = useMemo(() => {
    const groups: CommandGroup[] = [];
    let currentGroup: CommandGroup | null = null;
    for (const item of filteredItems) {
      if (item.type === "action") {
        if (!currentGroup || currentGroup.title !== "Actions") {
          currentGroup = { title: "Actions", items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(item);
      } else if (item.type === "search-result") {
        if (!currentGroup || currentGroup.title !== "Search Results") {
          currentGroup = { title: "Search Results", items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(item);
      } else {
        const projectSlug = item.projectSlug ?? "unknown";
        if (!currentGroup || currentGroup.title !== projectSlug) {
          currentGroup = { title: projectSlug, items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(item);
      }
    }
    return groups;
  }, [filteredItems]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="glass glass-border p-0 max-w-md w-[90vw] overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search sessions and actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {searchLoading ? (
            <div className="px-3 py-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching...
            </div>
          ) : groupedFiltered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No results found
            </div>
          ) : (
            groupedFiltered.map((group) => (
              <div key={group.title}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
                  <Folder className="h-3 w-3" />
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const globalIndex = flatItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => item.action()}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      className={cn(
                        "w-full px-3 py-2 flex items-center gap-2 text-sm text-left transition-colors",
                        isSelected
                          ? "bg-primary/20 text-primary"
                          : "text-foreground hover:bg-secondary/50",
                      )}
                    >
                      <span className={cn("shrink-0 mt-0.5", isSelected ? "text-primary" : "text-muted-foreground")}>
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.snippet && (
                          <span className={cn(
                            "block text-[11px] truncate",
                            isSelected ? "text-primary/70" : "text-muted-foreground"
                          )}>
                            {item.snippet}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="px-3 py-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
          {searchResults.length > 0 ? (
            <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
          ) : query.trim().length >= 2 ? (
            <span>Type to search session content</span>
          ) : (
            <span>
              <kbd className="bg-secondary/50 px-1 rounded">↑↓</kbd> navigate
            </span>
          )}
          <span>
            <kbd className="bg-secondary/50 px-1 rounded">↵</kbd> select
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}