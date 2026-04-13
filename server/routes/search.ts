import { readdir, stat } from "fs/promises";
import { join } from "path";
import { claudeProjectsRoot, decodeProjectSlug } from "../claude/paths";

interface SearchRecord {
  sessionId: string;
  slug: string;
  projectPath: string;
  cwd: string;
  title: string;
  content: string;
  mtimeMs: number;
}

interface SearchResult {
  sessionId: string;
  slug: string;
  title: string;
  cwd: string;
  snippet: string;
  mtimeMs: number;
}

interface SearchIndex {
  records: SearchRecord[];
  builtAt: number;
}

let index: SearchIndex | null = null;
let indexBuildPromise: Promise<SearchIndex> | null = null;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as { type?: string; text?: unknown; thinking?: unknown };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        if (b.type === "thinking" && typeof b.thinking === "string") parts.push(b.thinking);
      }
    }
    return parts.join(" ");
  }
  return "";
}

async function buildIndex(): Promise<SearchIndex> {
  const root = claudeProjectsRoot();
  const records: SearchRecord[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return { records: [], builtAt: Date.now() };
  }

  for (const slug of entries) {
    if (!slug.startsWith("-")) continue;
    const dir = join(root, slug);
    let dirEntries: string[] = [];
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      dirEntries = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of dirEntries) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = join(dir, name);
      const sessionId = name.slice(0, -".jsonl".length);
      let fileSt;
      try {
        fileSt = await stat(filePath);
      } catch {
        continue;
      }

      const file = Bun.file(filePath);
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.length > 0);

      let title = "";
      const contentParts: string[] = [];
      let cwd = decodeProjectSlug(slug);

      for (const line of lines) {
        let rec: Record<string, unknown>;
        try {
          rec = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof rec.cwd === "string") cwd = rec.cwd;
        if (!title && (rec.type as string) === "user") {
          const msg = rec.message as { role?: string; content?: unknown } | undefined;
          if (msg?.role === "user") {
            const t = extractText(msg.content);
            if (t) title = t.replace(/\s+/g, " ").trim().slice(0, 60);
          }
        }
        if (rec.message && typeof rec.message === "object") {
          const msg = rec.message as { content?: unknown };
          const txt = extractText(msg.content);
          if (txt) contentParts.push(txt);
        }
      }

      records.push({
        sessionId,
        slug,
        projectPath: decodeProjectSlug(slug),
        cwd,
        title: title || sessionId.slice(0, 12),
        content: contentParts.join(" ").toLowerCase(),
        mtimeMs: fileSt.mtimeMs,
      });
    }
  }

  return { records, builtAt: Date.now() };
}

async function getIndex(): Promise<SearchIndex> {
  if (index) return index;
  if (indexBuildPromise) return indexBuildPromise;
  indexBuildPromise = buildIndex().then((i) => {
    index = i;
    return i;
  });
  return indexBuildPromise;
}

function makeSnippet(content: string, q: string): string {
  const lower = content.toLowerCase();
  const queryLower = q.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return content.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + q.length + 80);
  const snippet = content.slice(start, end);
  return (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : "");
}

export async function searchSessions(q: string): Promise<SearchResult[]> {
  if (!q.trim() || q.trim().length < 2) return [];
  const idx = await getIndex();
  const queryLower = q.toLowerCase();
  const results: SearchResult[] = [];

  for (const record of idx.records) {
    if (record.content.includes(queryLower)) {
      results.push({
        sessionId: record.sessionId,
        slug: record.slug,
        title: record.title,
        cwd: record.cwd,
        snippet: makeSnippet(record.content, q),
        mtimeMs: record.mtimeMs,
      });
    }
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.slice(0, 20);
}

export async function searchRoutes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/search") return new Response("Not Found", { status: 404 });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const q = url.searchParams.get("q") ?? "";
  const results = await searchSessions(q);
  return Response.json({ results });
}
