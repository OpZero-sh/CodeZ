import { loadConfig } from "./config";
import { createCookieAuthProvider, createCloudflareAccessAuthProvider, withAuth } from "./auth";
import { serveStatic } from "./static";
import { EventBus } from "./bus";
import { healthRoute, healthDetailsRoute, restartRoute, setSelfHeal, setShutdownFn } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { projectsRoutes } from "./routes/projects";
import { sessionsRoutes } from "./routes/sessions";
import { eventsRoute } from "./routes/events";
import { stateRoutes } from "./routes/state";
import { searchRoutes } from "./routes/search";
import { uatRunRoute } from "./routes/uat";
import { mcpServersApiRoute, mcpMetricsRoute } from "./routes/mcp";
import { observabilityRoutes } from "./routes/observability";
import { mcpPrmRoute, mcpTransportRoute, stopMcpPoller, initMcpTransport } from "./routes/mcp-transport";
import { SessionPool } from "./claude/pool";
import { ChannelBridgePool } from "./claude/channel-bridge";
import { SelfHeal } from "./self-heal";
import { loadHubConfig, startHubAgent } from "./hub";
import type { HubMachineAgent } from "../../codez-hub/client/agent";

const config = await loadConfig();
const authProvider = config.authProvider === "cf-access"
  ? createCloudflareAccessAuthProvider()
  : createCookieAuthProvider(config);
const bus = new EventBus();
initMcpTransport(bus);
const pool = new SessionPool(bus);
const bridges = new ChannelBridgePool(bus);
const selfHeal = new SelfHeal(pool, bridges);
setSelfHeal(selfHeal);
selfHeal.start();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);

    const authed = await withAuth(req, config, authProvider);
    if (authed instanceof Response) return authed;

    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      return authRoutes(req, config, authProvider);
    }

    // MCP transport — before other routes since it handles its own auth
    if (url.pathname === "/mcp") return mcpTransportRoute(req);
    if (url.pathname === "/.well-known/oauth-protected-resource") return mcpPrmRoute(req);

    if (url.pathname === "/api/health") return healthRoute(req);
    if (url.pathname === "/api/health/details") return healthDetailsRoute(req);
    if (url.pathname === "/api/server/restart") return restartRoute(req);
    if (url.pathname === "/api/events") return eventsRoute(req, bus);
    if (url.pathname === "/api/state") return stateRoutes(req);
    if (url.pathname === "/api/search") return searchRoutes(req);
    if (url.pathname === "/api/mcp/servers") return mcpServersApiRoute(req);
    if (url.pathname === "/api/mcp/metrics") return mcpMetricsRoute(req);
    if (url.pathname === "/api/uat/run" && req.method === "POST") {
      return uatRunRoute(req, config);
    }
    if (url.pathname.startsWith("/api/observability")) {
      return observabilityRoutes(req);
    }
    if (url.pathname.startsWith("/api/projects")) {
      if (req.method === "POST") return sessionsRoutes(req, pool, bridges);
      return projectsRoutes(req, pool);
    }
    if (url.pathname.startsWith("/api/sessions"))
      return sessionsRoutes(req, pool, bridges);

    return serveStatic(req);
  },
});

console.log(
  `[opzero-claude] listening on http://${config.host}:${config.port}`,
);
console.log(
  `[opzero-claude] MCP endpoint: http://${config.host}:${config.port}/mcp`,
);

bus.emit({ type: "server.connected" });

let hubAgent: HubMachineAgent | null = null;
loadHubConfig().then(async (hubConfig) => {
  if (!hubConfig) {
    console.log("[hub] no hub config found (set CODEZ_HUB_URL + CODEZ_HUB_TOKEN to enable)");
    return;
  }
  try {
    hubAgent = await startHubAgent(hubConfig, config, pool, bus);
  } catch (err) {
    console.error("[hub] failed to connect:", err instanceof Error ? err.message : err);
  }
}).catch((err) => {
  console.error("[hub] startup error:", err);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[opzero-claude] ${signal} received, shutting down`);
  selfHeal.stop();
  stopMcpPoller();
  if (hubAgent) {
    hubAgent.disconnect();
    hubAgent = null;
  }
  try {
    await pool.disposeAll();
  } catch (err) {
    console.error("[opzero-claude] disposeAll error:", err);
  }
  try {
    bridges.stopAll();
  } catch (err) {
    console.error("[opzero-claude] bridges stopAll error:", err);
  }
  server.stop();
  process.exit(0);
}
setShutdownFn(() => shutdown("API_RESTART"));

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
