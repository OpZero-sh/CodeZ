import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { hasHubSession } from "@/lib/hubAuth";
import type { SSEEvent } from "@/lib/types";

export function useEventStream() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Hosted mode has no local bun server; realtime flows over the hub
    // WebSocket (useHubStream), so don't open — and endlessly retry — a local
    // /api/events EventSource that the Worker would reject with 401.
    if (hasHubSession()) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    let lastActivity = Date.now();

    function connect() {
      if (stopped) return;
      es = new EventSource("/api/events", { withCredentials: true });

      es.onopen = () => {
        attempt = 0;
        lastActivity = Date.now();
        setConnected(true);
        store.setConnected(true);
      };

      es.onmessage = (ev) => {
        lastActivity = Date.now();
        if (!ev.data) return;
        try {
          const parsed = JSON.parse(ev.data) as SSEEvent;
          store.dispatch(parsed);
        } catch {
          // ignore malformed frames
        }
      };

      es.onerror = () => {
        setConnected(false);
        store.setConnected(false);
        es?.close();
        es = null;
        if (stopped) return;
        // If we haven't seen activity in 30s+, the machine likely slept —
        // reset backoff so we reconnect fast on wake.
        const gap = Date.now() - lastActivity;
        if (gap >= 30_000) attempt = 0;
        const delay = Math.min(30000, 500 * Math.pow(2, attempt));
        attempt += 1;
        lastActivity = Date.now();
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      es = null;
    };
  }, []);

  return { connected };
}
