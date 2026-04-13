import type { SessionPool } from "../claude/pool";
import { listProjects, listSessionsForProject } from "../claude/history";
import { sessionStatusFor } from "./sessions";
import { readdir } from "fs/promises";
import { join } from "path";

interface OpzeroProject {
  name: string;
  path: string;
  hasGit: boolean;
}

async function scanDir(dir: string): Promise<OpzeroProject[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: join(dir, e.name),
        hasGit: false,
      }));
  } catch {
    return [];
  }
}

async function getOpzeroProjects(): Promise<{ localProjects: OpzeroProject[]; githubProjects: OpzeroProject[] }> {
  const homedir = process.env.HOME || process.env.HOMEPATH || "";
  const localDir = join(homedir, "opz");
  const githubDir = join(homedir, "opz", "opzero-sh");

  const [localProjects, githubProjects] = await Promise.all([
    scanDir(localDir),
    scanDir(githubDir),
  ]);

  return { localProjects, githubProjects };
}

export async function projectsRoutes(req: Request, pool: SessionPool): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "api") {
    return new Response("Not Found", { status: 404 });
  }

  try {
    if (parts[1] === "projects" && parts.length === 2 && req.method === "GET") {
      return Response.json(await listProjects());
    }

    if (parts[1] === "projects" && parts.length === 4 && parts[3] === "sessions" && req.method === "GET") {
      const slug = decodeURIComponent(parts[2]);
      const sessions = await listSessionsForProject(slug);
      const withStatus = await Promise.all(
        sessions.map(async (s) => ({
          ...s,
          status: await sessionStatusFor(pool, slug, s.id),
        })),
      );
      return Response.json(withStatus);
    }

    if (parts[1] === "opzero" && parts[2] === "projects" && req.method === "GET") {
      return Response.json(await getOpzeroProjects());
    }

    return new Response("Not Found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
