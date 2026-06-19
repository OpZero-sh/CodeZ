// Boot-time guard against a stale instance squatting on our port.
//
// Failure mode this prevents: a previous-generation server process (e.g. a
// detached child from /api/server/restart, or a pre-0436223 build wedged on a
// failing hub-auth loop) keeps the TCP port bound but is otherwise dead to the
// hub. launchd's KeepAlive then restarts a fresh process which throws
// EADDRINUSE at bind, exits, and gets restarted again — crash-looping forever
// behind the zombie while the machine shows offline. We are the canonical
// instance launchd just started, so any *CodeZero* process already holding the
// port is by definition stale: evict it before binding.
//
// We never kill a process we can't positively identify as our own server, so a
// genuinely foreign listener on the port causes a clean exit-for-retry instead
// of collateral damage.

const LSOF_CANDIDATES = ["/usr/sbin/lsof", "/usr/bin/lsof", "lsof"];
const TERM_GRACE_MS = 3000;
const KILL_GRACE_MS = 1000;
const FREE_POLL_MS = 150;
const FREE_TIMEOUT_MS = 5000;

export interface PortGuardResult {
  ok: boolean;
  reason?: string;
}

// Returns LISTEN-state PIDs on `port` (excluding ourselves), or null when we
// cannot determine occupancy (lsof missing) — null means "skip the preflight
// and let bind decide" rather than "port is free".
function listenersOnPort(port: number): number[] | null {
  for (const bin of LSOF_CANDIDATES) {
    try {
      const res = Bun.spawnSync([bin, "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      // exitCode 0 (matches) and 1 (no matches) both mean lsof ran fine.
      const out = res.stdout ? res.stdout.toString() : "";
      return out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    } catch {
      // Binary not at this path (ENOENT). Try the next candidate.
    }
  }
  return null;
}

function processCommand(pid: number): string | null {
  try {
    const res = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = res.stdout ? res.stdout.toString().trim() : "";
    return out || null;
  } catch {
    return null;
  }
}

function isOurServer(cmd: string): boolean {
  return /\bbun\b/.test(cmd) && cmd.includes("server/index.ts");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function evict(pid: number, log: (m: string) => void): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const graceUntil = Date.now() + TERM_GRACE_MS;
  while (Date.now() < graceUntil) {
    if (!isAlive(pid)) return;
    Bun.sleepSync(FREE_POLL_MS);
  }
  if (!isAlive(pid)) return;
  log(`[port-guard] pid ${pid} ignored SIGTERM; sending SIGKILL`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  const killUntil = Date.now() + KILL_GRACE_MS;
  while (Date.now() < killUntil && isAlive(pid)) {
    Bun.sleepSync(FREE_POLL_MS);
  }
}

// Synchronously reclaim `port` if a stale CodeZero instance holds it. Safe to
// call before Bun.serve and again after an EADDRINUSE bind race.
export function ensurePortAvailable(port: number, log: (m: string) => void): PortGuardResult {
  const pids = listenersOnPort(port);
  if (pids === null) {
    log(`[port-guard] lsof unavailable; skipping port ${port} preflight`);
    return { ok: true };
  }
  if (pids.length === 0) return { ok: true };

  const foreign: number[] = [];
  for (const pid of pids) {
    const cmd = processCommand(pid);
    if (cmd && isOurServer(cmd)) {
      log(`[port-guard] evicting stale CodeZero instance pid ${pid} holding port ${port}`);
      evict(pid, log);
    } else {
      foreign.push(pid);
      log(`[port-guard] port ${port} held by foreign pid ${pid}: ${cmd ?? "unknown"}`);
    }
  }

  const deadline = Date.now() + FREE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const remaining = listenersOnPort(port);
    if (remaining === null || remaining.length === 0) return { ok: true };
    Bun.sleepSync(FREE_POLL_MS);
  }

  const still = listenersOnPort(port) ?? [];
  if (still.length === 0) return { ok: true };
  if (foreign.length > 0) {
    return { ok: false, reason: `port ${port} held by foreign process(es) ${foreign.join(", ")}` };
  }
  return { ok: false, reason: `port ${port} still occupied after eviction` };
}

export function isAddrInUse(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "EADDRINUSE") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /EADDRINUSE|address already in use/i.test(msg);
}
