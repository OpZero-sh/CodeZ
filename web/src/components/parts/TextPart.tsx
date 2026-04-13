import type { TextPart } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Segment {
  kind: "text" | "code";
  lang?: string;
  content: string;
}

function parseSegments(text: string): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "code", lang: match[1] || undefined, content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

function InlineText({ content }: { content: string }) {
  const parts: Array<{ kind: "plain" | "code"; value: string }> = [];
  const inline = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "plain", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ kind: "code", value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "plain", value: content.slice(lastIndex) });
  }
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <code
            key={i}
            className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[0.85em] text-[#00F5FF]"
          >
            {p.value}
          </code>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}

export function TextPartView({ part }: { part: TextPart }) {
  const text = part.text ?? "";
  if (!text) {
    return (
      <div className="my-2 text-sm text-muted-foreground">
        <span className="inline-block h-4 w-[2px] animate-pulse bg-[#00F5FF] align-middle" />
      </div>
    );
  }
  const segments = parseSegments(text);
  return (
    <div className={cn("my-2 space-y-3 text-sm leading-relaxed text-foreground")}>
      {segments.map((seg, i) =>
        seg.kind === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-lg border border-border bg-black/40 p-3 font-mono text-xs sm:text-sm"
          >
            {seg.lang ? (
              <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {seg.lang}
              </div>
            ) : null}
            <code className="text-[#00F5FF]">{seg.content}</code>
          </pre>
        ) : (
          <div key={i}>
            <InlineText content={seg.content} />
          </div>
        ),
      )}
    </div>
  );
}
