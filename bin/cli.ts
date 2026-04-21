#!/usr/bin/env bun
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function printUsage(): void {
  console.log(`Usage: codez <command> [flags]

Commands:
  setup [flags]     One-shot install + provisioning
    --skip-hub              Do not provision a hub machine agent
    --skip-mcp              Do not register with the local Claude MCP config
    --skip-autostart        Do not install launchd/systemd unit
    --no-start              Do not start the server
    --with-desktop-control  Also install computer-use MCP (future)
  serve, start      Run the server in the foreground
  hub login         Run headless hub OAuth login
  hub status        Print hub auth + connectivity
  config show       Print the effective config (redacted)
  version           Show version
  help              Show this message
`);
}

async function cmdServe(): Promise<void> {
  const child = spawn("bun", ["run", "server/index.ts"], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function cmdSetup(): Promise<void> {
  const { runSetup } = await import("./setup");
  await runSetup({
    skipHub: hasFlag("--skip-hub"),
    skipMcp: hasFlag("--skip-mcp"),
    skipAutostart: hasFlag("--skip-autostart"),
    noStart: hasFlag("--no-start"),
    withDesktopControl: hasFlag("--with-desktop-control"),
  });
}

async function cmdHubLogin(): Promise<void> {
  const { loginHeadless } = await import("../server/hub-auth");
  const email = process.env.HUB_EMAIL ?? `opz-${hostname()}@opzero.local`;
  const password = process.env.HUB_PASSWORD ?? randomBytes(18).toString("base64url");
  const authkitUrl = process.env.AUTHKIT_URL ?? "https://authkit.open0p.com";
  const result = await loginHeadless({ email, password, authkitUrl });
  console.log(`[hub] logged in as ${result.email}`);
  console.log(`[hub] password (save it): ${result.password}`);
}

async function cmdHubStatus(): Promise<void> {
  const { readStoredAuth, AUTH_FILE_PATH } = await import("../server/hub-auth");
  const stored = await readStoredAuth();
  if (!stored) {
    console.log(`[hub] no stored auth at ${AUTH_FILE_PATH}`);
  } else {
    const exp = new Date(stored.expiresAt).toISOString();
    console.log(`[hub] auth file: ${AUTH_FILE_PATH}`);
    console.log(`[hub] clientId:  ${stored.clientId}`);
    console.log(`[hub] expiresAt: ${exp}`);
  }
  try {
    const res = await fetch("http://127.0.0.1:4097/api/health/details");
    if (res.ok) {
      const body = await res.json();
      console.log(`[hub] server:    ${JSON.stringify(body)}`);
    } else {
      console.log(`[hub] server:    HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[hub] server not reachable: ${err instanceof Error ? err.message : err}`);
  }
}

function redactSecret(s: string | undefined): string {
  if (!s) return "(unset)";
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function cmdConfigShow(): Promise<void> {
  const { loadConfig, getConfigPath } = await import("../server/config");
  const cfg = await loadConfig();
  console.log(`path:         ${getConfigPath()}`);
  console.log(`host:         ${cfg.host}`);
  console.log(`port:         ${cfg.port}`);
  console.log(`authProvider: ${cfg.authProvider ?? "cookie"}`);
  console.log(`username:     ${cfg.auth.username}`);
  console.log(`password:     ${cfg.auth.password.startsWith("bcrypt:") ? "(bcrypt)" : "(plaintext, redacted)"}`);
  console.log(`authSecret:   ${redactSecret(cfg.authSecret)}`);
  console.log(`loopbackBypass: ${cfg.loopbackBypass}`);
  console.log(`hubUrl:       ${cfg.hubUrl ?? "(unset)"}`);
}

async function cmdVersion(): Promise<void> {
  const pkg = JSON.parse(await Bun.file("package.json").text());
  console.log(pkg.version ?? "0.0.0");
}

async function main(): Promise<void> {
  const cmd = argv[0];
  const sub = argv[1];
  try {
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
      printUsage();
      process.exit(cmd ? 0 : 1);
    }
    switch (cmd) {
      case "setup": return await cmdSetup();
      case "serve":
      case "start": return await cmdServe();
      case "version":
      case "--version":
      case "-v": return await cmdVersion();
      case "hub":
        if (sub === "login") return await cmdHubLogin();
        if (sub === "status") return await cmdHubStatus();
        console.error(`Unknown hub subcommand: ${sub ?? "(none)"}`);
        process.exit(1);
        return;
      case "config":
        if (sub === "show") return await cmdConfigShow();
        console.error(`Unknown config subcommand: ${sub ?? "(none)"}`);
        process.exit(1);
        return;
      default:
        console.error(`Unknown command: ${cmd}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  }
}

void main();
