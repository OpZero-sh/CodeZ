import { useMemo, useState } from "react";
import { Bookmark, X, Check, MessageSquare } from "lucide-react";
import { useStore, store } from "@/lib/store";
import { cn } from "@/lib/utils";

interface MarkersPanelProps {
  onClose: () => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getMessageSnippet(messages: { id: string; parts: { type: string; text?: string }[] }[], messageId: string): string {
  const msg = messages.find((m) => m.id === messageId);
  if (!msg) return "Message not found";
  const textPart = msg.parts.find((p) => p.type === "text");
  const text = textPart?.text ?? "";
  return text.slice(0, 60) + (text.length > 60 ? "..." : "");
}

export default function MarkersPanel({ onClose }: MarkersPanelProps) {
  const state = useStore();
  const sessionId = state.selected.sessionId;
  const [showAll, setShowAll] = useState(false);

  const markers = useMemo(() => {
    if (!sessionId) return [];
    if (showAll) {
      return Object.entries(state.markers).flatMap(([sid, ms]) =>
        ms.map((m) => ({ ...m, sessionId: sid }))
      );
    }
    return (state.markers[sessionId] ?? []).map((m) => ({ ...m, sessionId }));
  }, [sessionId, state.markers, showAll]);

  const messages = sessionId ? state.messages[sessionId] ?? [] : [];

  function jumpToMarker(messageId: string) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  if (markers.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <div className="text-sm">No markers yet</div>
        <div className="text-xs mt-1">Hover over a message and click the bookmark icon to add one</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4" />
          <span className="text-sm font-medium">Markers</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className={cn(
              "text-xs px-2 py-1 rounded transition-colors",
              showAll ? "bg-violet-500/20 text-violet-500" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {showAll ? "Current" : "All"}
          </button>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {markers.map((marker) => (
          <div
            key={marker.id}
            className={cn(
              "p-3 border-b hover:bg-muted/50 cursor-pointer transition-colors",
              marker.resolved && "opacity-50"
            )}
            onClick={() => jumpToMarker(marker.messageId)}
          >
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground truncate">
                  {getMessageSnippet(messages as never, marker.messageId)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {marker.label && (
                    <span className="text-[10px] bg-violet-500/20 text-violet-500 px-1.5 py-0.5 rounded">
                      {marker.label}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTime(marker.createdAt)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  store.toggleMarkerResolved(marker.sessionId, marker.id);
                }}
                className={cn(
                  "shrink-0 p-1 rounded hover:bg-muted",
                  marker.resolved ? "text-green-500" : "text-muted-foreground"
                )}
                title={marker.resolved ? "Unresolve" : "Resolve"}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}