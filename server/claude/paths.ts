import { homedir } from "os";
import { join } from "path";

export function claudeConfigRoot(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

export function claudeProjectsRoot(): string {
  return join(claudeConfigRoot(), "projects");
}

export function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export function decodeProjectSlug(slug: string): string {
  return slug.replace(/^-/, "/").replace(/-/g, "/");
}

export function resolveSessionCwd(slug: string, _sessionId?: string): string {
  return decodeProjectSlug(slug);
}
