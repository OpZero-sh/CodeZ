import { hostname, platform } from "node:os";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, getConfigPath, getConfigDir } from "../server/config";
import { loginHeadless, readStoredAuth, readStoredCredentials, AUTH_FILE_PATH } from "../server/hub-auth";

export interface SetupOptions {
  skipHub: boolean;
  skipMcp: boolean;
  skipAutostart: boolean;
  noStart: boolean;
  withDesktopControl: boolean;
}

const DEFAULT_HUB_URL = "https://code.open0p.com";
const DEFAULT_AUTHKIT_URL = "https://authkit.open0p.com";
const HEALTH_URL = "http://127.0.0.1:4097/api/health";
const HEALTH_DETAILS_URL = "http://127.0.0.1:4097/api/health/details";

// Distinct exit codes so CI/agents can detect which step failed.
const EXIT_PREFLIGHT = 10;
const EXIT_INSTALL = 11;
const EXIT_CONFIG = 12;
const EXIT_HUB = 13;
const EXIT_HUBURL = 14;
const EXIT_MCP = 15;
const EXIT_AUTOSTART = 16;
const EXIT_START = 17;

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

function runStreaming(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) res();
      else rej(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", rej);
  });
}

async function runCapture(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code) => res({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => res({ code: 1, stdout, stderr }));
  });
}

async function has(cmd: string, arg = "--version"): Promise<boolean> {
  const r = await runCapture(cmd, [arg]);
  return r.code === 0;
}

function banner(lines: string[]): void {
  const line = "=".repeat(60);
  console.log("");
  console.log(line);
  for (const l of lines) console.log(`  ${l}`);
  console.log(line);
  console.log("");
}

async function preflight(hubUrl: string, skipHub: boolean): Promise<{ hasClaude: boolean }> {
  console.log("[setup] preflight");
  if (!(await has("bun"))) throw new Error("bun not found in PATH. Install from https://bun.sh");
  const hasClaude = await has("claude");
  if (!hasClaude) console.log("[setup] 'claude' CLI not found; skipping MCP registration");
  if (!skipHub) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(`${hubUrl}/health`, { method: "HEAD", signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok && res.status !== 405) {
        console.warn(`[setup] hub health probe returned ${res.status}; continuing`);
      }
    } catch (err) {
      console.warn(`[setup] hub unreachable (${err instanceof Error ? err.message : err}); continuing`);
    }
  }
  return { hasClaude };
}

async function installDepsAndBuild(root: string): Promise<void> {
  console.log("[setup] bun install (root)");
  await runStreaming("bun", ["install"], root);
  console.log("[setup] bun install (web)");
  await runStreaming("bun", ["install"], join(root, "web"));
  console.log("[setup] bun run build");
  await runStreaming("bun", ["run", "build"], root);
}

async function refreshTokenExpired(auth: { expiresAt: number }): Promise<boolean> {
  // refresh tokens have no public expiry; treat access token expiry < now - 7d as "probably dead"
  return auth.expiresAt < Date.now() - 7 * 24 * 60 * 60 * 1000;
}

async function ensureHubAuth(): Promise<{ provisioned: boolean; email?: string }> {
  if (process.env.CODEZ_HUB_TOKEN) {
    console.log("[setup] CODEZ_HUB_TOKEN env present; skipping OAuth");
    return { provisioned: false };
  }
  const stored = await readStoredAuth();
  if (stored && stored.refreshToken && !(await refreshTokenExpired(stored))) {
    const existing = await readStoredCredentials();
    if (existing) {
      console.log(`[setup] ✓ hub agent already provisioned (email: ${existing.email})`);
    } else {
      console.log(`[setup] hub auth already provisioned at ${AUTH_FILE_PATH}`);
    }
    return { provisioned: false, email: existing?.email };
  }

  const email = process.env.HUB_EMAIL ?? `opz-${hostname()}@opzero.local`;
  const password = process.env.HUB_PASSWORD ?? randomBytes(18).toString("base64url");
  const authkitUrl = process.env.AUTHKIT_URL ?? DEFAULT_AUTHKIT_URL;

  console.log(`[setup] provisioning hub machine agent at ${authkitUrl}`);
  const result = await loginHeadless({ email, password, authkitUrl });

  banner([
    "CodeZ Hub: machine agent provisioned",
    "",
    `  email:    ${result.email}`,
    `  password: ${result.password}`,
    "",
    `Saved to ${AUTH_FILE_PATH} (mode 0600). Back this file up.`,
    "Raw creds are now persisted in the auth file; recovery is local.",
  ]);
  return { provisioned: true, email: result.email };
}

async function persistHubUrl(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.hubUrl) return;
  cfg.hubUrl = process.env.CODEZ_HUB_URL ?? DEFAULT_HUB_URL;
  await saveConfig(cfg);
  console.log(`[setup] persisted hubUrl=${cfg.hubUrl} to ${getConfigPath()}`);
}

async function isMcpAlreadyRegistered(): Promise<boolean> {
  const list = await runCapture("claude", ["mcp", "list"]);
  if (list.code !== 0) return false;
  // match line starting with 'codez' (name), tolerant of whitespace/colon
  return /^\s*codez(\s|:)/m.test(list.stdout);
}

async function registerMcp(): Promise<void> {
  if (await isMcpAlreadyRegistered()) {
    console.log("[setup] claude mcp: 'codez' already registered");
    return;
  }
  console.log("[setup] registering MCP bridge with Claude Code");
  const r = await runCapture("claude", [
    "mcp", "add", "--scope", "user", "codez", "--", "http", "http://127.0.0.1:4097/mcp",
  ]);
  if (r.code === 0) {
    console.log("[setup] claude mcp add: ok");
    return;
  }
  const msg = `${r.stdout}\n${r.stderr}`;
  if (/already\s+exists/i.test(msg) || /already\s+configured/i.test(msg)) {
    console.log("[setup] claude mcp add: already registered");
    return;
  }
  console.warn(`[setup] claude mcp add failed (exit ${r.code}): ${msg.trim()}`);
}

async function installAutostart(root: string): Promise<void> {
  const plat = platform();
  if (plat === "darwin") {
    console.log("[setup] installing launchd agent");
    try {
      await runStreaming("bash", [join(root, "scripts", "install-launchd.sh")], root);
    } catch (err) {
      console.warn(`[setup] launchd install failed: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }
  if (plat === "linux") {
    const script = join(root, "scripts", "install-systemd.sh");
    if (existsSync(script)) {
      console.log("[setup] installing systemd user unit");
      try {
        await runStreaming("bash", [script], root);
      } catch (err) {
        console.warn(`[setup] systemd install failed: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }
    console.log("[setup] no install-systemd.sh found; skipping autostart");
    return;
  }
  console.log(`[setup] autostart not supported on ${plat}; start manually via 'codez serve'`);
}

async function startServer(root: string): Promise<void> {
  const plat = platform();
  if (plat === "darwin") {
    const r = await runCapture("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? 501}/sh.opzero.claude`]);
    if (r.code !== 0) console.warn(`[setup] launchctl kickstart: ${r.stderr.trim()}`);
  } else if (plat === "linux") {
    const r = await runCapture("systemctl", ["--user", "restart", "codez.service"]);
    if (r.code !== 0) console.warn(`[setup] systemctl restart: ${r.stderr.trim()}`);
  } else {
    const child = spawn("bun", ["run", "server/index.ts"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  }
}

async function poll(url: string, ok: (body: unknown) => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (ok(body)) return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function step<T>(label: string, exitCode: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[setup] step ${label} failed: ${reason}. Re-run 'codez setup' to retry.`);
    process.exit(exitCode);
  }
}

export async function runSetup(opts: SetupOptions): Promise<void> {
  const root = repoRoot();
  const hubUrl = process.env.CODEZ_HUB_URL ?? DEFAULT_HUB_URL;
  const done: string[] = [];

  const { hasClaude } = await step("preflight", EXIT_PREFLIGHT, () =>
    preflight(hubUrl, opts.skipHub),
  );
  done.push("preflight");

  await step("install+build", EXIT_INSTALL, () => installDepsAndBuild(root));
  done.push("install+build");

  // triggers first-run banner if needed
  await step("config", EXIT_CONFIG, async () => {
    await loadConfig();
  });
  done.push(`config (${getConfigDir()})`);

  if (!opts.skipHub) {
    const hubResult = await step("hub-auth", EXIT_HUB, () => ensureHubAuth());
    done.push(hubResult.provisioned ? "hub-auth (provisioned)" : "hub-auth (existing)");
    await step("hub-url", EXIT_HUBURL, () => persistHubUrl());
    done.push("hub-url");
  } else {
    done.push("hub: skipped");
  }

  if (!opts.skipMcp && hasClaude) {
    await step("mcp", EXIT_MCP, () => registerMcp());
    done.push("mcp registered");
  } else if (opts.skipMcp) {
    done.push("mcp: skipped");
  } else {
    done.push("mcp: skipped (claude not in PATH)");
  }

  if (!opts.skipAutostart) {
    await step("autostart", EXIT_AUTOSTART, () => installAutostart(root));
    done.push("autostart installed");
  } else {
    done.push("autostart: skipped");
  }

  if (!opts.noStart) {
    await step("start", EXIT_START, async () => {
      await startServer(root);
      console.log("[setup] waiting for server health...");
      const up = await poll(HEALTH_URL, () => true, 30_000);
      if (!up) {
        console.warn("[setup] server did not become healthy within 30s");
      } else {
        console.log("[setup] server healthy");
        if (!opts.skipHub) {
          const hubUp = await poll(HEALTH_DETAILS_URL, (b) => {
            const body = b as { hub?: { connected?: boolean } };
            return body?.hub?.connected === true;
          }, 15_000);
          console.log(hubUp ? "[setup] hub connected" : "[setup] hub not yet connected (will retry in background)");
        }
      }
    });
    done.push("server started");
  } else {
    done.push("start: skipped");
  }

  banner([
    "CodeZ setup complete",
    "",
    `  config:  ${getConfigPath()}`,
    `  server:  http://127.0.0.1:4097`,
    `  mcp:     http://127.0.0.1:4097/mcp`,
    opts.skipHub ? "  hub:     skipped" : `  hub:     ${hubUrl}`,
    "",
    "Completed steps:",
    ...done.map((s) => `  [x] ${s}`),
  ]);
}
