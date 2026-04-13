import type { ToolUsePart } from "@/lib/types";
import { cn } from "@/lib/utils";

function FilePathChip({ path }: { path: string }) {
  return (
    <span className="rounded bg-background/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">
      {path}
    </span>
  );
}

function DiffBlock({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-black/40 font-mono text-xs sm:text-sm">
      <div className="divide-y divide-border/40">
        <div>
          {oldLines.map((line, i) => (
            <div
              key={`o-${i}`}
              className="flex gap-2 bg-destructive/10 px-3 py-0.5 text-destructive"
            >
              <span className="w-3 shrink-0 select-none opacity-70">-</span>
              <span className="whitespace-pre-wrap break-words">{line || " "}</span>
            </div>
          ))}
        </div>
        <div>
          {newLines.map((line, i) => (
            <div
              key={`n-${i}`}
              className="flex gap-2 bg-primary/10 px-3 py-0.5 text-primary"
            >
              <span className="w-3 shrink-0 select-none opacity-70">+</span>
              <span className="whitespace-pre-wrap break-words">{line || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EditToolView({ part }: { part: ToolUsePart }) {
  const input = part.input ?? {};
  const filePath: string = input.file_path ?? input.notebook_path ?? "(unknown)";
  const isWrite = part.tool === "Write";
  const oldString: string | undefined = input.old_string;
  const newString: string | undefined = input.new_string;
  const content: string | undefined = input.content;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <FilePathChip path={filePath} />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {part.tool}
        </span>
        {input.replace_all ? (
          <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground">
            replace all
          </span>
        ) : null}
      </div>
      {isWrite || (!oldString && newString == null) ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            New file
          </div>
          <pre
            className={cn(
              "max-h-96 overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs sm:text-sm",
            )}
          >
            <code className="text-[#00F5FF]">{content ?? ""}</code>
          </pre>
        </div>
      ) : (
        <DiffBlock oldText={oldString ?? ""} newText={newString ?? ""} />
      )}
    </div>
  );
}
