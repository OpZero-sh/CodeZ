import type { Config } from "../config";
import { getHubMachineAgent } from "../hub-agent-registry";

export type ServiceHealthStatus =
  | "ok"
  | "degraded"
  | "error"
  | "unconfigured"
  | "unknown";

export interface ServiceEndpointRow {
  id: string;
  label: string;
  url: string | null;
  status: ServiceHealthStatus;
  detail?: string;
}

export interface ServicesSettingsPayload {
  generatedAt: number;
  baseUrl: string;
  authProvider: string;
  services: ServiceEndpointRow[];
}

function wssToHttpRoot(wssUrl: string): string | null {
  try {
    const u = new URL(wssUrl);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return null;
  }
}

async function probeHttp(url: string, timeoutMs = 2800): Promise<{ ok: boolean; status?: number; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { Accept: "application/json,text/plain,*/*" },
    });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  }
}

export async function servicesSettingsRoute(req: Request, config: Config): Promise<Response> {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const authKitUrl = process.env.AUTHKIT_URL ?? "https://auth.opzero.sh";
  const hubWsUrl = process.env.CODEZ_HUB_URL?.trim() || null;
  const standaloneMcpUrl = process.env.CODEZERO_MCP_URL?.trim() || null;

  const hubAgent = getHubMachineAgent();
  const hubRegistered = hubAgent?.getStatus().connected ?? false;

  const services: ServiceEndpointRow[] = [];

  services.push({
    id: "codezero_app",
    label: "CodeZero (this server)",
    url: baseUrl,
    status: "ok",
    detail: `Listening on ${config.host}:${config.port}`,
  });

  services.push({
    id: "codezero_mcp",
    label: "Streamable MCP",
    url: `${baseUrl}/mcp`,
    status: "ok",
  });

  services.push({
    id: "codezero_events",
    label: "Session events (SSE)",
    url: `${baseUrl}/api/events`,
    status: "ok",
    detail: "Browser UI & hub machine agent",
  });

  services.push({
    id: "health_json",
    label: "Health check",
    url: `${baseUrl}/api/health`,
    status: "ok",
  });

  // Auth provider surface
  if (config.authProvider === "authkit") {
    services.push({
      id: "authkit",
      label: "MCP AuthKit (OAuth)",
      url: authKitUrl,
      status: "unknown",
      detail: "Used for AuthKit login & hub tokens",
    });
  } else if (config.authProvider === "cf-access") {
    services.push({
      id: "cf_access",
      label: "Cloudflare Access",
      url: null,
      status: "ok",
      detail: "JWT from Cf-Access-Jwt-Assertion",
    });
  } else {
    services.push({
      id: "cookie_auth",
      label: "Session auth",
      url: `${baseUrl}/api/auth`,
      status: "ok",
      detail: "Cookie / form login",
    });
  }

  if (standaloneMcpUrl) {
    const probe = await probeHttp(`${standaloneMcpUrl.replace(/\/$/, "")}/health`);
    services.push({
      id: "standalone_mcp",
      label: "Standalone MCP server",
      url: standaloneMcpUrl,
      status: probe.ok ? "ok" : "degraded",
      detail: probe.ok ? undefined : probe.error ?? `HTTP ${probe.status ?? "?"}`,
    });
  }

  // Remote CodeZ Hub
  if (!hubWsUrl) {
    services.push({
      id: "codez_hub",
      label: "CodeZ Hub (machine agent)",
      url: null,
      status: "unconfigured",
      detail: "Set CODEZ_HUB_URL (+ token or hub-auth)",
    });
  } else {
    const httpRoot = wssToHttpRoot(hubWsUrl);
    let remoteOk: boolean | undefined;
    let remoteDetail: string | undefined;
    if (httpRoot) {
      const probe = await probeHttp(`${httpRoot}/health`);
      remoteOk = probe.ok;
      if (!probe.ok) {
        remoteDetail = probe.error ?? `HTTP ${probe.status ?? "?"}`;
      }
    }

    let agentStatus: ServiceHealthStatus;
    let agentDetail: string | undefined;
    if (hubRegistered) {
      if (remoteOk === false) {
        agentStatus = "degraded";
        agentDetail = `Machine agent registered; hub GET /health failed: ${remoteDetail}`;
      } else {
        agentStatus = "ok";
        if (remoteOk === undefined) {
          agentDetail = "Machine agent registered";
        }
      }
    } else if (remoteOk === false) {
      agentStatus = "error";
      agentDetail = `Not registered; hub unreachable or unhealthy: ${remoteDetail}`;
    } else {
      agentStatus = "degraded";
      agentDetail =
        "CODEZ_HUB_URL set but machine agent not registered (token, auth, or hub side)";
    }

    services.push({
      id: "codez_hub_ws",
      label: "CodeZ Hub (machine agent)",
      url: hubWsUrl,
      status: agentStatus,
      detail: agentDetail,
    });
  }

  // Probe AuthKit /health when that row exists
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    if (s?.id !== "authkit" || !s.url) continue;
    const probe = await probeHttp(`${s.url.replace(/\/$/, "")}/health`);
    services[i] = {
      ...s,
      status: probe.ok ? "ok" : "degraded",
      detail: probe.ok ? s.detail : `GET /health failed: ${probe.error ?? probe.status}`,
    };
  }

  const body: ServicesSettingsPayload = {
    generatedAt: Date.now(),
    baseUrl,
    authProvider: config.authProvider ?? "cookie",
    services,
  };

  return Response.json(body);
}
