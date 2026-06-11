import { useEffect } from "react";
import { store, useStore } from "@/lib/store";
import type { SSEEvent } from "@/lib/types";

interface HubStreamEnvelope {
  type: "session.event" | "machine.status" | string;
  machineId?: string;
  sessionId?: string;
  event?: SSEEvent;
  online?: boolean;
}

export function useHubStream() {
  const state = useStore();

  useEffect(() => {
    if (!state.hubEnabled || !state.hubToken) {
      store.setHubConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;

    function subscriptions() {
      const subs: Array<{ machineId: string; sessionId?: string }> = [];
      for (const machineId of Object.keys(state.remote)) {
        subs.push({ machineId });
        const sessionsByProject = state.remote[machineId]?.sessionsByProject ?? {};
        for (const sessions of Object.values(sessionsByProject)) {
          for (const session of sessions) {
            subs.push({ machineId, sessionId: session.id });
          }
        }
      }
      return subs;
    }

    function connect() {
      if (stopped) return;
      const url = new URL("wss://code.open0p.com/api/stream");
      url.searchParams.set("token", state.hubToken!);
      ws = new WebSocket(url.toString());

      ws.onopen = () => {
        attempt = 0;
        store.setHubConnected(true);
        ws?.send(JSON.stringify({ type: "subscribe", subscriptions: subscriptions() }));
      };

      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const envelope = JSON.parse(message.data) as HubStreamEnvelope;
          if (envelope.type === "session.event" && envelope.machineId && envelope.event) {
            store.dispatchRemote(envelope.machineId, envelope.event);
          }
          if (envelope.type === "machine.status" && envelope.machineId && typeof envelope.online === "boolean") {
            store.setRemoteMachineStatus(envelope.machineId, envelope.online);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        store.setHubConnected(false);
        ws = null;
        if (stopped) return;
        const delay = Math.min(30000, 500 * Math.pow(2, attempt));
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      store.setHubConnected(false);
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [state.hubEnabled, state.hubToken, state.remote]);
}
