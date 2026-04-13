import { getMcpMetrics } from "../mcp-metrics";

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

async function readMcpConfig(): Promise<{
  servers: McpServerConfig[];
}> {
  const servers: McpServerConfig[] = [];
  const home = Bun.env.HOME;
  if (!home) return { servers };

  const mcpPath = `${home}/.config/claude/mcp_servers.json`;
  const file = Bun.file(mcpPath);
  const exists = await file.exists();
  if (!exists) return { servers };

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      for (const [name, cfg] of Object.entries(parsed)) {
        if (cfg && typeof cfg === "object") {
          const c = cfg as { command?: string; args?: unknown; env?: unknown };
          servers.push({
            name,
            command: typeof c.command === "string" ? c.command : "",
            args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === "string") : [],
            env: c.env && typeof c.env === "object" ? c.env as Record<string, string> : undefined,
          });
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return { servers };
}

export function mcpServersRoute(_req: Request): Response {
  return Response.json({ servers: [] });
}

export async function mcpServersApiRoute(_req: Request): Promise<Response> {
  const config = await readMcpConfig();
  return Response.json(config);
}

export function mcpMetricsRoute(_req: Request): Response {
  const metrics = getMcpMetrics();
  return Response.json({ metrics });
}