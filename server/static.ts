import { join, normalize, resolve } from "node:path";

const DIST_DIR = resolve(import.meta.dir, "..", "web", "dist");
const INDEX_HTML = join(DIST_DIR, "index.html");

function isDev(): boolean {
  return process.env.DEV === "1" || process.env.NODE_ENV === "development";
}

function safeJoin(base: string, requested: string): string | null {
  const decoded = decodeURIComponent(requested);
  const joined = normalize(join(base, decoded));
  if (joined !== base && !joined.startsWith(base + "/")) return null;
  return joined;
}

export async function serveStatic(req: Request): Promise<Response> {
  if (isDev()) {
    return new Response(
      "SPA served by Vite dev server — visit http://localhost:5173",
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = safeJoin(DIST_DIR, pathname);

  if (target) {
    const file = Bun.file(target);
    if (await file.exists()) {
      return new Response(file);
    }
  }

  const fallback = Bun.file(INDEX_HTML);
  if (await fallback.exists()) {
    return new Response(fallback, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response("Not found", { status: 404 });
}
