import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Config {
  host: string;
  port: number;
  auth: {
    username: string;
    /**
     * Stored password. Two forms are accepted:
     *   - `"bcrypt:$2b$..."`  — bcrypt hash verified via `Bun.password.verify`
     *   - any other string     — plaintext, compared in constant time
     * First-run generation always writes a bcrypt hash.
     */
    password: string;
  };
  /** Hex secret used to sign session cookies (HS256). Generated on first run. */
  authSecret: string;
  loopbackBypass: boolean;
  /** Auth provider to use. Default is cookie-based form auth. */
  authProvider?: "cookie" | "cf-access" | "authkit";
  /** Persisted hub URL. Overridden by CODEZ_HUB_URL when present. */
  hubUrl?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4097;

const NEW_DIR_NAME = "opzero-code";
const LEGACY_DIR_NAME = "opzero-claude";

/**
 * Resolve the user's config dir with a non-breaking migration:
 *   1. $CODEZERO_CONFIG_DIR wins.
 *   2. ~/.config/opzero-code/ if it already exists (new default).
 *   3. ~/.config/opzero-claude/ for backward compat if it exists.
 *   4. ~/.config/opzero-code/ as the first-run default.
 */
export function getConfigDir(): string {
  const envDir = process.env.CODEZERO_CONFIG_DIR;
  if (envDir) return envDir;
  const home = process.env.HOME ?? homedir();
  const newDir = join(home, ".config", NEW_DIR_NAME);
  const legacyDir = join(home, ".config", LEGACY_DIR_NAME);
  if (existsSync(newDir)) return newDir;
  if (existsSync(legacyDir)) return legacyDir;
  return newDir;
}

export function getLegacyConfigDir(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, ".config", LEGACY_DIR_NAME);
}

function configPath(): string {
  const envPath = process.env.CODEZERO_CONFIG_PATH;
  if (envPath) return envPath;
  return join(getConfigDir(), "config.json");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPassword(length = 24): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[arr[i]! % alphabet.length];
  }
  return out;
}

interface FirstRunMaterial {
  config: Config;
  plainPassword: string;
}

async function buildFirstRunConfig(): Promise<FirstRunMaterial> {
  const plainPassword = randomPassword(24);
  const hashed = await Bun.password.hash(plainPassword, "bcrypt");
  return {
    plainPassword,
    config: {
      host: process.env.CODEZERO_HOST ?? DEFAULT_HOST,
      port: process.env.CODEZERO_PORT ? parseInt(process.env.CODEZERO_PORT, 10) : DEFAULT_PORT,
      auth: {
        username: `opz-${randomHex(3)}`,
        password: `bcrypt:${hashed}`,
      },
      authSecret: randomHex(32),
      loopbackBypass: true,
    },
  };
}

function printCredentialsBanner(
  config: Config,
  plainPassword: string,
  path: string,
): void {
  const line = "=".repeat(60);
  process.stderr.write(
    [
      "",
      line,
      "  CodeZero: first run — generated credentials",
      line,
      `  config:   ${path}`,
      `  username: ${config.auth.username}`,
      `  password: ${plainPassword}`,
      "",
      "  Save these now. They will not be printed again.",
      line,
      "",
    ].join("\n"),
  );
}

export function getConfigPath(): string {
  return configPath();
}

export async function saveConfig(config: Config): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
}

export async function loadConfig(): Promise<Config> {
  const path = configPath();
  const file = Bun.file(path);

  if (await file.exists()) {
    const raw = (await file.json()) as Partial<Config>;

    let mutated = false;
    let authSecret = raw.authSecret;
    if (!authSecret || typeof authSecret !== "string" || authSecret.length < 16) {
      authSecret = randomHex(32);
      mutated = true;
    }

    const config: Config = {
      host: process.env.CODEZERO_HOST ?? raw.host ?? DEFAULT_HOST,
      port: process.env.CODEZERO_PORT ? parseInt(process.env.CODEZERO_PORT, 10) : raw.port ?? DEFAULT_PORT,
      auth: {
        username: raw.auth?.username ?? `opz-${randomHex(3)}`,
        password: raw.auth?.password ?? randomPassword(24),
      },
      authSecret,
      loopbackBypass: raw.loopbackBypass ?? true,
      authProvider: raw.authProvider ?? "cookie",
      ...(raw.hubUrl ? { hubUrl: raw.hubUrl } : {}),
    };

    if (mutated) {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
    }

    return config;
  }

  const { config, plainPassword } = await buildFirstRunConfig();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
  printCredentialsBanner(config, plainPassword, path);
  return config;
}