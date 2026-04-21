import { readdir, unlink, readFile, stat } from "fs/promises";
import { join } from "path";
import { loadConfig, getConfigPath } from "./config";
import { SessionPool } from "./claude/pool";
import { ChannelBridgePool } from "./claude/channel-bridge";
import { channelsDir, isPidAlive } from "./claude/channels";
import { getAuthHealth } from "./claude/process";

export interface SelfHealLogEntry {
  timestamp: number;
  action: string;
  details: string;
}

export interface SubsystemStatus {
  name: string;
  healthy: boolean;
  details: string;
}

export class SelfHeal {
  private log: SelfHealLogEntry[] = [];
  private interval: number;
  private timer: Timer | null = null;
  private pool: SessionPool;
  private bridges: ChannelBridgePool;

  constructor(pool: SessionPool, bridges: ChannelBridgePool, interval = 60000) {
    this.pool = pool;
    this.bridges = bridges;
    this.interval = interval;
  }

  start(): void {
    console.log("[self-heal] starting reconciliation loop");
    this.reconcile().catch((err) => console.error("[self-heal] reconcile error:", err));
    this.timer = setInterval(() => {
      this.reconcile().catch((err) => console.error("[self-heal] reconcile error:", err));
    }, this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLog(): SelfHealLogEntry[] {
    return [...this.log];
  }

  getStatus(): SubsystemStatus[] {
    const status: SubsystemStatus[] = [];
    const now = Date.now();

    for (const proc of this.pool.list()) {
      const sessionId = proc.sessionId;
      status.push({
        name: `session:${sessionId.slice(0, 8)}`,
        healthy: true,
        details: "running",
      });
    }

    const bridgeMap = (this.bridges as unknown as { map: Map<string, { started: number }> }).map;
    for (const [sessionId, handle] of bridgeMap) {
      const age = now - handle.started;
      status.push({
        name: `bridge:${sessionId.slice(0, 8)}`,
        healthy: age < 120000,
        details: `age ${Math.round(age / 1000)}s`,
      });
    }

    const auth = getAuthHealth();
    const authHealthy = !auth.lastFailure || now - auth.lastFailure.time > 300000;
    status.push({
      name: "auth",
      healthy: authHealthy,
      details: authHealthy
        ? `preferred=${auth.preferred}`
        : `preferred=${auth.preferred}, last failure: ${auth.lastFailure!.mode} (${Math.round((now - auth.lastFailure!.time) / 1000)}s ago)`,
    });

    return status;
  }

  private logAction(action: string, details: string): void {
    const entry: SelfHealLogEntry = {
      timestamp: Date.now(),
      action,
      details,
    };
    this.log.push(entry);
    if (this.log.length > 100) {
      this.log.shift();
    }
    console.log(`[self-heal] ${action}: ${details}`);
  }

  private async reconcile(): Promise<void> {
    await this.scanStaleChannels();
    this.sweepBridges();
    this.cleanOrphans();
    this.checkAuthHealth();
    await this.checkConfigDrift();
  }

  private async scanStaleChannels(): Promise<void> {
    let dir: string;
    try {
      dir = channelsDir();
    } catch {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const path = join(dir, entry);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const obj = parsed as Record<string, unknown>;
      const pid = obj.pid;
      if (typeof pid !== "number") continue;

      if (!isPidAlive(pid)) {
        try {
          await unlink(path);
          this.logAction("channel.cleanup", `removed stale discovery ${entry} (pid ${pid})`);
        } catch (err) {
          console.error("[self-heal] failed to unlink stale channel:", err);
        }
      }
    }
  }

  private sweepBridges(): void {
    const bridgeMap = (this.bridges as unknown as {
      map: Map<string, { started: number; abort: AbortController }>;
    }).map;
    const now = Date.now();
    const toStop: string[] = [];

    for (const [sessionId, handle] of bridgeMap) {
      const age = now - handle.started;
      if (age > 60000) {
        toStop.push(sessionId);
        this.logAction("bridge.drop", `dropped stale bridge ${sessionId.slice(0, 8)} (age ${Math.round(age / 1000)}s)`);
      }
    }

    for (const sessionId of toStop) {
      bridgeMap.delete(sessionId);
      const handle = bridgeMap.get(sessionId);
      if (handle) {
        handle.abort.abort();
      }
    }
  }

  private cleanOrphans(): void {
    const poolMap = (this.pool as unknown as {
      map: Map<string, { closed: boolean; child: { exited: Promise<void> } }>;
    }).map;
    const toRemove: string[] = [];

    for (const [sessionId, proc] of poolMap) {
      if (proc.closed) {
        toRemove.push(sessionId);
        this.logAction("orphan.clean", `removed orphan session ${sessionId.slice(0, 8)}`);
      }
    }

    for (const sessionId of toRemove) {
      poolMap.delete(sessionId);
    }
  }

  private checkAuthHealth(): void {
    const health = getAuthHealth();
    if (!health.lastFailure) return;

    const age = Date.now() - health.lastFailure.time;
    if (age > 300000) return;

    this.logAction(
      "auth.health",
      `preferred=${health.preferred}, last failure: ${health.lastFailure.mode} (${Math.round(age / 1000)}s ago) — ${health.lastFailure.error}`,
    );
  }

  private async checkConfigDrift(): Promise<void> {
    const config = await loadConfig();

    if (!config.authSecret || typeof config.authSecret !== "string" || config.authSecret.length < 16) {
      this.logAction("config.warn", "authSecret missing or invalid");
      return;
    }

    const path = getConfigPath();

    try {
      const fstat = await stat(path);
      const mode = fstat.mode;
      const perm = mode & 0o777;
      if (perm !== 0o600) {
        this.logAction("config.warn", `config permissions ${perm.toString(8)}, expected 600`);
      }
    } catch {
      // file might not exist yet, ignore
    }
  }
}