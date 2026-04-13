import type { EventBus } from "../bus";
import { SessionProcess, type PermissionMode } from "./process";
import { SessionTailer } from "./tailer";

export class SessionPool {
  private map = new Map<string, SessionProcess>();
  private tailers = new Map<string, SessionTailer>();

  constructor(private bus: EventBus) {}

  get(sessionId: string): SessionProcess | undefined {
    return this.map.get(sessionId);
  }

  list(): SessionProcess[] {
    return Array.from(this.map.values());
  }

  async createNew(cwd: string, model?: string, permissionMode?: PermissionMode): Promise<{ sessionId: string }> {
    const sessionId = crypto.randomUUID();
    const proc = new SessionProcess({ sessionId, cwd, model, permissionMode }, this.bus);
    this.map.set(sessionId, proc);
    this.stopTailer(sessionId);
    return { sessionId };
  }

  async resumeOrCreate(
    sessionId: string,
    cwd: string,
    model?: string,
    permissionMode?: PermissionMode,
  ): Promise<SessionProcess> {
    const existing = this.map.get(sessionId);
    if (existing) return existing;
    const proc = new SessionProcess(
      { sessionId, cwd, model, permissionMode, resume: true },
      this.bus,
    );
    this.map.set(sessionId, proc);
    this.stopTailer(sessionId);
    return proc;
  }

  async startTailer(slug: string, sessionId: string): Promise<void> {
    if (this.map.has(sessionId)) return;
    if (this.tailers.has(sessionId)) return;
    const t = new SessionTailer(slug, sessionId, this.bus);
    this.tailers.set(sessionId, t);
    await t.start();
  }

  stopTailer(sessionId: string): void {
    const t = this.tailers.get(sessionId);
    if (t) {
      t.dispose();
      this.tailers.delete(sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const proc = this.map.get(sessionId);
    if (proc) await proc.abort();
  }

  async dispose(sessionId: string): Promise<void> {
    const proc = this.map.get(sessionId);
    if (proc) {
      await proc.dispose();
      this.map.delete(sessionId);
    }
    this.stopTailer(sessionId);
  }

  async fork(originalId: string, cwd: string, model?: string): Promise<{ sessionId: string }> {
    const sessionId = crypto.randomUUID();
    const proc = new SessionProcess({
      sessionId,
      cwd,
      model,
      resume: true,
      forkFrom: originalId,
    }, this.bus);
    this.map.set(sessionId, proc);
    this.stopTailer(sessionId);
    return { sessionId };
  }

  async disposeAll(): Promise<void> {
    await Promise.all(Array.from(this.map.values()).map((p) => p.dispose()));
    this.map.clear();
    for (const t of this.tailers.values()) t.dispose();
    this.tailers.clear();
  }
}
