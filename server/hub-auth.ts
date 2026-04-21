import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getConfigDir } from "./config";

const AUTHKIT_URL = process.env.AUTHKIT_URL ?? "https://authkit.open0p.com";
const SCOPES = "mcp:tools agent:ws";

function authFilePath(): string {
  return join(getConfigDir(), "hub-auth.json");
}

export const AUTH_FILE_PATH = authFilePath();

export interface StoredAuth {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Email used to provision the machine agent (noninteractive flows). */
  email?: string;
  /** Plaintext password generated on first provisioning. Persisted so that
   * the creds can be recovered after the one-time setup banner is lost. */
  agentPassword?: string;
}

export interface StoredCredentials {
  email: string;
  agentPassword: string;
}

export async function readStoredCredentials(): Promise<StoredCredentials | null> {
  const stored = await loadStoredAuth();
  if (!stored || !stored.email || !stored.agentPassword) return null;
  return { email: stored.email, agentPassword: stored.agentPassword };
}

export async function readStoredAuth(): Promise<StoredAuth | null> {
  return loadStoredAuth();
}

async function loadStoredAuth(): Promise<StoredAuth | null> {
  try {
    const raw = await readFile(authFilePath(), "utf-8");
    const data = JSON.parse(raw) as StoredAuth;
    if (data.clientId && data.accessToken && data.refreshToken) return data;
    return null;
  } catch {
    return null;
  }
}

async function saveAuth(auth: StoredAuth): Promise<void> {
  const path = authFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(redirectUri: string, baseUrl: string = AUTHKIT_URL): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "CodeZero Machine Agent",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    throw new Error(`Client registration failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function exchangeCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  baseUrl: string = AUTHKIT_URL,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
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
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
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

async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const res = await fetch(`${AUTHKIT_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: body.access_token,
    // Use rotated refresh token if returned, otherwise keep the old one
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: body.expires_in,
  };
}

function startCallbackServer(): Promise<{ port: number; codePromise: Promise<string>; close: () => void }> {
  return new Promise((resolveServer) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          if (error) {
            rejectCode(new Error(`OAuth error: ${error}`));
            return new Response(
              "<html><body><h1>Login failed</h1><p>You can close this tab.</p></body></html>",
              { headers: { "Content-Type": "text/html" } },
            );
          }
          if (code) {
            resolveCode(code);
            return new Response(
              "<html><body><h1>Login successful</h1><p>You can close this tab and return to CodeZero.</p></body></html>",
              { headers: { "Content-Type": "text/html" } },
            );
          }
        }
        return new Response("Not found", { status: 404 });
      },
    });

    resolveServer({
      port: server.port!,
      codePromise,
      close: () => server.stop(),
    });
  });
}

/**
 * Run the full OAuth login flow: register client, open browser, exchange code.
 * Returns a valid access token.
 */
export async function login(): Promise<StoredAuth> {
  console.log("[hub-auth] starting OAuth login flow...");

  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  const { port, codePromise, close } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Register client with the actual callback URI
  const finalClientId = await registerClient(redirectUri);

  const authorizeUrl = new URL(`${AUTHKIT_URL}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", finalClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.log("[hub-auth] opening browser for login...");
  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([openCmd, authorizeUrl.toString()], { stdio: ["ignore", "ignore", "ignore"] });
  console.log(`[hub-auth] if browser doesn't open, visit: ${authorizeUrl.toString()}`);

  try {
    const code = await codePromise;
    close();

    const tokens = await exchangeCode(code, finalClientId, redirectUri, verifier);
    const auth: StoredAuth = {
      clientId: finalClientId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    await saveAuth(auth);
    console.log("[hub-auth] login successful, tokens saved");
    return auth;
  } catch (err) {
    close();
    throw err;
  }
}

export interface HeadlessLoginOptions {
  email: string;
  password: string;
  authkitUrl?: string;
}

export interface HeadlessLoginResult {
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
}

async function runAuthorize(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
  email: string,
  password: string,
  mode: "signup" | "login",
): Promise<string | null> {
  const body = new URLSearchParams();
  body.set("response_type", "code");
  body.set("client_id", clientId);
  body.set("redirect_uri", redirectUri);
  body.set("scope", SCOPES);
  body.set("state", "hubsetup");
  body.set("code_challenge", challenge);
  body.set("code_challenge_method", "S256");
  body.set("email", email);
  body.set("password", password);
  body.set("action", "approve");
  body.set("auth_mode", mode);

  const res = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });

  const location = res.headers.get("location");
  if (!location) return null;
  const match = location.match(/[?&]code=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * Noninteractive PKCE login against MCPAuthKit. Mirrors scripts/hub-oauth-login.sh.
 * Attempts signup first, falls back to login on "user exists".
 */
export async function loginHeadless(
  opts: HeadlessLoginOptions,
): Promise<HeadlessLoginResult> {
  const baseUrl = opts.authkitUrl ?? AUTHKIT_URL;
  const redirectUri = "http://127.0.0.1:0/callback";
  const { verifier, challenge } = generatePKCE();

  const clientId = await registerClient(redirectUri, baseUrl);

  let code = await runAuthorize(
    baseUrl, clientId, redirectUri, challenge, opts.email, opts.password, "signup",
  );
  if (!code) {
    code = await runAuthorize(
      baseUrl, clientId, redirectUri, challenge, opts.email, opts.password, "login",
    );
  }
  if (!code) {
    throw new Error("headless login: no auth code returned from authkit (check email/password)");
  }

  const tokens = await exchangeCode(code, clientId, redirectUri, verifier, baseUrl);
  const auth: StoredAuth = {
    clientId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    email: opts.email,
    agentPassword: opts.password,
  };
  await saveAuth(auth);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    email: opts.email,
    password: opts.password,
  };
}

/**
 * Get a valid access token. Tries stored token first, refreshes if expired,
 * falls back to full login flow.
 */
export async function getAccessToken(): Promise<string> {
  const stored = await loadStoredAuth();

  if (stored) {
    // Token still valid (with 60s buffer)
    if (stored.expiresAt > Date.now() + 60_000) {
      return stored.accessToken;
    }

    // Try refresh
    console.log("[hub-auth] access token expired, refreshing...");
    const refreshed = await refreshAccessToken(stored.clientId, stored.refreshToken);
    if (refreshed) {
      const updated: StoredAuth = {
        clientId: stored.clientId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: Date.now() + refreshed.expiresIn * 1000,
        ...(stored.email ? { email: stored.email } : {}),
        ...(stored.agentPassword ? { agentPassword: stored.agentPassword } : {}),
      };
      await saveAuth(updated);
      console.log("[hub-auth] token refreshed");
      return updated.accessToken;
    }

    console.log("[hub-auth] refresh failed, re-authenticating...");
  }

  // No stored token or refresh failed — full login
  const auth = await login();
  return auth.accessToken;
}

/**
 * Create an onTokenRefresh callback for HubMachineAgent that uses
 * stored refresh tokens.
 */
export function createTokenRefresher(): () => Promise<string | null> {
  return async () => {
    try {
      const token = await getAccessToken();
      return token;
    } catch (err) {
      console.error("[hub-auth] token refresh failed:", err instanceof Error ? err.message : err);
      return null;
    }
  };
}
