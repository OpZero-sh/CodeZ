import type { Config } from "../config";
import {
  type AuthProvider,
  SESSION_MAX_AGE_SECONDS,
  buildClearSessionCookie,
  buildSessionCookie,
  signJwt,
  timingSafeEqual,
  verifyPassword,
} from "../auth";

// ---------------------------------------------------------------------------
// Per-IP rate limiting (in-memory)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateEntry {
  count: number;
  resetAt: number;
}

const failures = new Map<string, RateEntry>();

function sweep(now: number): void {
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  sweep(now);
  const entry = failures.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= now) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  sweep(now);
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function resetFailures(ip: string): void {
  failures.delete(ip);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function isSecureRequest(req: Request): boolean {
  if (req.headers.get("x-forwarded-proto") === "https") return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

async function handleLogin(req: Request, config: Config): Promise<Response> {
  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    recordFailure(ip);
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const userOk = timingSafeEqual(username, config.auth.username);
  const passOk = await verifyPassword(password, config.auth.password);
  if (!userOk || !passOk) {
    recordFailure(ip);
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  resetFailures(ip);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { sub: config.auth.username, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
    config.authSecret,
  );

  return Response.json(
    { user: { sub: config.auth.username } },
    {
      status: 200,
      headers: { "Set-Cookie": buildSessionCookie(token, isSecureRequest(req)) },
    },
  );
}

function handleLogout(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": buildClearSessionCookie(isSecureRequest(req)) },
  });
}

async function handleMe(
  req: Request,
  provider: AuthProvider,
): Promise<Response> {
  const result = await provider.verify(req);
  if (!result.ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ user: result.user });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function authRoutes(
  req: Request,
  config: Config,
  provider: AuthProvider,
): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/api/auth/login" && req.method === "POST") {
    return handleLogin(req, config);
  }
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    return handleLogout(req);
  }
  if (pathname === "/api/auth/me" && req.method === "GET") {
    return handleMe(req, provider);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}
