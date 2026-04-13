import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { ChevronRight, Sparkles, Bookmark } from "lucide-react";
import { renderPart as _renderPart } from "@/components/parts";
import ThreadNav from "@/components/ThreadNav";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStore, store } from "@/lib/store";
import type { Message, Part, ResultPart, ThinkingPart } from "@/lib/types";

interface PartRenderContext {
  messageId: string;
  sessionId: string;
}

function FallbackPart({ part }: { part: Part }) {
  if (part.type === "text") {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {part.text}
      </div>
    );
  }
  if (part.type === "tool_use") {
    return (
      <div className="text-xs font-mono rounded-md bg-secondary/30 border border-border/50 p-2">
        <div className="text-primary">{part.tool}</div>
        <pre className="text-muted-foreground overflow-x-auto">
          {JSON.stringify(part.input, null, 2)}
        </pre>
        {part.resultText && (
          <pre className="mt-2 text-foreground/80 overflow-x-auto">
            {part.resultText}
          </pre>
        )}
      </div>
    );
  }
  if (part.type === "tool_result") {
    return (
      <div className="text-xs font-mono rounded-md bg-secondary/20 border border-border/30 p-2 text-muted-foreground">
        <pre className="overflow-x-auto">
          {typeof part.content === "string"
            ? part.content
            : JSON.stringify(part.content, null, 2)}
        </pre>
      </div>
    );
  }
  if (part.type === "system") {
    return (
      <div className="text-[11px] font-mono text-muted-foreground/70 italic">
        [{part.subtype}]
      </div>
    );
  }
  return null;
}

function ThinkingBlock({ part }: { part: ThinkingPart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border/40 bg-secondary/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
        <Sparkles className="h-3 w-3" />
        <span className="italic">thinking</span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-xs italic text-muted-foreground whitespace-pre-wrap">
          {part.text}
        </div>
      )}
    </div>
  );
}

function ResultFooter({ part }: { part: ResultPart }) {
  const cost =
    typeof part.costUsd === "number" ? `$${part.costUsd.toFixed(4)}` : null;
  const dur =
    typeof part.durationMs === "number"
      ? `${(part.durationMs / 1000).toFixed(1)}s`
      : null;
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border/30 mt-2">
      <Badge
        variant={part.subtype === "error" ? "destructive" : "secondary"}
        className="text-[10px] uppercase"
      >
        {part.subtype}
      </Badge>
      {cost && (
        <Badge variant="outline" className="text-[10px]">
          {cost}
        </Badge>
      )}
      {dur && (
        <Badge variant="outline" className="text-[10px]">
          {dur}
        </Badge>
      )}
    </div>
  );
}

function renderWithFallback(part: Part, ctx: PartRenderContext): ReactNode {
  if (part.type === "thinking") return <ThinkingBlock part={part} />;
  if (part.type === "result") return <ResultFooter part={part} />;
  try {
    const out = (_renderPart as unknown as (
      p: Part,
      c: PartRenderContext,
    ) => ReactNode)(part, ctx);
    if (out) return out;
  } catch {
    // fall through to fallback
  }
  return <FallbackPart part={part} />;
}

function MessageCard({ msg }: { msg: Message }) {
  const state = useStore();
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const [showActions, setShowActions] = useState(false);

  const sessionId = state.selected.sessionId;
  const markers = sessionId ? state.markers[sessionId] ?? [] : [];
  const marker = markers.find((m) => m.messageId === msg.id);
  const isMarked = !!marker;

  function toggleMarker(e: React.MouseEvent) {
    e.stopPropagation();
    if (isMarked) {
      store.removeMarker(sessionId!, marker.id);
    } else {
      store.addMarker({ sessionId: sessionId!, messageId: msg.id });
    }
  }

  return (
    <div
      className={cn(
        "flex group",
        isUser ? "justify-end" : "justify-start",
        isMarked && "relative",
      )}
    >
      {isMarked && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500 rounded-l-lg" />
      )}
      <div
        className={cn(
          "max-w-[85%] min-w-0 rounded-lg p-3 glass-border relative",
          isUser
            ? "bg-primary/5 border-l-2 border-l-primary"
            : "bg-card/60",
          isSystem && "opacity-70",
        )}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {showActions && (
          <button
            type="button"
            onClick={toggleMarker}
            className={cn(
              "absolute -right-10 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center transition-colors",
              isMarked
                ? "bg-violet-500/20 text-violet-500 hover:bg-violet-500/30"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title={isMarked ? "Remove marker" : "Add marker"}
          >
            <Bookmark className={cn("h-4 w-4", isMarked && "fill-current")} />
          </button>
        )}
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={cn(
              "text-[10px] uppercase tracking-wide font-semibold",
              isUser ? "text-primary" : "text-accent",
            )}
          >
            {isUser ? "You" : isSystem ? "System" : "Claude"}
          </span>
          {msg.model && (
            <Badge variant="outline" className="text-[9px] py-0 h-4">
              {msg.model}
            </Badge>
          )}
        </div>
        <div className="space-y-2 min-w-0 overflow-hidden [overflow-wrap:anywhere]">
          {msg.parts.map((part) => (
            <div key={part.id} className="min-w-0">
              {renderWithFallback(part, {
                messageId: msg.id,
                sessionId: msg.sessionId,
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageThread() {
  const state = useStore();
  const sessionId = state.selected.sessionId;
  const messages = useMemo<Message[]>(
    () => (sessionId ? state.messages[sessionId] ?? [] : []),
    [sessionId, state.messages],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefsRef = useRef<Map<string, HTMLElement>>(new Map());
  const stickRef = useRef(true);
  const lastSessionRef = useRef<string | null>(null);

  const userMessageIds = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.id),
    [messages],
  );

  useEffect(() => {
    if (lastSessionRef.current !== sessionId) {
      stickRef.current = true;
      lastSessionRef.current = sessionId;
    }
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, sessionId]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = atBottom;
  }

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="text-sm text-muted-foreground">
            No session selected.
          </div>
          <div className="text-xs text-muted-foreground/70">
            Pick one on the left, or hit "New Session".
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
      >
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground/70 py-12">
              Send a prompt to begin.
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              data-message-id={m.id}
              ref={(el) => {
                const map = messageRefsRef.current;
                if (el) map.set(m.id, el);
                else map.delete(m.id);
              }}
            >
              <MessageCard msg={m} />
            </div>
          ))}
        </div>
      </div>
      <ThreadNav
        scrollRef={scrollRef}
        messageRefs={messageRefsRef}
        userMessageIds={userMessageIds}
      />
    </div>
  );
}

export default MessageThread;
