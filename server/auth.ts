/**
 * opzero-claude — pluggable auth layer.
 *
 * `AuthProvider` is intentionally a tiny interface so the server can be
 * distributed with a sensible default (cookie + password form) while leaving
 * room for alternative deployment models:
 *
 *   - `createCookieAuthProvider(config)` — the default; reads a signed JWT
 *     from `opzero_claude_session` and verifies it with `config.authSecret`.
 *   - A future `createCloudflareAccessProvider()` would trust the
 *     `Cf-Access-Jwt-Assertion` header and never prompt for a password.
 *   - A future `createOIDCProvider({ issuer, clientId })` would implement
 *     PKCE against any OIDC IdP and set its own session cookie.
 *
 * All providers return the same `{ ok, user: { sub } }` shape so routes can
 * stay provider-agnostic. `withAuth` only cares about which URL prefixes are
 * public and whether the provider's `verify` succeeded — nothing more.
 */

import type { Config } from "./config";

export interface AuthUser {
  sub: string;
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false };

export interface AuthProvider {
  name: string;
  verify(req: Request): Promise<AuthResult>;
  /** Optional: where a client should go to start an auth flow. */
  loginUrl?: string;
  /** Optional: where a client should POST to end its session. */
  logoutUrl?: string;
}

export const SESSION_COOKIE_NAME = "opzero_claude_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const bare = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyPassword(
  provided: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("bcrypt:")) {
    try {
      return await Bun.password.verify(provided, stored.slice(7));
    } catch {
      return false;
    }
  }
  return timingSafeEqual(provided, stored);
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648, no padding)
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encodeJSON(value: unknown): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

// ---------------------------------------------------------------------------
// Minimal HS256 JWT
// ---------------------------------------------------------------------------

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJwt(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const data = `${encodeJSON(header)}.${encodeJSON(payload)}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
  } catch {
    return null;
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") return null;

  const key = await hmacKey(secret);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64)),
    ) as SessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.sub !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function buildSessionCookie(token: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.splice(2, 0, "Secure");
  return parts.join("; ");
}

export function buildClearSessionCookie(secure = true): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.splice(2, 0, "Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Cookie provider
// ---------------------------------------------------------------------------

export function createCookieAuthProvider(config: Config): AuthProvider {
  return {
    name: "cookie",
    loginUrl: "/login",
    logoutUrl: "/api/auth/logout",
    async verify(req: Request): Promise<AuthResult> {
      const cookies = parseCookies(req.headers.get("cookie"));
      const token = cookies[SESSION_COOKIE_NAME];
      if (!token) return { ok: false };
      const payload = await verifyJwt(token, config.authSecret);
      if (!payload) return { ok: false };
      return { ok: true, user: { sub: payload.sub } };
    },
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Access provider
// ---------------------------------------------------------------------------

interface JwksKey {
  kty: string;
  kid: string;
  alg: string;
  use?: string;
  n?: string;
  e?: string;
}

interface Jwks {
  keys: JwksKey[];
}

const jwksCache: { data: Jwks | null; until: number } = { data: null, until: 0 };

async function fetchJwks(): Promise<Jwks | null> {
  const now = Date.now();
  if (jwksCache.data && jwksCache.until > now) {
    return jwksCache.data;
  }

  const host = process.env.CF_ACCESS_HOST;
  if (!host) {
    console.error("[auth] CF_ACCESS_HOST not set — cf-access auth unavailable");
    return null;
  }

  try {
    const res = await fetch(`https://${host}/cdn-cgi/access/certs`);
    if (!res.ok) {
      console.error("[auth] JWKS fetch failed:", res.status, res.statusText);
      return null;
    }
    const jwks = (await res.json()) as Jwks;
    jwksCache.data = jwks;
    jwksCache.until = now + 5 * 60 * 1000; // 5 min cache
    return jwks;
  } catch (err) {
    console.error("[auth] JWKS fetch error:", err);
    return null;
  }
}

interface JwtHeader {
  alg: string;
  typ: string;
  kid: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
}

function base64urlDecodeJson<T>(input: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlDecode(input)));
  } catch {
    return null;
  }
}

async function importRsaPublicKey(n: string): Promise<CryptoKey> {
  const nBytes = base64urlDecode(n);

  const modulus = new Uint8Array(128);
  const exponent = new Uint8Array([1, 0, 1]); // 65537

  const nLen = nBytes.length;
  if (nLen > 128) {
    const offset = nLen - 128;
    modulus.set(nBytes.slice(offset), 0);
  } else {
    modulus.set(nBytes, 128 - nLen);
  }

  const spki = new Uint8Array(
    11 + 9 + 128 + 3 + exponent.length + 4 + 9 + 128 + 3 + 3,
  );
  const view = new DataView(spki.buffer, spki.byteOffset, spki.byteLength);

  // SEQUENCE
  view.setUint8(0, 0x30);
  view.setUint8(1, spki.length - 2);

  // AlgorithmIdentifier SEQUENCE
  view.setUint8(2, 0x30);
  view.setUint8(3, 9);
  view.setUint8(4, 0x06);
  view.setUint8(5, 0x05); // id-RSAES-OAEP
  view.setUint8(6, 0x2b);
  view.setUint8(7, 0x0e);
  view.setUint8(8, 0x03);
  view.setUint8(9, 0x02);
  view.setUint8(10, 0x07);
  view.setUint8(11, 0x05);
  view.setUint8(12, 0x00);

  // BIT STRING (empty)
  view.setUint8(13, 0x03);
  view.setUint8(14, 0x82);
  view.setUint8(15, 0x01);
  view.setUint8(16, 0x01);
  view.setUint8(17, 0x00);

  // SubjectPublicKeyInfo
  const pubStart = 18;
  spki.set(new Uint8Array([0x30, 0x48, 0x02, 0x01, 0x01, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x03, 0x02, 0x11, 0x00]), pubStart);
  const keyDataStart = pubStart + 19;

  spki.set(modulus, keyDataStart);
  const expStart = keyDataStart + 128;
  spki.set(exponent, expStart);

  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyCfAccessJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = base64urlDecodeJson<JwtHeader>(headerB64);
  if (!header || header.alg !== "RS256" || !header.kid) return null;

  const jwks = await fetchJwks();
  if (!jwks) return null;

  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key || key.kty !== "RSA" || !key.n || !key.e) return null;

  let publicKey: CryptoKey;
  try {
    publicKey = await importRsaPublicKey(key.n);
  } catch (err) {
    console.error("[auth] RSA key import failed:", err);
    return null;
  }

  const sigBytes = base64urlDecode(sigB64);
  const ok = await crypto.subtle.verify(
    "RSA-OAEP",
    publicKey,
    sigBytes as BufferSource,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return null;

  const payload = base64urlDecodeJson<JwtPayload>(payloadB64);
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now || payload.iat > now + 60) return null;

  return payload;
}

export function createCloudflareAccessAuthProvider(): AuthProvider {
  return {
    name: "cloudflare-access",
    async verify(req: Request): Promise<AuthResult> {
      const token = req.headers.get("Cf-Access-Jwt-Assertion");
      if (!token) return { ok: false };

      const payload = await verifyCfAccessJwt(token);
      if (!payload) return { ok: false };

      const sub = payload.email || payload.sub;
      if (!sub) return { ok: false };

      return { ok: true, user: { sub } };
    },
  };
}

// ---------------------------------------------------------------------------
// Public-path predicate
// ---------------------------------------------------------------------------

function isPublicPath(pathname: string): boolean {
  // SPA shell — always serve so the client can render the login page.
  if (pathname === "/" || pathname === "/index.html") return true;
  // Static assets bundled by Vite.
  if (pathname.startsWith("/assets/")) return true;
  if (
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon-32.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
  ) {
    return true;
  }
  // Auth routes handle their own flow (login, callback, provider, me, logout).
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  // Health endpoint — cheap liveness probe, safe to expose.
  if (pathname === "/api/health") return true;
  // SSE events — consumed by Hub machine agent over loopback.
  if (pathname === "/api/events") return true;
  // UAT test runner endpoint — for running browser tests.
  if (pathname === "/api/uat/run") return true;
  // UAT screenshots directory
  if (pathname.startsWith("/api/uat/screenshots")) return true;
  // MCP endpoint + PRM — handles its own auth via AuthKit OAuth tokens.
  if (pathname === "/mcp") return true;
  if (pathname === "/.well-known/oauth-protected-resource") return true;
  return false;
}

// ---------------------------------------------------------------------------
// withAuth middleware
// ---------------------------------------------------------------------------

export async function withAuth(
  req: Request,
  config: Config,
  provider: AuthProvider,
): Promise<true | Response> {
  const url = new URL(req.url);

  if (isPublicPath(url.pathname)) return true;

  if (config.loopbackBypass && isLoopbackHost(req.headers.get("host"))) {
    return true;
  }

  const result = await provider.verify(req);
  if (result.ok) return true;

  return Response.json({ error: "unauthorized" }, { status: 401 });
}
