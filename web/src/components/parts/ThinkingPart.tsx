import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ThinkingPart } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ThinkingPartView({ part }: { part: ThinkingPart }) {
  const [open, setOpen] = useState(false);
  const streaming = !part.time?.end;
  return (
    <div className="my-2 rounded-lg border border-border bg-card/60 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground",
        )}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span>Thinking{streaming ? "..." : ""}</span>
        {streaming ? <Loader2 className="h-3 w-3 animate-spin text-[#00F5FF]" /> : null}
      </button>
      {open ? (
        <div className="mt-2 whitespace-pre-wrap text-sm italic text-muted-foreground">
          {part.text || ""}
        </div>
      ) : null}
    </div>
  );
}
