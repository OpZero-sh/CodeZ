import { useEffect, useRef } from "react";
import { store, useStore } from "@/lib/store";

function parseUrl(
  pathname: string,
): { slug: string; sessionId: string } | null {
  const m = pathname.match(/^\/s\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  try {
    return {
      slug: decodeURIComponent(m[1]),
      sessionId: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

function buildUrl(slug: string | null, sessionId: string | null): string {
  if (!slug || !sessionId) return "/";
  return `/s/${encodeURIComponent(slug)}/${encodeURIComponent(sessionId)}`;
}

export function useUrlSync() {
  const state = useStore();
  const hydratedRef = useRef(false);
  const selected = state.selected;

  // Hydrate from URL once projects are loaded.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!state.projectsLoaded) return;
    const parsed = parseUrl(window.location.pathname);
    if (parsed) {
      store.openSession(parsed.slug, parsed.sessionId).catch(() => {});
    }
    hydratedRef.current = true;
  }, [state.projectsLoaded]);

  // Write URL when selection changes (after hydrate has run).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const want = buildUrl(selected.slug, selected.sessionId);
    if (window.location.pathname !== want) {
      window.history.replaceState(null, "", want);
    }
  }, [selected.slug, selected.sessionId]);

  // Handle browser back/forward.
  useEffect(() => {
    function onPop() {
      const parsed = parseUrl(window.location.pathname);
      if (!parsed) {
        store.selectSession(null, null);
        return;
      }
      if (parsed.sessionId !== store.getSnapshot().selected.sessionId) {
        store.openSession(parsed.slug, parsed.sessionId).catch(() => {});
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
