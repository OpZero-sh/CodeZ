import { useState } from "react";
import type { ToolUsePart } from "@/lib/types";
import { Loader2 } from "lucide-react";

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function WebToolView({ part }: { part: ToolUsePart }) {
  const [expanded, setExpanded] = useState(false);
  const input = part.input ?? {};
  const isFetch = part.tool === "WebFetch";
  const url: string | undefined = input.url;
  const query: string | undefined = input.query;
  const prompt: string | undefined = input.prompt;
  const title = isFetch
    ? `WebFetch: ${url ? hostFromUrl(url) : "(no url)"}`
    : `WebSearch: ${query ?? ""}`;

  const body = part.resultText ?? "";
  const preview = body.length > 200 ? body.slice(0, 200) + "..." : body;
  const canExpand = body.length > 200;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-[#00F5FF]">{title}</span>
        {isFetch && url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            open
          </a>
        ) : null}
      </div>
      {isFetch && prompt ? (
        <div className="rounded bg-background/60 px-2 py-1 text-xs italic text-muted-foreground">
          {prompt}
        </div>
      ) : null}
      {part.state === "running" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00F5FF]" />
          <span>fetching...</span>
        </div>
      ) : body ? (
        <div className="rounded-md border border-border bg-black/40 p-3 font-mono text-xs text-muted-foreground sm:text-sm">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">
            {expanded ? body : preview}
          </pre>
          {canExpand ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[10px] uppercase tracking-wide text-[#00F5FF] hover:underline"
            >
              {expanded ? "collapse" : "expand"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
