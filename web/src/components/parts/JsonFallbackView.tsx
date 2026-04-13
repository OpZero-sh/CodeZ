import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ToolUsePart } from "@/lib/types";

function safeStringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function JsonFallbackView({ part }: { part: ToolUsePart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="font-mono">{part.tool}</span>
      </button>
      {open ? (
        <div className="space-y-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              input
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs text-[#00F5FF] sm:text-sm">
              {safeStringify(part.input)}
            </pre>
          </div>
          {part.resultText || part.result != null ? (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                result
              </div>
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs text-muted-foreground sm:text-sm">
                {part.resultText ?? safeStringify(part.result)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
