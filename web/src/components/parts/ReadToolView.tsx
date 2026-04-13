import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ToolUsePart } from "@/lib/types";

export function ReadToolView({ part }: { part: ToolUsePart }) {
  const [open, setOpen] = useState(false);
  const input = part.input ?? {};
  const filePath: string = input.file_path ?? "(unknown)";
  const offset: number | undefined = input.offset;
  const limit: number | undefined = input.limit;
  const hasRange = offset != null || limit != null;
  const body = part.resultText ?? "";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="rounded bg-background/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {filePath}
        </span>
        {hasRange ? (
          <span className="rounded bg-accent/20 px-2 py-0.5 font-mono text-[10px] text-accent-foreground">
            {offset != null ? `L${offset}` : "L1"}
            {limit != null ? `+${limit}` : ""}
          </span>
        ) : null}
      </button>
      {open ? (
        <pre className="max-h-[300px] overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs text-muted-foreground sm:text-sm">
          {body || <span className="italic opacity-60">(empty)</span>}
        </pre>
      ) : null}
    </div>
  );
}
