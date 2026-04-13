import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import type { SSEEvent } from "@/lib/types";

export function useEventStream() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    function connect() {
      if (stopped) return;
      es = new EventSource("/api/events", { withCredentials: true });

      es.onopen = () => {
        attempt = 0;
        setConnected(true);
        store.setConnected(true);
      };

      es.onmessage = (ev) => {
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
        const delay = Math.min(30000, 500 * Math.pow(2, attempt));
        attempt += 1;
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
