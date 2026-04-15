export interface AuthUser {
  sub: string;
}

async function readErrorMessage(res: Response): Promise<string> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    // swallow
  }
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (parsed && typeof parsed.error === "string") return parsed.error;
    } catch {
      return body;
    }
  }
  return `${res.status} ${res.statusText}`;
}

export const authApi = {
  async me(): Promise<AuthUser | null> {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    if (!r.ok) {
      // Check if server uses OAuth (authkit) — if so, redirect directly
      try {
        const info = await fetch("/api/auth/provider");
        if (info.ok) {
          const j = (await info.json()) as { provider?: string };
          if (j.provider === "authkit") {
            window.location.href = "/api/auth/login";
            return new Promise(() => {}); // never resolves, page navigates
          }
        }
      } catch {
        // Fall through to show login form
      }
      return null;
    }
    const j = (await r.json()) as { user?: AuthUser };
    return j.user ?? null;
  },

  async login(username: string, password: string): Promise<AuthUser> {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // AuthKit OAuth mode: server returns a redirect URL
    if (r.ok) {
      try {
        const j = (await r.clone().json()) as { redirect?: string; user?: AuthUser };
        if (j.redirect) {
          window.location.href = j.redirect;
          // Never resolves — page navigates away
          return new Promise(() => {});
        }
        if (j.user) return j.user;
      } catch {
        // Not JSON, fall through
      }
    }

    if (!r.ok) {
      const message = await readErrorMessage(r);
      if (r.status === 429) {
        throw new Error(
          message === "too_many_attempts"
            ? "Too many attempts. Wait a minute and try again."
            : message,
        );
      }
      if (r.status === 401) {
        throw new Error(
          message === "invalid_credentials"
            ? "Invalid username or password."
            : message,
        );
      }
      throw new Error(message || "Login failed");
    }
    const j = (await r.json()) as { user: AuthUser };
    return j.user;
  },

  async logout(): Promise<void> {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  },
};
