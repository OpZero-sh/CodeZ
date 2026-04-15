import { readdir, stat, readFile } from "fs/promises";
import { join, dirname } from "path";
import type {
  Message,
  Part,
  Project,
  Session,
  SessionMetadata,
  TextPart,
  ThinkingPart,
  ToolResultPart,
  ToolUsePart,
} from "../types";
import { claudeProjectsRoot, decodeProjectSlug } from "./paths";
import { loadSessionTitles } from "./session-titles";

export { decodeProjectSlug, encodeProjectSlug } from "./paths";

interface JsonlRecord {
  parentUuid?: string | null;
  sessionId?: string;
  type?: string;
  subtype?: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  permissionMode?: string;
  gitBranch?: string;
  message?: {
    id?: string;
    role?: "user" | "assistant";
    model?: string;
    content?: unknown;
  };
  summary?: string;
  attachment?: {
    type?: string;
    addedNames?: unknown;
    removedNames?: unknown;
    [key: string]: unknown;
  };
  // Stream-json init-like fields (may appear if saved raw)
  tools?: unknown;
  mcp_servers?: unknown;
  slash_commands?: unknown;
  output_style?: unknown;
  outputStyle?: unknown;
  agents?: unknown;
  skills?: unknown;
  plugins?: unknown;
  claude_code_version?: unknown;
  model?: unknown;
  [key: string]: unknown;
}

interface MetadataCollector {
  md: SessionMetadata;
  tools: Set<string>;
}

function newCollector(): MetadataCollector {
  return { md: {}, tools: new Set() };
}

function collectStringArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const v of value) {
    if (typeof v === "string") target.add(v);
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out.length ? out : undefined;
}

function asMcpServers(
  value: unknown,
): Array<{ name: string; status: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<{ name: string; status: string }> = [];
  for (const v of value) {
    if (v && typeof v === "object") {
      const o = v as { name?: unknown; status?: unknown };
      if (typeof o.name === "string") {
        out.push({
          name: o.name,
          status: typeof o.status === "string" ? o.status : "unknown",
        });
      }
    }
  }
  return out.length ? out : undefined;
}

/**
 * Apply a single JSONL record's fields to the metadata collector. The stored
 * JSONL format differs from stream-json — init records aren't written directly,
 * but many fields are sprinkled on every user/assistant record (version,
 * permissionMode, model on assistant message) and tool lists show up on
 * `deferred_tools_delta` attachment records.
 */
function updateMetadataFromRecord(
  collector: MetadataCollector,
  rec: JsonlRecord,
): void {
  const md = collector.md;
  if (typeof rec.version === "string" && rec.version) {
    md.claudeCodeVersion = rec.version;
  }
  if (typeof rec.permissionMode === "string" && rec.permissionMode) {
    md.permissionMode = rec.permissionMode;
  }
  if (rec.message && typeof rec.message.model === "string" && rec.message.model) {
    md.model = rec.message.model;
  }
  if (typeof rec.model === "string" && rec.model) {
    md.model = rec.model;
  }
  if (typeof rec.output_style === "string") md.outputStyle = rec.output_style;
  if (typeof rec.outputStyle === "string") md.outputStyle = rec.outputStyle;

  // Raw init-like arrays (in case a session was written with stream-json shape)
  const tools = asStringArray(rec.tools);
  if (tools) for (const t of tools) collector.tools.add(t);
  const agents = asStringArray(rec.agents);
  if (agents) md.agents = agents;
  const skills = asStringArray(rec.skills);
  if (skills) md.skills = skills;
  const slashCommands = asStringArray(rec.slash_commands);
  if (slashCommands) md.slashCommands = slashCommands;
  const plugins = asStringArray(rec.plugins);
  if (plugins) md.plugins = plugins;
  const mcpServers = asMcpServers(rec.mcp_servers);
  if (mcpServers) md.mcpServers = mcpServers;
  if (typeof rec.claude_code_version === "string") {
    md.claudeCodeVersion = rec.claude_code_version;
  }

  // deferred_tools_delta attachments — accumulate tool names
  if (rec.attachment && typeof rec.attachment === "object") {
    const att = rec.attachment as {
      type?: string;
      addedNames?: unknown;
      removedNames?: unknown;
    };
    if (att.type === "deferred_tools_delta") {
      collectStringArray(collector.tools, att.addedNames);
      if (Array.isArray(att.removedNames)) {
        for (const name of att.removedNames) {
          if (typeof name === "string") collector.tools.delete(name);
        }
      }
    }
  }
}

function finalizeMetadata(
  collector: MetadataCollector,
): SessionMetadata | undefined {
  const md = collector.md;
  if (collector.tools.size > 0) {
    md.tools = Array.from(collector.tools).sort();
  }
  const hasAny =
    md.model !== undefined ||
    md.permissionMode !== undefined ||
    md.outputStyle !== undefined ||
    md.tools !== undefined ||
    md.agents !== undefined ||
    md.skills !== undefined ||
    md.slashCommands !== undefined ||
    md.plugins !== undefined ||
    md.mcpServers !== undefined ||
    md.claudeCodeVersion !== undefined;
  return hasAny ? md : undefined;
}

function newPartId(): string {
  return `prt_${crypto.randomUUID().slice(0, 12)}`;
}

function newMessageId(): string {
  return `msg_${crypto.randomUUID().slice(0, 12)}`;
}

function isoToMs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

interface RepoInfoCache {
  repoName?: string;
  worktreeLabel?: string;
  cachedAt: number;
}

const repoInfoCache = new Map<string, RepoInfoCache>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function resolveRepoInfo(absPath: string): Promise<{
  repoName?: string;
  worktreeLabel?: string;
}> {
  const cached = repoInfoCache.get(absPath);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { repoName: cached.repoName, worktreeLabel: cached.worktreeLabel };
  }

  const result = await resolveRepoInfoUncached(absPath);
  repoInfoCache.set(absPath, { ...result, cachedAt: Date.now() });
  return result;
}

async function resolveRepoInfoUncached(absPath: string): Promise<{
  repoName?: string;
  worktreeLabel?: string;
}> {
  let dir = absPath;
  for (let i = 0; i < 20; i++) {
    const gitPath = join(dir, ".git");
    let gitStat;
    try {
      gitStat = await stat(gitPath);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }

    try {
      let configPath: string;
      let worktreeLabel: string | undefined;

      if (gitStat.isFile()) {
        // Worktree: .git is a file containing "gitdir: <path>"
        const gitContent = await readFile(gitPath, "utf8");
        if (gitContent.startsWith("gitdir:")) {
          const gitdir = gitContent.replace("gitdir:", "").trim();
          configPath = join(gitdir, "../../config");
          const parts = gitdir.split("/");
          worktreeLabel = parts[parts.length - 1];
        } else {
          return {};
        }
      } else {
        configPath = join(gitPath, "config");
      }

      const config = await readFile(configPath, "utf8").catch(() => "");
      const match = config.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/m);
      if (!match) return { worktreeLabel };

      const url = match[1].trim();
      let repoName: string | undefined;
      const hostMatch = url.match(
        /(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([^/]+\/[^/.]+)/,
      );
      if (hostMatch) repoName = hostMatch[1];
      if (!repoName) {
        const sshMatch = url.match(/:([^/]+\/[^/.]+)/);
        if (sshMatch) repoName = sshMatch[1];
      }
      if (repoName?.endsWith(".git")) repoName = repoName.slice(0, -4);

      return { repoName, worktreeLabel };
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return {};
}

export async function listProjects(): Promise<Project[]> {
  const root = claudeProjectsRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const projects: Project[] = [];
  for (const name of entries) {
    if (!name.startsWith("-")) continue;
    const dir = join(root, name);
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const sessionCount = jsonlFiles.length;
    let absPath = decodeProjectSlug(name);
    if (jsonlFiles.length > 0) {
      const firstFile = join(dir, jsonlFiles[0]);
      const cwdFromFile = await extractCwdFromJsonl(firstFile);
      if (cwdFromFile) absPath = cwdFromFile;
    }
    const info = await resolveRepoInfo(absPath);
    projects.push({
      slug: name,
      path: absPath,
      sessionCount,
      repoName: info.repoName,
      worktreeLabel: info.worktreeLabel,
    });
  }
  projects.sort((a, b) => (a.repoName ?? a.slug).localeCompare(b.repoName ?? b.slug));
  return projects;
}

async function extractCwdFromJsonl(filePath: string): Promise<string | null> {
  try {
    const file = Bun.file(filePath);
    const size = file.size;
    const slice = file.slice(0, Math.min(size, 8192));
    const text = await slice.text();
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as { cwd?: unknown };
        if (typeof rec.cwd === "string" && rec.cwd.startsWith("/")) {
          return rec.cwd;
        }
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}

async function readJsonlHead(
  filePath: string,
  maxBytes = 32 * 1024,
): Promise<string[]> {
  const file = Bun.file(filePath);
  const size = file.size;
  const sliceEnd = Math.min(size, maxBytes);
  const slice = file.slice(0, sliceEnd);
  const text = await slice.text();
  const lines = text.split("\n");
  if (sliceEnd < size && lines.length > 0) {
    lines.pop();
  }
  return lines.filter((l) => l.length > 0);
}

function extractUserText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
    }
  }
  return null;
}

function sanitizeTitle(raw: string): string | null {
  let text = raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  text = text.replace(/^\/\S+\s*/, "");
  if (!text) return null;
  return text.slice(0, 80);
}

export async function listSessionsForProject(slug: string): Promise<Session[]> {
  if (!slug.startsWith("-")) return [];
  const root = claudeProjectsRoot();
  const dir = join(root, slug);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const sessions: Session[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = join(dir, name);
    let st;
    try {
      st = await stat(filePath);
    } catch {
      continue;
    }
    const sessionId = name.slice(0, -".jsonl".length);
    let lines: string[] = [];
    try {
      lines = await readJsonlHead(filePath);
    } catch {
      continue;
    }
    let cwd = decodeProjectSlug(slug);
    let createdAt = st.birthtimeMs || st.mtimeMs;
    let title: string | undefined;
    let foundTitle = false;
    const collector = newCollector();
    for (const line of lines) {
      let rec: JsonlRecord;
      try {
        rec = JSON.parse(line) as JsonlRecord;
      } catch {
        continue;
      }
      if (!createdAt && rec.timestamp) createdAt = isoToMs(rec.timestamp);
      if (typeof rec.cwd === "string" && rec.cwd) cwd = rec.cwd;
      updateMetadataFromRecord(collector, rec);
      if (!foundTitle && rec.type === "user" && rec.message?.role === "user") {
        const text = extractUserText(rec.message.content);
        if (text) {
          const cleaned = sanitizeTitle(text);
          if (cleaned) {
            title = cleaned;
            foundTitle = true;
          }
        }
      }
    }
    sessions.push({
      id: sessionId,
      projectSlug: slug,
      title,
      cwd,
      createdAt: createdAt || st.mtimeMs,
      updatedAt: st.mtimeMs,
      status: "idle",
      lastMessageAt: st.mtimeMs,
      metadata: finalizeMetadata(collector),
    });
  }
  const customTitles = await loadSessionTitles();
  for (const s of sessions) {
    const custom = customTitles[s.id];
    if (custom) s.title = custom;
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

interface MessageBuilder {
  message: Message;
  toolUseIndex: Map<string, ToolUsePart>;
}

function createMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  createdAt: number,
  model?: string,
): MessageBuilder {
  const message: Message = {
    id: newMessageId(),
    sessionId,
    role,
    model,
    time: { created: createdAt },
    parts: [],
  };
  return { message, toolUseIndex: new Map() };
}

function pushPart(builder: MessageBuilder, part: Part): void {
  builder.message.parts.push(part);
}

function toolResultContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const pieces: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as { type?: string; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") {
          pieces.push(b.text);
        }
      }
    }
    return pieces.join("\n");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export async function loadSessionMessages(
  slug: string,
  sessionId: string,
): Promise<Message[]> {
  const { messages } = await loadSessionMessagesAndMetadata(slug, sessionId);
  return messages;
}

export async function loadSessionMetadata(
  slug: string,
  sessionId: string,
): Promise<SessionMetadata | undefined> {
  const { metadata } = await loadSessionMessagesAndMetadata(slug, sessionId);
  return metadata;
}

export async function loadSessionMessagesAndMetadata(
  slug: string,
  sessionId: string,
): Promise<{ messages: Message[]; metadata: SessionMetadata | undefined }> {
  if (!slug.startsWith("-")) return { messages: [], metadata: undefined };
  const filePath = join(claudeProjectsRoot(), slug, `${sessionId}.jsonl`);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return { messages: [], metadata: undefined };
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.length > 0);

  const messages: Message[] = [];
  const toolUseOwners = new Map<string, MessageBuilder>();
  let currentAssistant: MessageBuilder | null = null;
  const collector = newCollector();

  const flushAssistant = () => {
    if (currentAssistant) {
      messages.push(currentAssistant.message);
      currentAssistant = null;
    }
  };

  for (const line of lines) {
    let rec: JsonlRecord;
    try {
      rec = JSON.parse(line) as JsonlRecord;
    } catch {
      continue;
    }
    updateMetadataFromRecord(collector, rec);
    const type = rec.type;
    if (!type) continue;
    const time = isoToMs(rec.timestamp);

    if (type === "user" && rec.message?.role === "user") {
      const content = rec.message.content;
      const isToolResultOnly =
        Array.isArray(content) &&
        content.length > 0 &&
        content.every(
          (b) =>
            b &&
            typeof b === "object" &&
            (b as { type?: string }).type === "tool_result",
        );

      if (isToolResultOnly && Array.isArray(content)) {
        for (const block of content) {
          const b = block as {
            type: "tool_result";
            tool_use_id: string;
            content: unknown;
            is_error?: boolean;
          };
          const owner = toolUseOwners.get(b.tool_use_id);
          if (owner) {
            const toolUse = owner.toolUseIndex.get(b.tool_use_id);
            if (toolUse) {
              toolUse.state = b.is_error ? "error" : "completed";
              toolUse.result = b.content;
              toolUse.resultText = toolResultContentToText(b.content);
              if (toolUse.time) toolUse.time.end = time;
            }
          } else if (currentAssistant) {
            const trPart: ToolResultPart = {
              id: newPartId(),
              messageId: currentAssistant.message.id,
              sessionId,
              type: "tool_result",
              toolUseId: b.tool_use_id,
              content: b.content,
              isError: b.is_error,
              time: { start: time },
            };
            pushPart(currentAssistant, trPart);
          }
        }
        continue;
      }

      flushAssistant();
      const builder = createMessage(sessionId, "user", time);
      const userText = extractUserText(content) ?? "";
      if (userText) {
        const part: TextPart = {
          id: newPartId(),
          messageId: builder.message.id,
          sessionId,
          type: "text",
          text: userText,
          time: { start: time },
        };
        pushPart(builder, part);
      }
      messages.push(builder.message);
      continue;
    }

    if (type === "assistant" && rec.message?.role === "assistant") {
      const msg = rec.message;
      if (!currentAssistant) {
        currentAssistant = createMessage(sessionId, "assistant", time, msg.model);
      }
      const builder = currentAssistant;
      if (!builder.message.model && msg.model) builder.message.model = msg.model;
      builder.message.time.updated = time;

      const blocks = Array.isArray(msg.content) ? msg.content : [];
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; [k: string]: unknown };
        if (b.type === "text" && typeof b.text === "string") {
          const part: TextPart = {
            id: newPartId(),
            messageId: builder.message.id,
            sessionId,
            type: "text",
            text: b.text,
            time: { start: time },
          };
          pushPart(builder, part);
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          const part: ThinkingPart = {
            id: newPartId(),
            messageId: builder.message.id,
            sessionId,
            type: "thinking",
            text: b.thinking,
            time: { start: time },
          };
          pushPart(builder, part);
        } else if (b.type === "tool_use" && typeof b.id === "string") {
          const part: ToolUsePart = {
            id: newPartId(),
            messageId: builder.message.id,
            sessionId,
            type: "tool_use",
            tool: typeof b.name === "string" ? b.name : "unknown",
            input: b.input ?? {},
            state: "running",
            time: { start: time },
          };
          pushPart(builder, part);
          builder.toolUseIndex.set(b.id, part);
          toolUseOwners.set(b.id, builder);
        }
      }
      continue;
    }

    if (type === "summary" && typeof rec.summary === "string") {
      flushAssistant();
      const builder = createMessage(sessionId, "system", time);
      const part: TextPart = {
        id: newPartId(),
        messageId: builder.message.id,
        sessionId,
        type: "text",
        text: rec.summary,
        time: { start: time },
      };
      pushPart(builder, part);
      messages.push(builder.message);
      continue;
    }
  }

  flushAssistant();
  return { messages, metadata: finalizeMetadata(collector) };
}