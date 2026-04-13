export class CodeZClient {
  private baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:4097") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // --- Private helpers ---

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CodeZ API ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private async post(path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CodeZ API ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private async patch(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CodeZ API ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private async del(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CodeZ API ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // --- Projects ---

  async listProjects(): Promise<any> {
    return this.get("/api/projects");
  }

  async listSessions(slug: string): Promise<any> {
    return this.get(`/api/projects/${encodeURIComponent(slug)}/sessions`);
  }

  async getProjectMemory(slug: string): Promise<any> {
    return this.get(`/api/projects/${encodeURIComponent(slug)}/memory`);
  }

  // --- Sessions ---

  async getSession(id: string, slug: string): Promise<any> {
    return this.get(
      `/api/sessions/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`
    );
  }

  async createSession(
    slug: string,
    body: { cwd: string; model?: string; permissionMode?: string }
  ): Promise<any> {
    return this.post(`/api/projects/${encodeURIComponent(slug)}/sessions`, body);
  }

  async sendPrompt(
    id: string,
    body: { text: string; cwd?: string; slug?: string }
  ): Promise<any> {
    return this.post(`/api/sessions/${encodeURIComponent(id)}/prompt`, body);
  }

  async abortSession(id: string): Promise<any> {
    return this.post(`/api/sessions/${encodeURIComponent(id)}/abort`);
  }

  async disposeSession(id: string): Promise<any> {
    return this.del(`/api/sessions/${encodeURIComponent(id)}`);
  }

  async forkSession(id: string, body: { slug: string }): Promise<any> {
    return this.post(`/api/sessions/${encodeURIComponent(id)}/fork`, body);
  }

  async respondPermission(
    id: string,
    body: { request_id: string; behavior: "allow" | "deny" }
  ): Promise<any> {
    return this.post(
      `/api/sessions/${encodeURIComponent(id)}/permission`,
      body
    );
  }

  // --- Search ---

  async search(query: string): Promise<any> {
    return this.get(`/api/search?q=${encodeURIComponent(query)}`);
  }

  // --- Server ---

  async getHealth(): Promise<any> {
    return this.get("/api/health");
  }

  async getHealthDetails(): Promise<any> {
    return this.get("/api/health/details");
  }

  async getState(): Promise<any> {
    return this.get("/api/state");
  }

  async updateState(patch: Record<string, unknown>): Promise<any> {
    return this.patch("/api/state", patch);
  }

  async getObservability(): Promise<any> {
    return this.get("/api/observability/stats");
  }

  async restartServer(): Promise<any> {
    return this.post("/api/server/restart");
  }
}
