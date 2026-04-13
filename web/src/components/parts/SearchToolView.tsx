import { useState } from "react";
import type { ToolUsePart } from "@/lib/types";

export function SearchToolView({ part }: { part: ToolUsePart }) {
  const [showAll, setShowAll] = useState(false);
  const input = part.input ?? {};
  const pattern: string = input.pattern ?? input.query ?? "";
  const glob: string | undefined = input.glob;

  const lines = (part.resultText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const limit = 20;
  const visible = showAll ? lines : lines.slice(0, limit);
  const hidden = lines.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-[#00F5FF]">{pattern}</span>
        {glob ? (
          <span className="rounded bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {glob}
          </span>
        ) : null}
      </div>
      {lines.length === 0 ? (
        <div className="text-xs italic text-muted-foreground opacity-70">
          {part.state === "running" ? "searching..." : "no matches"}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-black/40 p-2 font-mono text-xs">
          <ul className="space-y-0.5">
            {visible.map((line, i) => (
              <li
                key={i}
                className="truncate text-muted-foreground"
                title={line}
              >
                {line}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 text-[10px] uppercase tracking-wide text-[#00F5FF] hover:underline"
            >
              +{hidden} more
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
