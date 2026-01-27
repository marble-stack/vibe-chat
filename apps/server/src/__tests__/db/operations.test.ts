import { describe, it, expect, beforeEach } from "vitest";

// Tests for database operation safety patterns
// These test the helper function that wraps .returning() operations

describe("Database Operations", () => {
  describe("assertSingleResult", () => {
    // Import the helper once it exists
    let assertSingleResult: <T>(results: T[], operation: string) => T;

    beforeEach(async () => {
      const { assertSingleResult: fn } = await import("../../lib/dbHelpers.js");
      assertSingleResult = fn;
    });

    it("should return the single result when array has one element", () => {
      const results = [{ id: "123", name: "test" }];
      const result = assertSingleResult(results, "test operation");
      expect(result).toEqual({ id: "123", name: "test" });
    });

    it("should throw error when .returning() returns empty array", () => {
      const results: unknown[] = [];
      expect(() => assertSingleResult(results, "insert community")).toThrow(
        "Database operation failed: insert community returned no results"
      );
    });

    it("should work with different object types", () => {
      const messageResult = [
        {
          id: "msg-123",
          content: "hello",
          createdAt: new Date(),
        },
      ];
      const result = assertSingleResult(messageResult, "insert message");
      expect(result.id).toBe("msg-123");
    });

    it("should preserve all properties of the result object", () => {
      const complexResult = [
        {
          id: "123",
          name: "Community",
          inviteCode: "abc123",
          createdBy: "user-456",
          createdAt: new Date("2024-01-01"),
        },
      ];
      const result = assertSingleResult(complexResult, "create");
      expect(result).toHaveProperty("id", "123");
      expect(result).toHaveProperty("name", "Community");
      expect(result).toHaveProperty("inviteCode", "abc123");
      expect(result).toHaveProperty("createdBy", "user-456");
      expect(result).toHaveProperty("createdAt");
    });
  });

  describe("Error handling patterns", () => {
    it("should provide meaningful error messages for debugging", async () => {
      const { assertSingleResult } = await import("../../lib/dbHelpers.js");

      try {
        assertSingleResult([], "insert into communities");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("insert into communities");
      }
    });
  });
});
