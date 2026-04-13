import { useMemo } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { store, useStore } from "@/lib/store";

function PermissionPrompts() {
  const state = useStore();
  const sessionId = state.selected.sessionId;
  const list = useMemo(
    () => (sessionId ? state.permissionRequests[sessionId] ?? [] : []),
    [sessionId, state.permissionRequests],
  );

  if (!sessionId || list.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-accent/40 bg-accent/10">
      {list.map((r) => (
        <div
          key={r.requestId}
          className="flex items-start gap-3 px-3 sm:px-4 py-3"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-accent mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="text-xs uppercase tracking-wide text-accent font-semibold">
              Permission requested: {r.toolName}
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                {r.requestId}
              </span>
            </div>
            <div className="text-sm text-foreground break-words">
              {r.description}
            </div>
            {r.inputPreview && (
              <div className="text-[11px] font-mono text-muted-foreground/80 break-all line-clamp-3 bg-background/40 border border-border/40 rounded p-2">
                {r.inputPreview}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              size="sm"
              onClick={() =>
                store.resolvePermission(sessionId, r.requestId, "allow")
              }
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
              aria-label="Allow"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Allow
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                store.resolvePermission(sessionId, r.requestId, "deny")
              }
              className="h-8"
              aria-label="Deny"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Deny
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PermissionPrompts;
