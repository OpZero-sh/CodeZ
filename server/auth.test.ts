import { describe, test, expect } from "bun:test";
import { signJwt, verifyJwt, verifyPassword, timingSafeEqual } from "./auth";

const TEST_SECRET = "test-secret-key-for-testing-only-123456";

describe("auth", () => {
  describe("signJwt/verifyJwt round trip", () => {
    test("signs and verifies a valid token", async () => {
      const payload = {
        sub: "user-123",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = await signJwt(payload, TEST_SECRET);
      const result = await verifyJwt(token, TEST_SECRET);
      expect(result).not.toBeNull();
      expect(result?.sub).toBe("user-123");
    });

    test("rejects token with wrong secret", async () => {
      const payload = {
        sub: "user-123",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = await signJwt(payload, TEST_SECRET);
      const result = await verifyJwt(token, "wrong-secret");
      expect(result).toBeNull();
    });

    test("rejects expired token", async () => {
      const payload = {
        sub: "user-123",
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      const token = await signJwt(payload, TEST_SECRET);
      const result = await verifyJwt(token, TEST_SECRET);
      expect(result).toBeNull();
    });

    test("rejects malformed token", async () => {
      const result = await verifyJwt("not.a.valid.token", TEST_SECRET);
      expect(result).toBeNull();
    });
  });

  describe("verifyPassword", () => {
    test("accepts plaintext match", async () => {
      const result = await verifyPassword("testpass", "testpass");
      expect(result).toBe(true);
    });

    test("rejects plaintext mismatch", async () => {
      const result = await verifyPassword("wrongpass", "testpass");
      expect(result).toBe(false);
    });

    test("accepts bcrypt match", async () => {
      const hashed = await Bun.password.hash("testpass");
      const result = await verifyPassword("testpass", `bcrypt:${hashed}`);
      expect(result).toBe(true);
    });

    test("rejects bcrypt mismatch", async () => {
      const hashed = await Bun.password.hash("testpass");
      const result = await verifyPassword("wrongpass", `bcrypt:${hashed}`);
      expect(result).toBe(false);
    });
  });

  describe("timingSafeEqual", () => {
    test("returns true for equal strings", () => {
      expect(timingSafeEqual("abc", "abc")).toBe(true);
    });

    test("returns false for different length strings", () => {
      expect(timingSafeEqual("abc", "abcd")).toBe(false);
    });

    test("returns false for different content", () => {
      expect(timingSafeEqual("abc", "abd")).toBe(false);
    });
  });
});