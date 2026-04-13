import { describe, test, expect, beforeEach } from "bun:test";
import { readChannelDiscovery, channelDiscoveryPath, channelsDir } from "./channels";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";

describe("channels", () => {
  const testDir = join(channelsDir(), "test");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  test("returns null when file does not exist", async () => {
    const result = await readChannelDiscovery("nonexistent-session-12345");
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", async () => {
    const sessionId = "invalid-json-session";
    const path = channelDiscoveryPath(sessionId);
    await Bun.write(path, "not valid json");
    try {
      const result = await readChannelDiscovery(sessionId);
      expect(result).toBeNull();
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("returns null for missing required fields", async () => {
    const sessionId = "missing-fields-session";
    const path = channelDiscoveryPath(sessionId);
    await Bun.write(path, JSON.stringify({ pid: 123 }));
    try {
      const result = await readChannelDiscovery(sessionId);
      expect(result).toBeNull();
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("returns null for stale PID (process not running)", async () => {
    const sessionId = "stale-pid-session";
    const path = channelDiscoveryPath(sessionId);
    await Bun.write(
      path,
      JSON.stringify({
        pid: 999999999,
        port: 12345,
        secret: "test-secret",
        sessionId,
        createdAt: Date.now(),
        version: "1.0.0",
      }),
    );
    try {
      const result = await readChannelDiscovery(sessionId);
      expect(result).toBeNull();
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("parses valid discovery file", async () => {
    const sessionId = "valid-session";
    const path = channelDiscoveryPath(sessionId);
    await Bun.write(
      path,
      JSON.stringify({
        pid: process.pid,
        port: 12345,
        secret: "test-secret-abc",
        sessionId,
        createdAt: Date.now(),
        version: "1.0.0",
      }),
    );
    try {
      const result = await readChannelDiscovery(sessionId);
      expect(result).not.toBeNull();
      expect(result?.pid).toBe(process.pid);
      expect(result?.port).toBe(12345);
      expect(result?.secret).toBe("test-secret-abc");
      expect(result?.sessionId).toBe(sessionId);
      expect(result?.version).toBe("1.0.0");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});