import { useEffect, useMemo, useRef } from "react";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlashCommandPickerProps {
  query: string;
  commands: string[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPick: (command: string) => void;
  onDismiss: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const MAX_VISIBLE = 8;

function SlashCommandPicker({
  query,
  commands,
  selectedIndex,
  onSelectedIndexChange,
  onPick,
  onDismiss: _onDismiss,
  anchorRef: _anchorRef,
}: SlashCommandPickerProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filtered = useMemo(() => {
    if (!query.startsWith("/")) return [];
    const needle = query.slice(1).toLowerCase().trim();
    const unique = Array.from(new Set(commands.map((c) => (c.startsWith("/") ? c : `/${c}`))));
    if (!needle) return unique;
    return unique.filter((c) => c.slice(1).toLowerCase().includes(needle));
  }, [query, commands]);

  useEffect(() => {
    if (filtered.length === 0) return;
    if (selectedIndex >= filtered.length) {
      onSelectedIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex, onSelectedIndexChange]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!query.startsWith("/") || filtered.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 right-0 mb-2 z-50",
        "md:right-auto md:max-w-md",
      )}
    >
      <div
        ref={listRef}
        className={cn(
          "card-glow glass-border rounded-lg border border-border/70 bg-background/95 backdrop-blur",
          "shadow-2xl shadow-primary/10 overflow-hidden",
        )}
      >
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Terminal className="h-3 w-3 text-primary" />
          Slash commands
          <span className="ml-auto text-muted-foreground/60 normal-case tracking-normal">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </span>
        </div>
        <div
          className="max-h-[calc(2.25rem*8)] overflow-y-auto"
          style={{ maxHeight: `${MAX_VISIBLE * 2.25}rem` }}
        >
          {filtered.map((cmd, i) => {
            const selected = i === selectedIndex;
            return (
              <button
                key={cmd}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                onMouseEnter={() => onSelectedIndexChange(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(cmd);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 h-9 text-left",
                  "border-l-2 transition-colors",
                  selected
                    ? "border-primary bg-secondary/60 text-primary"
                    : "border-transparent text-foreground/85 hover:bg-secondary/30",
                )}
              >
                <span className="font-mono text-sm">{cmd}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SlashCommandPicker;
