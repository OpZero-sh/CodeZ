import { useEffect, useState } from "react";
import {
  ClipboardList,
  Eraser,
  Sparkles,
  Users,
  Monitor,
  GitBranch,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuickAction {
  label: string;
  text: string;
  icon?: string;
}

interface QuickActionsProps {
  disabled?: boolean;
  onInsert: (text: string) => void;
}

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: "/plan", text: "/plan", icon: "ClipboardList" },
  { label: "/clear", text: "/clear", icon: "Eraser" },
  { label: "/simplify", text: "/simplify", icon: "Sparkles" },
  { label: "/team", text: "/team", icon: "Users" },
  { label: "/computer", text: "/computer", icon: "Monitor" },
  { label: "git status", text: "run git status", icon: "GitBranch" },
  { label: "run tests", text: "run the tests and report failures", icon: "FlaskConical" },
];

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  Eraser,
  Sparkles,
  Users,
  Monitor,
  GitBranch,
  FlaskConical,
};

const STORAGE_KEY = "opzero-claude:quick-actions";

function loadActions(): QuickAction[] {
  if (typeof window === "undefined") return DEFAULT_QUICK_ACTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_ACTIONS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((a) => typeof a?.label === "string" && typeof a?.text === "string")) {
      return parsed as QuickAction[];
    }
    return DEFAULT_QUICK_ACTIONS;
  } catch {
    return DEFAULT_QUICK_ACTIONS;
  }
}

function QuickActions({ disabled, onInsert }: QuickActionsProps) {
  const [actions, setActions] = useState<QuickAction[]>(DEFAULT_QUICK_ACTIONS);

  useEffect(() => {
    const loaded = loadActions();
    setActions(loaded);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      } catch {
        // ignore
      }
    }
  }, []);

  return (
    <div className="relative pb-1.5">
      <div
        className="flex items-center gap-1.5 overflow-x-auto snap-x snap-mandatory scrollbar-none"
        style={{
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
          maskImage:
            "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
        }}
      >
        {actions.map((action) => {
          const Icon = action.icon ? ICON_MAP[action.icon] : null;
          const isCommand = action.label.startsWith("/");
          return (
            <button
              key={action.label}
              type="button"
              disabled={disabled}
              onClick={() => onInsert(action.text)}
              className={cn(
                "snap-start shrink-0 inline-flex items-center gap-1.5 min-h-8 px-2.5 rounded-md",
                "border border-border/60 bg-secondary/40 text-xs text-foreground/90",
                "transition-colors hover:border-primary/70 hover:bg-secondary/70 hover:text-primary",
                "active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
                isCommand && "font-mono",
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span className="whitespace-nowrap">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default QuickActions;
