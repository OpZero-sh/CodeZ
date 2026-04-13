import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  BookmarkCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

interface ThreadNavProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<Map<string, HTMLElement>>;
  userMessageIds: string[];
}

const BUTTON_CLASS =
  "pointer-events-auto h-11 w-11 sm:h-9 sm:w-9 rounded-full bg-background/80 border border-border/60 backdrop-blur-sm text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-card transition-colors shadow-lg flex items-center justify-center";

function ThreadNav({
  scrollRef,
  messageRefs,
  userMessageIds,
}: ThreadNavProps) {
  const state = useStore();
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const lastGPressRef = useRef(0);

  const sessionId = state.selected.sessionId;
  const markerIds = sessionId
    ? (state.markers[sessionId] ?? []).filter((m) => !m.resolved).map((m) => m.messageId)
    : [];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      setShowTop(scrollTop > 200);
      setShowBottom(scrollHeight - scrollTop - clientHeight > 200);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, userMessageIds.length]);

  function scrollToTop() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function jumpToPrev() {
    const el = scrollRef.current;
    const map = messageRefs.current;
    if (!el || !map || userMessageIds.length === 0) return;
    const scrollerTop = el.getBoundingClientRect().top;
    const currentTop = el.scrollTop;
    let target: HTMLElement | null = null;
    for (const id of userMessageIds) {
      const node = map.get(id);
      if (!node) continue;
      const offsetTop =
        node.getBoundingClientRect().top - scrollerTop + el.scrollTop;
      if (offsetTop < currentTop - 10) {
        target = node;
      } else {
        break;
      }
    }
    if (!target) {
      const firstId = userMessageIds[0];
      target = map.get(firstId) ?? null;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function jumpToNext() {
    const el = scrollRef.current;
    const map = messageRefs.current;
    if (!el || !map || userMessageIds.length === 0) return;
    const scrollerTop = el.getBoundingClientRect().top;
    const currentTop = el.scrollTop;
    let target: HTMLElement | null = null;
    for (const id of userMessageIds) {
      const node = map.get(id);
      if (!node) continue;
      const offsetTop =
        node.getBoundingClientRect().top - scrollerTop + el.scrollTop;
      if (offsetTop > currentTop + 10) {
        target = node;
        break;
      }
    }
    if (!target) {
      const lastId = userMessageIds[userMessageIds.length - 1];
      target = map.get(lastId) ?? null;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function jumpToPrevMarker() {
    const el = scrollRef.current;
    const map = messageRefs.current;
    if (!el || !map || markerIds.length === 0) return;
    const scrollerTop = el.getBoundingClientRect().top;
    const currentTop = el.scrollTop;
    let target: HTMLElement | null = null;
    for (const id of markerIds) {
      const node = map.get(id);
      if (!node) continue;
      const offsetTop =
        node.getBoundingClientRect().top - scrollerTop + el.scrollTop;
      if (offsetTop < currentTop - 10) {
        target = node;
      } else {
        break;
      }
    }
    if (!target) {
      const firstId = markerIds[0];
      target = map.get(firstId) ?? null;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function jumpToNextMarker() {
    const el = scrollRef.current;
    const map = messageRefs.current;
    if (!el || !map || markerIds.length === 0) return;
    const scrollerTop = el.getBoundingClientRect().top;
    const currentTop = el.scrollTop;
    let target: HTMLElement | null = null;
    for (const id of markerIds) {
      const node = map.get(id);
      if (!node) continue;
      const offsetTop =
        node.getBoundingClientRect().top - scrollerTop + el.scrollTop;
      if (offsetTop > currentTop + 10) {
        target = node;
        break;
      }
    }
    if (!target) {
      const lastId = markerIds[markerIds.length - 1];
      target = map.get(lastId) ?? null;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  useEffect(() => {
    if (userMessageIds.length === 0) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable
        ) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "J") {
        if (e.shiftKey) return;
        e.preventDefault();
        jumpToNext();
        return;
      }
      if (e.key === "k" || e.key === "K") {
        if (e.shiftKey) return;
        e.preventDefault();
        jumpToPrev();
        return;
      }
      if (e.key === "G") {
        e.preventDefault();
        scrollToBottom();
        return;
      }
      if (e.key === "g") {
        const now = Date.now();
        if (now - lastGPressRef.current < 500) {
          e.preventDefault();
          lastGPressRef.current = 0;
          scrollToTop();
        } else {
          lastGPressRef.current = now;
        }
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (e.shiftKey) {
          jumpToNextMarker();
        } else {
          jumpToPrevMarker();
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userMessageIds, scrollRef, messageRefs]);

  if (userMessageIds.length === 0) return null;

  return (
    <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 pointer-events-none z-10">
      {showTop && (
        <button
          type="button"
          aria-label="Jump to top"
          onClick={scrollToTop}
          className={cn(BUTTON_CLASS)}
        >
          <ArrowUpToLine className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        aria-label="Previous user message"
        onClick={jumpToPrev}
        className={cn(BUTTON_CLASS)}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Next user message"
        onClick={jumpToNext}
        className={cn(BUTTON_CLASS)}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {showBottom && (
        <button
          type="button"
          aria-label="Jump to bottom"
          onClick={scrollToBottom}
          className={cn(BUTTON_CLASS)}
        >
          <ArrowDownToLine className="h-4 w-4" />
        </button>
      )}
      {markerIds.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Previous marker"
            onClick={jumpToPrevMarker}
            className={cn(BUTTON_CLASS)}
          >
            <BookmarkCheck className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next marker"
            onClick={jumpToNextMarker}
            className={cn(BUTTON_CLASS)}
          >
            <BookmarkCheck className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

export default ThreadNav;
