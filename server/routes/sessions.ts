import { stat, readdir, readFile, mkdir } from "fs/promises";
import { join } from "path";
import type { SessionPool } from "../claude/pool";
import {
  loadSessionMessagesAndMetadata,
  decodeProjectSlug,
} from "../claude/history";
import { claudeProjectsRoot } from "../claude/paths";
import { saveSessionTitle } from "../claude/session-titles";
import { getConfigDir } from "../config";
import {
  readChannelDiscovery,
  injectToChannel,
  postPermissionVerdict,
} from "../claude/channels";
import type { ChannelBridgePool } from "../claude/channel-bridge";
import type { SessionStatus } from "../types";

export async function sessionStatusFor(
  pool: SessionPool,
  slug: string,
  id: string,
): Promise<SessionStatus> {
  if (pool.get(id)) return "live";
  const path = join(claudeProjectsRoot(), slug, `${id}.jsonl`);
  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs < 60_000) return "mirror";
  } catch {}
  return "idle";
}

export async function sessionsRoutes(
  req: Request,
  pool: SessionPool,
  bridges: ChannelBridgePool,
): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (
        parts[0] === "api" &&
        parts[1] === "projects" &&
        parts.length === 4 &&
        parts[3] === "sessions" &&
        req.method === "POST"
      ) {
        const slug = decodeURIComponent(parts[2]);
        const body = await readJson<{ cwd?: string; model?: string; permissionMode?: string }>(req);
        const cwd = body.cwd ?? decodeProjectSlug(slug);
        const { sessionId } = await pool.createNew(cwd, body.model, body.permissionMode as any);
        return Response.json({ sessionId, cwd }, { status: 201 });
      }

      if (
        parts[0] === "api" &&
        parts[1] === "projects" &&
        parts.length === 3 &&
        parts[2] === "memory" &&
        req.method === "GET"
      ) {
        return new Response("Not Found", { status: 404 });
      }

      if (
        parts[0] === "api" &&
        parts[1] === "projects" &&
        parts.length === 4 &&
        parts[3] === "memory" &&
        req.method === "GET"
      ) {
        const slug = decodeURIComponent(parts[2]);
        const memoryDir = join(claudeProjectsRoot(), slug, "memory");
        try {
          const st = await stat(memoryDir);
          if (!st.isDirectory()) return new Response("Not Found", { status: 404 });
        } catch {
          return new Response("Not Found", { status: 404 });
        }
        const files = await readdir(memoryDir);
        const contents = await Promise.all(
          files.map(async (filename) => {
            const content = await readFile(join(memoryDir, filename), "utf-8");
            return { filename, content };
          }),
        );
        return Response.json(contents);
      }

    if (parts[0] === "api" && parts[1] === "sessions") {
      const id = parts[2] ? decodeURIComponent(parts[2]) : "";
      if (!id) return new Response("Not Found", { status: 404 });

      if (parts.length === 3 && req.method === "GET") {
        const slug = url.searchParams.get("slug");
        if (!slug) {
          return Response.json({ error: "slug query parameter required" }, { status: 400 });
        }
        const { messages, metadata } = await loadSessionMessagesAndMetadata(
          slug,
          id,
        );
        const status = await sessionStatusFor(pool, slug, id);
        void pool.startTailer(slug, id);
        const discovery = await readChannelDiscovery(id);
        if (discovery) bridges.ensure(id, discovery);
        return Response.json({
          session: {
            id,
            slug,
            status,
            metadata,
            channel: {
              present: !!discovery,
              port: discovery?.port,
              pid: discovery?.pid,
            },
          },
          messages,
        });
      }

      if (parts.length === 4 && parts[3] === "prompt" && req.method === "POST") {
        const body = await readJson<{ text: string; cwd?: string; slug?: string; attachments?: Array<{ fileId: string; path: string }> }>(req);
        if (typeof body.text !== "string" || body.text.length === 0) {
          return Response.json({ error: "text required" }, { status: 400 });
        }
        const cwd = body.cwd ?? (body.slug ? decodeProjectSlug(body.slug) : undefined);
        if (!cwd) {
          return Response.json({ error: "cwd or slug required" }, { status: 400 });
        }
        const discovery = await readChannelDiscovery(id);
        if (discovery) {
          try {
            await injectToChannel(discovery, {
              content: body.text,
              chat_id: "opzero-web",
            });
            return Response.json(
              { ok: true, via: "channel" },
              { status: 202 },
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[sessions:${id}] channel inject failed, falling back to resume:`,
              msg,
            );
          }
        }
        const proc = await pool.resumeOrCreate(id, cwd);
        proc.sendUserPrompt(body.text, body.attachments);
        return Response.json({ ok: true, via: "resume" }, { status: 202 });
      }

      if (parts.length === 4 && parts[3] === "upload" && req.method === "POST") {
        const contentType = req.headers.get("content-type") ?? "";
        if (!contentType.includes("multipart/form-data")) {
          return Response.json({ error: "multipart/form-data required" }, { status: 400 });
        }
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) {
          return Response.json({ error: "boundary missing" }, { status: 400 });
        }
        const bodyBytes = await req.arrayBuffer();
        const bodyText = new TextDecoder().decode(bodyBytes);
        const parts_ = bodyText.split(`--${boundary}`).filter(p => p.trim() && !p.includes("--"));
        let fileBuffer: Uint8Array | null = null;
        let fileName = "file";
        for (const part of parts_) {
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd < 0) continue;
          const headerPart = part.slice(0, headerEnd);
          const filenameMatch = headerPart.match(/filename="([^"]+)"/);
          if (filenameMatch) fileName = filenameMatch[1];
          const dataStart = headerEnd + 4;
          const dataPart = part.slice(dataStart).replace(/\r\n$/, "");
          const base64Data = dataPart.replace(/[^A-Za-z0-9+/]/g, "");
          const pad = base64Data.length % 4;
          const padded = pad ? base64Data + "=".repeat(4 - pad) : base64Data;
          const binaryStr = atob(padded);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          fileBuffer = bytes;
          break;
        }
        if (!fileBuffer) {
          return Response.json({ error: "no file in request" }, { status: 400 });
        }
        const uploadsDir = join(getConfigDir(), "uploads", id);
        await mkdir(uploadsDir, { recursive: true });
        const fileId = crypto.randomUUID();
        const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
        const savedName = ext ? `${fileId}.${ext}` : fileId;
        const filePath = join(uploadsDir, savedName);
        await Bun.write(filePath, fileBuffer);
        return Response.json({ fileId, path: filePath });
      }

      if (parts.length === 4 && parts[3] === "abort" && req.method === "POST") {
        await pool.abort(id);
        return new Response(null, { status: 204 });
      }

      if (
        parts.length === 4 &&
        parts[3] === "permission" &&
        req.method === "POST"
      ) {
        const body = await readJson<{
          request_id?: string;
          behavior?: string;
        }>(req);
        const request_id =
          typeof body.request_id === "string" ? body.request_id : "";
        const behavior =
          body.behavior === "allow" || body.behavior === "deny"
            ? body.behavior
            : null;
        if (!request_id || !behavior) {
          return Response.json(
            { error: "request_id and behavior (allow|deny) required" },
            { status: 400 },
          );
        }
        const discovery = await readChannelDiscovery(id);
        if (!discovery) {
          return Response.json(
            { error: "no active channel for this session" },
            { status: 409 },
          );
        }
        try {
          await postPermissionVerdict(discovery, { request_id, behavior });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json(
            { error: `permission relay failed: ${msg}` },
            { status: 502 },
          );
        }
        return Response.json({ ok: true }, { status: 202 });
      }

      if (parts.length === 3 && req.method === "PATCH") {
        const body = await readJson<{ title?: unknown }>(req);
        if (typeof body.title !== "string" || body.title.trim().length === 0) {
          return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
        }
        const title = body.title.trim().slice(0, 120);
        await saveSessionTitle(id, title);
        return Response.json({ ok: true, title });
      }

      if (parts.length === 3 && req.method === "DELETE") {
        await pool.dispose(id);
        return new Response(null, { status: 204 });
      }

      if (parts.length === 4 && parts[3] === "fork" && req.method === "POST") {
        const body = await readJson<{ slug?: string }>(req);
        const slug = body.slug ?? url.searchParams.get("slug");
        const cwd = slug ? decodeProjectSlug(slug) : undefined;
        if (!cwd) {
          return Response.json({ error: "slug required" }, { status: 400 });
        }
        const { sessionId: newId } = await pool.fork(id, cwd);
        return Response.json({ sessionId: newId, forkedFrom: id }, { status: 201 });
      }
    }

    return new Response("Not Found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
