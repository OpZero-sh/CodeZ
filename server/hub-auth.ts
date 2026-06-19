import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { TokenRefreshError, type TokenResult } from "@opzero/codez-hub-client";
import { getConfigDir } from "./config";

const AUTHKIT_URL = "https://auth.opzero.sh";
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

type RefreshedTokens = { accessToken: string; refreshToken: string; expiresIn: number };

/**
 * Attempt a refresh-token grant against AuthKit. Failures are classified so a
 * caller can tell a recoverable blip from a genuinely dead credential:
 *   - network error / timeout / AuthKit 5xx → throws TokenRefreshError("transient")
 *   - 400 invalid_grant / 401 / 403 (revoked or expired family)
 *     → throws TokenRefreshError("fatal")
 * On success it returns the (possibly rotated) tokens. It never falls back to
 * an interactive login — that is the supervisor's onAuthRecovery job.
 */
async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<RefreshedTokens> {
  let res: Response;
  try {
    res = await fetch(`${AUTHKIT_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
  } catch (err) {
    // DNS, connection reset, timeout — never a verdict on the credential.
    throw new TokenRefreshError("transient", `network error contacting authkit: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 5xx (and 429) are server-side blips → keep the credential, retry later.
    if (res.status >= 500 || res.status === 429) {
      throw new TokenRefreshError("transient", `authkit ${res.status}: ${detail}`);
    }
    // 400 invalid_grant / 401 / 403 — the refresh family is revoked or expired.
    // Re-issuing the same grant would only replay it; treat as fatal.
    throw new TokenRefreshError("fatal", `authkit ${res.status}: ${detail}`);
  }

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
 * Whether this box can open a browser for the interactive login. A GUI-less
 * machine (cloud Linux, CI) can't, so it must be told which OWNER account to
 * provision under (HUB_EMAIL) rather than inventing a per-host identity — the
 * hub keys every machine to its token's user_id.
 */
export function isHeadless(): boolean {
  if (process.env.CODEZ_HEADLESS === "1" || process.env.CI) return true;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return true;
  return false;
}

/**
 * Run the full OAuth login flow: register client, open browser, exchange code.
 * Returns a valid access token.
 */
export async function login(baseUrl: string = AUTHKIT_URL): Promise<StoredAuth> {
  console.log("[hub-auth] starting OAuth login flow...");

  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  const { port, codePromise, close } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Register client with the actual callback URI
  const finalClientId = await registerClient(redirectUri, baseUrl);

  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
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

    const tokens = await exchangeCode(code, finalClientId, redirectUri, verifier, baseUrl);
    const auth: StoredAuth = {
      clientId: finalClientId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    // Capture the owner's account email so setup / `codez status` can prove the
    // machine is linked to the real user, not a synthetic per-host identity.
    const email = await fetchUserEmail(auth.accessToken, baseUrl);
    if (email) auth.email = email;
    await saveAuth(auth);
    console.log(`[hub-auth] login successful${email ? ` as ${email}` : ""}, tokens saved`);
    return auth;
  } catch (err) {
    close();
    throw err;
  }
}

async function fetchUserEmail(accessToken: string, baseUrl: string = AUTHKIT_URL): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseUrl}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { email?: string };
    return body.email;
  } catch {
    return undefined;
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

async function persistRefreshed(stored: StoredAuth, refreshed: RefreshedTokens): Promise<string> {
  const updated: StoredAuth = {
    clientId: stored.clientId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
    ...(stored.email ? { email: stored.email } : {}),
    ...(stored.agentPassword ? { agentPassword: stored.agentPassword } : {}),
  };
  await saveAuth(updated);
  return updated.accessToken;
}

/**
 * Get a valid access token. Tries stored token first, refreshes if expired,
 * falls back to full login flow. Used by the interactive/startup path
 * (loadHubConfig) — NOT by the daemon refresher, which must never block on a
 * browser login (see getAccessTokenResult / createTokenRefresher).
 */
export async function getAccessToken(): Promise<string> {
  const stored = await loadStoredAuth();

  if (stored) {
    // Token still valid (with 60s buffer)
    if (stored.expiresAt > Date.now() + 60_000) {
      return stored.accessToken;
    }

    // Try refresh; on a fatal/transient failure fall through to full login.
    console.log("[hub-auth] access token expired, refreshing...");
    try {
      const refreshed = await refreshAccessToken(stored.clientId, stored.refreshToken);
      console.log("[hub-auth] token refreshed");
      return await persistRefreshed(stored, refreshed);
    } catch (err) {
      console.log("[hub-auth] refresh failed, re-authenticating...", err instanceof Error ? err.message : err);
    }
  }

  // No stored token or refresh failed — full login
  const auth = await login();
  return auth.accessToken;
}

/**
 * Non-interactive token acquisition for the daemon supervisor. Returns a
 * classified {@link TokenResult} and NEVER triggers an interactive login:
 *   - a still-valid or freshly-refreshed token → { status: "ok" }
 *   - a transient refresh failure (network / 5xx) → { status: "transient" }
 *   - a fatal refresh failure (revoked/expired family) or no stored creds at
 *     all → { status: "fatal" }, which routes the supervisor into onAuthRecovery
 */
export async function getAccessTokenResult(): Promise<TokenResult> {
  const stored = await loadStoredAuth();
  if (!stored) {
    return { status: "fatal", reason: "no stored credentials" };
  }

  if (stored.expiresAt > Date.now() + 60_000) {
    return { status: "ok", token: stored.accessToken };
  }

  console.log("[hub-auth] access token expired, refreshing (daemon)...");
  try {
    const refreshed = await refreshAccessToken(stored.clientId, stored.refreshToken);
    const token = await persistRefreshed(stored, refreshed);
    console.log("[hub-auth] token refreshed (daemon)");
    return { status: "ok", token };
  } catch (err) {
    if (err instanceof TokenRefreshError) {
      console.warn(`[hub-auth] daemon refresh ${err.kind}: ${err.message}`);
      return { status: err.kind, reason: err.message };
    }
    console.warn("[hub-auth] daemon refresh failed (transient):", err instanceof Error ? err.message : err);
    return { status: "transient", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create an onTokenRefresh callback for HubMachineAgent. Returns a classified
 * TokenResult so the supervisor distinguishes a transient blip (keep retrying)
 * from a fatal credential failure (route to onAuthRecovery). Never blocks on an
 * interactive login.
 */
export function createTokenRefresher(): () => Promise<TokenResult> {
  return async () => getAccessTokenResult();
}

/**
 * Bounded fatal-auth recovery for HubMachineAgent. Invoked only when the hub
 * has rejected the current token as genuinely invalid. Acquires a FRESH token
 * by re-running login — never by replaying the dead refresh family:
 *   - if headless creds (email + agentPassword) are stored, re-run the
 *     noninteractive PKCE login (fresh authorization code → fresh family);
 *   - otherwise fall back to the interactive browser login.
 * Network/AuthKit hiccups during recovery are classified transient so the
 * supervisor keeps retrying with backoff rather than giving up.
 */
export function createAuthRecovery(): () => Promise<TokenResult> {
  return async () => {
    try {
      const creds = await readStoredCredentials();
      if (creds) {
        console.log("[hub-auth] auth recovery: re-running headless login (fresh token)");
        const result = await loginHeadless({ email: creds.email, password: creds.agentPassword });
        return { status: "ok", token: result.accessToken };
      }
      console.log("[hub-auth] auth recovery: no headless creds, running interactive login");
      const auth = await login();
      return { status: "ok", token: auth.accessToken };
    } catch (err) {
      if (err instanceof TokenRefreshError) {
        return { status: err.kind, reason: err.message };
      }
      console.warn("[hub-auth] auth recovery failed (will retry):", err instanceof Error ? err.message : err);
      return { status: "transient", reason: err instanceof Error ? err.message : String(err) };
    }
  };
}
