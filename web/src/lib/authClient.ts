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
    if (!r.ok) return null;
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
