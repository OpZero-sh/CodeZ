/**
 * MCPAuthKit OAuth provider for CodeZero web UI.
 *
 * Authenticates users via the same MCPAuthKit instance used by the Hub and
 * Claude.ai MCP connectors. Users see the authkit.open0p.com login screen,
 * then get redirected back with a session cookie.
 *
 * Flow:
 *   1. Browser hits /api/auth/login → redirect to MCPAuthKit /oauth/authorize
 *   2. User logs in → MCPAuthKit redirects to /api/auth/callback?code=...
 *   3. Server exchanges code for mat_/mrt_ tokens
 *   4. Server sets a session cookie (signed JWT wrapping the access token)
 *   5. Subsequent requests: verify cookie → validate mat_ token
 */

import { createHash, randomBytes } from "node:crypto";
import type { AuthProvider, AuthResult } from "./auth";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  parseCookies,
  signJwt,
  verifyJwt,
  buildSessionCookie,
} from "./auth";
import type { Config } from "./config";

const AUTHKIT_URL = process.env.AUTHKIT_URL ?? "https://authkit.open0p.com";
const SCOPES = "mcp:tools agent:ws";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// In-memory PKCE store keyed by state parameter
const pendingFlows = new Map<string, { verifier: string; redirectUri: string; expiresAt: number }>();

function cleanExpiredFlows(): void {
  const now = Date.now();
  for (const [key, flow] of pendingFlows) {
    if (flow.expiresAt < now) pendingFlows.delete(key);
  }
}

async function registerClient(redirectUri: string): Promise<string> {
  const res = await fetch(`${AUTHKIT_URL}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "CodeZero Web",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function exchangeCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(`${AUTHKIT_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
  };
}

function resolveCallbackUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "127.0.0.1";
  return `${proto}://${host}/api/auth/callback`;
}

function isSecureRequest(req: Request): boolean {
  if (req.headers.get("x-forwarded-proto") === "https") return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Handle /api/auth/login — redirect to MCPAuthKit authorize endpoint
 */
export async function handleAuthKitLogin(req: Request): Promise<Response> {
  cleanExpiredFlows();

  const callbackUrl = resolveCallbackUrl(req);
  const clientId = await registerClient(callbackUrl);

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  pendingFlows.set(state, {
    verifier,
    redirectUri: callbackUrl,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
  });

  const authorizeUrl = new URL(`${AUTHKIT_URL}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  // Store clientId with the flow so we can use it in the callback
  (pendingFlows.get(state) as any).clientId = clientId;

  return Response.redirect(authorizeUrl.toString(), 302);
}

/**
 * Handle /api/auth/callback — exchange code, set session cookie
 */
export async function handleAuthKitCallback(
  req: Request,
  config: Config,
): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Login failed: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const flow = pendingFlows.get(state) as
    | { verifier: string; redirectUri: string; clientId: string; expiresAt: number }
    | undefined;
  pendingFlows.delete(state);

  if (!flow || flow.expiresAt < Date.now()) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  try {
    const tokens = await exchangeCode(code, flow.clientId, flow.redirectUri, flow.verifier);

    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(
      {
        sub: tokens.accessToken,
        iat: now,
        exp: now + SESSION_MAX_AGE_SECONDS,
      },
      config.authSecret,
    );

    const secure = isSecureRequest(req);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": buildSessionCookie(jwt, secure),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`Token exchange failed: ${msg}`, { status: 500 });
  }
}

/**
 * Create an AuthProvider that validates session cookies containing mat_ tokens.
 */
export function createAuthKitAuthProvider(config: Config): AuthProvider {
  return {
    name: "authkit",
    loginUrl: "/api/auth/login",
    logoutUrl: "/api/auth/logout",
    async verify(req: Request): Promise<AuthResult> {
      // Check session cookie
      const cookies = parseCookies(req.headers.get("cookie"));
      const token = cookies[SESSION_COOKIE_NAME];
      if (!token) return { ok: false };

      const payload = await verifyJwt(token, config.authSecret);
      if (!payload) return { ok: false };

      // payload.sub holds the mat_ access token
      if (typeof payload.sub === "string" && payload.sub.startsWith("mat_")) {
        return { ok: true, user: { sub: payload.sub } };
      }

      return { ok: false };
    },
  };
}
