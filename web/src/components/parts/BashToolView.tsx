import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import type { ToolUsePart } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function resultToString(part: ToolUsePart): string {
  if (typeof part.resultText === "string") return part.resultText;
  if (part.result == null) return "";
  if (typeof part.result === "string") return part.result;
  try {
    return JSON.stringify(part.result, null, 2);
  } catch {
    return String(part.result);
  }
}

export function BashToolView({ part }: { part: ToolUsePart }) {
  const [copied, setCopied] = useState(false);
  const command: string = part.input?.command ?? "";
  const description: string | undefined = part.input?.description;
  const exitCode = part.result?.exitCode ?? part.result?.exit_code;
  const output = resultToString(part);

  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="space-y-2">
      {description ? (
        <div className="text-xs text-muted-foreground">{description}</div>
      ) : null}
      <div className="rounded-md border border-border bg-black/60 p-3 font-mono text-xs sm:text-sm">
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[#00F5FF] drop-shadow-[0_0_6px_rgba(0,245,255,0.6)]">
            $
          </span>
          <pre className="flex-1 whitespace-pre-wrap break-words text-white">{command}</pre>
          <div className="flex shrink-0 items-center gap-1">
            {exitCode != null ? (
              <Badge
                variant={exitCode === 0 ? "secondary" : "destructive"}
                className="font-mono text-[10px]"
              >
                exit {exitCode}
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={copy}
              aria-label="Copy command"
            >
              <Copy className="h-3 w-3" />
            </Button>
            {copied ? (
              <span className="text-[10px] text-[#00F5FF]">copied</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="rounded-md bg-background/60 p-3 font-mono text-xs text-muted-foreground sm:text-sm">
        {part.state === "running" ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00F5FF]" />
            <span>running...</span>
          </div>
        ) : output ? (
          <pre
            className={cn(
              "max-h-80 overflow-auto whitespace-pre-wrap break-words",
              part.state === "error" && "text-destructive",
            )}
          >
            {output}
          </pre>
        ) : (
          <span className="italic opacity-60">(no output)</span>
        )}
      </div>
    </div>
  );
}
