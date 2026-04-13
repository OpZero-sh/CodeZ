import { homedir } from "os";
import { join } from "path";

export function claudeProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

export function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export function decodeProjectSlug(slug: string): string {
  return slug.replace(/^-/, "/").replace(/-/g, "/");
}
