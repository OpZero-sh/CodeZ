import { useEffect } from "react";
import { store, useStore } from "@/lib/store";
import type { Session } from "@/lib/types";

export function useSessions(slug: string | null): Session[] {
  const state = useStore();

  useEffect(() => {
    if (!slug) return;
    if (!state.sessionsByProject[slug]) {
      store.loadSessions(slug).catch(() => {});
    }
  }, [slug, state.sessionsByProject]);

  if (!slug) return [];
  return state.sessionsByProject[slug] ?? [];
}
