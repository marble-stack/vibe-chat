import { describe, it, expect } from "vitest";
import {
  parseMentions,
  buildMentionText,
  getActiveMentionQuery,
  filterMembers,
  hasMentionOf,
} from "../../lib/mentions";

describe("parseMentions", () => {
  it("returns single text token for plain text", () => {
    const tokens = parseMentions("hello world");
    expect(tokens).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("parses a single mention", () => {
    const tokens = parseMentions("hey @[Alice](abc-123) check this");
    expect(tokens).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", text: "@[Alice](abc-123)", displayName: "Alice", userId: "abc-123" },
      { type: "text", text: " check this" },
    ]);
  });

  it("parses multiple mentions", () => {
    const tokens = parseMentions("@[Alice](aaa-111) and @[Bob](bbb-222)");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({
      type: "mention",
      text: "@[Alice](aaa-111)",
      displayName: "Alice",
      userId: "aaa-111",
    });
    expect(tokens[1]).toEqual({ type: "text", text: " and " });
    expect(tokens[2]).toEqual({
      type: "mention",
      text: "@[Bob](bbb-222)",
      displayName: "Bob",
      userId: "bbb-222",
    });
  });

  it("handles mention at start of text", () => {
    const tokens = parseMentions("@[Alice](abc-123) hello");
    expect(tokens[0].type).toBe("mention");
    expect(tokens[1]).toEqual({ type: "text", text: " hello" });
  });

  it("handles mention at end of text", () => {
    const tokens = parseMentions("hello @[Alice](abc-123)");
    expect(tokens[0]).toEqual({ type: "text", text: "hello " });
    expect(tokens[1].type).toBe("mention");
  });

  it("returns empty array for empty string", () => {
    expect(parseMentions("")).toEqual([]);
  });

  it("handles full UUID format", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const tokens = parseMentions(`@[Test User](${uuid})`);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].userId).toBe(uuid);
  });

  it("does not parse malformed mentions", () => {
    const tokens = parseMentions("@[name] without uuid");
    expect(tokens).toEqual([{ type: "text", text: "@[name] without uuid" }]);
  });
});

describe("buildMentionText", () => {
  it("builds correct mention format", () => {
    expect(buildMentionText("Alice", "abc-123")).toBe("@[Alice](abc-123)");
  });

  it("handles display names with spaces", () => {
    expect(buildMentionText("John Doe", "xyz-456")).toBe("@[John Doe](xyz-456)");
  });
});

describe("getActiveMentionQuery", () => {
  it("returns null when no @ present", () => {
    expect(getActiveMentionQuery("hello world", 5)).toBeNull();
  });

  it("detects active mention at start of text", () => {
    const result = getActiveMentionQuery("@ali", 4);
    expect(result).toEqual({ query: "ali", startIndex: 0 });
  });

  it("detects active mention after space", () => {
    const result = getActiveMentionQuery("hey @bo", 7);
    expect(result).toEqual({ query: "bo", startIndex: 4 });
  });

  it("returns empty query right after @", () => {
    const result = getActiveMentionQuery("hey @", 5);
    expect(result).toEqual({ query: "", startIndex: 4 });
  });

  it("returns null for @ in middle of word", () => {
    const result = getActiveMentionQuery("email@test", 10);
    expect(result).toBeNull();
  });

  it("returns null for completed mention", () => {
    const result = getActiveMentionQuery("@[Alice](abc-123) ", 18);
    expect(result).toBeNull();
  });

  it("ignores completed mention and detects new one", () => {
    const result = getActiveMentionQuery("@[Alice](abc-123) @bo", 21);
    expect(result).toEqual({ query: "bo", startIndex: 18 });
  });

  it("returns null when query is too long", () => {
    const long = "@" + "a".repeat(51);
    expect(getActiveMentionQuery(long, long.length)).toBeNull();
  });

  it("returns null when query contains newline", () => {
    expect(getActiveMentionQuery("@he\nllo", 7)).toBeNull();
  });
});

describe("filterMembers", () => {
  const members = [
    { id: "1", displayName: "Alice" },
    { id: "2", displayName: "Bob" },
    { id: "3", displayName: "Charlie" },
    { id: "4", displayName: "Alicia" },
  ];

  it("returns all members (up to limit) for empty query", () => {
    const result = filterMembers(members, "");
    expect(result).toHaveLength(4);
  });

  it("filters by display name substring", () => {
    const result = filterMembers(members, "ali");
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.displayName)).toContain("Alice");
    expect(result.map((m) => m.displayName)).toContain("Alicia");
  });

  it("is case insensitive", () => {
    const result = filterMembers(members, "BOB");
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Bob");
  });

  it("prefers prefix matches", () => {
    const result = filterMembers(members, "al");
    expect(result[0].displayName).toBe("Alice");
    expect(result[1].displayName).toBe("Alicia");
  });

  it("respects limit", () => {
    const result = filterMembers(members, "", 2);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when no match", () => {
    const result = filterMembers(members, "xyz");
    expect(result).toHaveLength(0);
  });
});

describe("hasMentionOf", () => {
  it("returns true when user is mentioned", () => {
    expect(hasMentionOf("hey @[Alice](abc-123) check this", "abc-123")).toBe(true);
  });

  it("returns false when user is not mentioned", () => {
    expect(hasMentionOf("hey @[Alice](abc-123) check this", "xyz-999")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(hasMentionOf("hello world", "abc-123")).toBe(false);
  });

  it("handles multiple mentions", () => {
    const text = "@[Alice](aaa) and @[Bob](bbb)";
    expect(hasMentionOf(text, "aaa")).toBe(true);
    expect(hasMentionOf(text, "bbb")).toBe(true);
    expect(hasMentionOf(text, "ccc")).toBe(false);
  });
});
