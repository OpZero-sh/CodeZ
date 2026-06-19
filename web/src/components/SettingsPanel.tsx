import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  CircleHelp,
  CircleMinus,
} from "lucide-react";
import { api, type ServiceEndpointRow, type ServicesSettingsPayload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function StatusDot({ status }: { status: ServiceEndpointRow["status"] }) {
  const map: Record<ServiceEndpointRow["status"], { className: string; label: string }> = {
    ok: { className: "bg-emerald-500 shadow-[0_0_8px_rgb(16_185_129)]", label: "OK" },
    degraded: { className: "bg-amber-400 shadow-[0_0_6px_rgb(251_191_36)]", label: "Degraded" },
    error: { className: "bg-red-500 shadow-[0_0_6px_rgb(239_68_68)]", label: "Error" },
    unconfigured: { className: "bg-muted-foreground/50", label: "Not configured" },
    unknown: { className: "bg-muted-foreground/70", label: "Unknown" },
  };
  const m = map[status];
  return (
    <span className="flex items-center gap-1.5 shrink-0" title={m.label}>
      <span className={cn("h-2 w-2 rounded-full", m.className)} />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono hidden sm:inline">
        {m.label}
      </span>
    </span>
  );
}

function StatusIcon({ status }: { status: ServiceEndpointRow["status"] }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "unconfigured":
      return <CircleMinus className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:
      return <CircleHelp className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function PanelHeader({
  onClose,
  onRefresh,
  loading,
}: {
  onClose: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
      <h2 className="font-semibold text-sm">Connected services</h2>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh status"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/50 text-muted-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ServicesSettingsPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getServicesSettings();
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-[min(520px,78vh)] bg-card border-t border-border shadow-xl z-30 flex flex-col">
      <PanelHeader onClose={onClose} onRefresh={() => void load()} loading={loading} />

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
        {loading && !payload && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading service status…
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
            {error}
          </div>
        )}

        {payload && (
          <>
            <div className="text-xs text-muted-foreground font-mono flex flex-wrap gap-x-4 gap-y-1">
              <span>
                UI base: <span className="text-foreground">{payload.baseUrl}</span>
              </span>
              <span>
                Auth: <span className="text-foreground">{payload.authProvider}</span>
              </span>
              {payload.generatedAt ? (
                <span>
                  Checked:{" "}
                  <span className="text-foreground">
                    {new Date(payload.generatedAt).toLocaleString()}
                  </span>
                </span>
              ) : null}
            </div>

            <ul className="space-y-2">
              {payload.services.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2">
                    <StatusIcon status={row.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{row.label}</span>
                        <StatusDot status={row.status} />
                      </div>
                      {row.url ? (
                        <div className="mt-1 text-[11px] font-mono text-muted-foreground break-all">
                          {row.url}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-muted-foreground italic">No URL</div>
                      )}
                      {row.detail ? (
                        <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{row.detail}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
