import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetJwtSecretCache } from "../../lib/auth.js";

describe("Auth Module - JWT Secret Security", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache for fresh imports
    vi.resetModules();
    // Reset the cached JWT secret
    resetJwtSecretCache();
    // Clone environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetJwtSecretCache();
  });

  describe("JWT_SECRET Configuration", () => {
    it("should throw if JWT_SECRET is not set in production", async () => {
      // Set production environment without JWT_SECRET
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = "production";

      // With lazy evaluation, import succeeds but calling functions throws
      const auth = await import("../../lib/auth.js");
      expect(() => auth.generateToken({ userId: "test", email: "test@test.com" })).toThrow(
        "JWT_SECRET"
      );
    });

    it("should throw if JWT_SECRET is not set in non-test environments", async () => {
      // Set development environment without JWT_SECRET
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = "development";

      // With lazy evaluation, import succeeds but calling functions throws
      const auth = await import("../../lib/auth.js");
      expect(() => auth.generateToken({ userId: "test", email: "test@test.com" })).toThrow(
        "JWT_SECRET"
      );
    });

    it("should use environment JWT_SECRET when provided", async () => {
      process.env.JWT_SECRET = "my-secure-secret-from-env";

      // Import should succeed
      const auth = await import("../../lib/auth.js");

      // Generate a token to verify the secret is being used
      const token = auth.generateToken({ userId: "test-id", email: "test@example.com" });
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      // Verify the token
      const payload = auth.verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe("test-id");
    });

    it("should work in test environment with JWT_SECRET set", async () => {
      process.env.JWT_SECRET = "test-secret";
      process.env.NODE_ENV = "test";

      const auth = await import("../../lib/auth.js");
      const token = auth.generateToken({ userId: "user-1", email: "user@test.com" });

      expect(token).toBeDefined();
      const payload = auth.verifyToken(token);
      expect(payload?.userId).toBe("user-1");
    });

    it("should never use a hardcoded default secret", async () => {
      // Delete JWT_SECRET to test fallback behavior
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = "production";

      // With lazy evaluation, import succeeds but calling functions throws
      const auth = await import("../../lib/auth.js");
      // The function should throw, not use a default
      expect(() => auth.generateToken({ userId: "test", email: "test@test.com" })).toThrow();
    });
  });

  describe("Token Generation and Verification", () => {
    beforeEach(() => {
      process.env.JWT_SECRET = "test-secret-for-token-tests";
    });

    it("should generate valid JWT tokens", async () => {
      const auth = await import("../../lib/auth.js");
      const token = auth.generateToken({ userId: "user-123", email: "test@example.com" });

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      // JWT format: header.payload.signature
      expect(token.split(".").length).toBe(3);
    });

    it("should verify valid tokens", async () => {
      const auth = await import("../../lib/auth.js");
      const token = auth.generateToken({ userId: "user-456", email: "verify@test.com" });

      const payload = auth.verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe("user-456");
      expect(payload?.email).toBe("verify@test.com");
    });

    it("should reject invalid tokens", async () => {
      const auth = await import("../../lib/auth.js");

      const payload = auth.verifyToken("invalid.token.here");
      expect(payload).toBeNull();
    });

    it("should reject tampered tokens", async () => {
      const auth = await import("../../lib/auth.js");
      const token = auth.generateToken({ userId: "user-789", email: "tamper@test.com" });

      // Tamper with the token
      const parts = token.split(".");
      parts[1] = parts[1].slice(0, -1) + "X"; // Modify payload
      const tamperedToken = parts.join(".");

      const payload = auth.verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });
  });

  describe("Token Extraction", () => {
    beforeEach(() => {
      process.env.JWT_SECRET = "test-secret";
    });

    it("should extract token from valid Authorization header", async () => {
      const auth = await import("../../lib/auth.js");

      const token = auth.extractToken("Bearer some-token-value");
      expect(token).toBe("some-token-value");
    });

    it("should return null for missing Authorization header", async () => {
      const auth = await import("../../lib/auth.js");

      const token = auth.extractToken(undefined);
      expect(token).toBeNull();
    });

    it("should return null for non-Bearer Authorization header", async () => {
      const auth = await import("../../lib/auth.js");

      const token = auth.extractToken("Basic some-credentials");
      expect(token).toBeNull();
    });

    it("should return null for empty Authorization header", async () => {
      const auth = await import("../../lib/auth.js");

      const token = auth.extractToken("");
      expect(token).toBeNull();
    });
  });
});
