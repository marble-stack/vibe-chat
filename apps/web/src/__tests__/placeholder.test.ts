import { describe, it, expect } from "vitest";

describe("Test Infrastructure", () => {
  it("should run a basic test", () => {
    expect(1 + 1).toBe(2);
  });

  it("should have jsdom environment", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });
});
