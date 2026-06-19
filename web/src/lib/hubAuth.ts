// Browser-side MCPAuthKit OAuth (authorization_code + PKCE) for the SPA when it
// is served from the hub Worker at code.opzero.sh. In this "hosted" mode there
// is no local bun server and no cookie user: the MCPAuthKit `mat_` access token
// IS the session. Local (bun-server) mode never imports this file, so the cookie
// and server-side-authkit flows are unaffected.
//
// MCPAuthKit is OAuth 2.1 with RFC 7591 dynamic client registration; it
// auto-registers an unknown client on first /oauth/authorize and accepts the
// browser's own redirect_uri, so no server-side allowlist change is needed.

const ISSUER = "https://auth.opzero.sh";
const SCOPE = "mcp:tools agent:ws";
const REDIRECT_URI = `${window.location.origin}/`;

// Access tokens live ~1h; refresh a little early so an in-flight call never
// races the expiry.
const REFRESH_BEFORE_MS = 55 * 60 * 1000;

const K = {
  token: "hub.mat",
  refresh: "hub.mrt",
  issued: "hub.issued",
  client: "hub.client_id",
  verifier: "hub.pkce_verifier",
  state: "hub.pkce_state",
} as const;

function base64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
}

function persistTokens(json: TokenResponse): string | null {
  if (!json.access_token) return null;
  localStorage.setItem(K.token, json.access_token);
  if (json.refresh_token) localStorage.setItem(K.refresh, json.refresh_token);
  localStorage.setItem(K.issued, Date.now().toString());
  return json.access_token;
}

async function registerClient(): Promise<string> {
  const existing = localStorage.getItem(K.client);
  if (existing) return existing;
  const res = await fetch(`${ISSUER}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "CodeZero (code.opzero.sh)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`client registration failed: ${res.status}`);
  const json = (await res.json()) as { client_id?: string };
  if (!json.client_id) throw new Error("registration returned no client_id");
  localStorage.setItem(K.client, json.client_id);
  return json.client_id;
}

async function exchangeCode(code: string, returnedState: string): Promise<string | null> {
  const verifier = sessionStorage.getItem(K.verifier);
  const expectedState = sessionStorage.getItem(K.state);
  sessionStorage.removeItem(K.verifier);
  sessionStorage.removeItem(K.state);
  if (!verifier || !expectedState || returnedState !== expectedState) {
    throw new Error("PKCE state mismatch");
  }
  const clientId = localStorage.getItem(K.client);
  if (!clientId) throw new Error("missing client_id for token exchange");
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return persistTokens((await res.json()) as TokenResponse);
}

async function startAuthorize(): Promise<never> {
  const clientId = await registerClient();
  const verifier = randomString(64);
  const challenge = base64url(await sha256(verifier));
  const stateValue = randomString(32);
  sessionStorage.setItem(K.verifier, verifier);
  sessionStorage.setItem(K.state, stateValue);
  const url = new URL(`${ISSUER}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", stateValue);
  window.location.href = url.toString();
  // The page navigates away; nothing downstream should run.
  return new Promise<never>(() => {});
}

export function hasHubSession(): boolean {
  return !!localStorage.getItem(K.token);
}

export function cachedHubToken(): string | null {
  return localStorage.getItem(K.token);
}

export function clearHubAuth(): void {
  localStorage.removeItem(K.token);
  localStorage.removeItem(K.refresh);
  localStorage.removeItem(K.issued);
}

export async function refreshHubToken(): Promise<string | null> {
  const refresh = localStorage.getItem(K.refresh);
  const clientId = localStorage.getItem(K.client);
  if (!refresh || !clientId) return null;
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    clearHubAuth();
    return null;
  }
  return persistTokens((await res.json()) as TokenResponse);
}

// Returns a valid mat_ token, driving the OAuth flow as far as needed. May
// navigate the page to MCPAuthKit (returning a never-resolving promise) when a
// fresh authorization is required.
export async function getHubAccessToken(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const error = params.get("error");

  // Complete a redirect callback if we just came back from MCPAuthKit.
  if (code && returnedState) {
    const token = await exchangeCode(code, returnedState);
    window.history.replaceState({}, document.title, window.location.pathname);
    return token;
  }
  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    throw new Error(`authorization failed: ${error}`);
  }

  // Reuse a cached token, refreshing if it is near expiry.
  const token = localStorage.getItem(K.token);
  const issued = Number(localStorage.getItem(K.issued) ?? 0);
  if (token && Date.now() - issued < REFRESH_BEFORE_MS) return token;
  if (token) {
    const refreshed = await refreshHubToken();
    if (refreshed) return refreshed;
  }

  // No usable token: begin the authorization-code + PKCE redirect.
  return startAuthorize();
}
