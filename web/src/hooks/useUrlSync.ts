import { useEffect, useRef } from "react";
import { store, useStore } from "@/lib/store";

function parseUrl(
  pathname: string,
): { source: "local" | string; slug: string; sessionId: string } | null {
  const remote = pathname.match(/^\/m\/([^/]+)\/s\/([^/]+)\/([^/]+)\/?$/);
  if (remote) {
    try {
      return {
        source: decodeURIComponent(remote[1]),
        slug: decodeURIComponent(remote[2]),
        sessionId: decodeURIComponent(remote[3]),
      };
    } catch {
      return null;
    }
  }

  const m = pathname.match(/^\/s\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  try {
    return {
      source: "local",
      slug: decodeURIComponent(m[1]),
      sessionId: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

function buildUrl(source: "local" | string | null, slug: string | null, sessionId: string | null): string {
  if (!source || !slug || !sessionId) return "/";
  if (source !== "local") {
    return `/m/${encodeURIComponent(source)}/s/${encodeURIComponent(slug)}/${encodeURIComponent(sessionId)}`;
  }
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
      store.openSession(parsed.slug, parsed.sessionId, parsed.source).catch(() => {});
    }
    hydratedRef.current = true;
  }, [state.projectsLoaded]);

  // Write URL when selection changes (after hydrate has run).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const want = buildUrl(selected.source, selected.slug, selected.sessionId);
    if (window.location.pathname !== want) {
      window.history.replaceState(null, "", want);
    }
  }, [selected.source, selected.slug, selected.sessionId]);

  // Handle browser back/forward.
  useEffect(() => {
    function onPop() {
      const parsed = parseUrl(window.location.pathname);
      if (!parsed) {
        store.selectSession(null, null, null);
        return;
      }
      const current = store.getSnapshot().selected;
      if (parsed.sessionId !== current.sessionId || parsed.source !== current.source) {
        store.openSession(parsed.slug, parsed.sessionId, parsed.source).catch(() => {});
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
