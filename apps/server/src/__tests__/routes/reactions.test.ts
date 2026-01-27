import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { extractToken, verifyToken, generateToken } from "../../lib/auth.js";

// Mock the database module
vi.mock("../../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "reaction-123" }]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    query: {
      reactions: {
        findFirst: vi.fn(),
      },
      messages: {
        findFirst: vi.fn(),
      },
    },
  },
  reactions: { id: "id", messageId: "messageId", userId: "userId", emoji: "emoji" },
  messages: { id: "id", channelId: "channelId", senderId: "senderId" },
}));

// Mock authorization module
vi.mock("../../lib/authorization.js", () => ({
  canUserAccessChannel: vi.fn(),
}));

import { reactionRoutes } from "../../routes/reactions.js";
import { db } from "../../db/index.js";
import { canUserAccessChannel } from "../../lib/authorization.js";

// Helper to create test app
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (request) => {
    const token = extractToken(request.headers.authorization);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        request.user = payload;
      }
    }
  });

  await app.register(reactionRoutes, { prefix: "/api/reactions" });
  return app;
}

function createTestToken(userId: string): string {
  return generateToken({ userId, email: "test@example.com" });
}

describe("Reaction Routes - Authorization", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";
  const otherUserId = "550e8400-e29b-41d4-a716-446655440002";
  const testMessageId = "550e8400-e29b-41d4-a716-446655440003";
  const testChannelId = "550e8400-e29b-41d4-a716-446655440004";

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/reactions", () => {
    const validBody = {
      messageId: testMessageId,
      userId: testUserId,
      emoji: "👍",
    };

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/reactions",
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error");
    });

    it("should return 403 if userId does not match authenticated user", async () => {
      const token = createTestToken(testUserId);

      const response = await app.inject({
        method: "POST",
        url: "/api/reactions",
        headers: { authorization: `Bearer ${token}` },
        payload: { ...validBody, userId: otherUserId },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 403 if user cannot access the message channel", async () => {
      const token = createTestToken(testUserId);

      // Mock: message exists
      vi.mocked(db.query.messages.findFirst).mockResolvedValue({
        id: testMessageId,
        channelId: testChannelId,
        senderId: otherUserId,
        ciphertext: "encrypted",
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      });

      // Mock: user cannot access the channel
      vi.mocked(canUserAccessChannel).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/reactions",
        headers: { authorization: `Bearer ${token}` },
        payload: validBody,
      });

      expect(response.statusCode).toBe(403);
    });

    it("should allow reaction for authenticated user with channel access", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(db.query.messages.findFirst).mockResolvedValue({
        id: testMessageId,
        channelId: testChannelId,
        senderId: otherUserId,
        ciphertext: "encrypted",
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      });
      vi.mocked(canUserAccessChannel).mockResolvedValue(true);
      vi.mocked(db.query.reactions.findFirst).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/reactions",
        headers: { authorization: `Bearer ${token}` },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty("reaction");
    });
  });

  describe("DELETE /api/reactions/:reactionId", () => {
    const reactionId = "550e8400-e29b-41d4-a716-446655440005";

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/reactions/${reactionId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 403 if user did not create the reaction", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(db.query.reactions.findFirst).mockResolvedValue({
        id: reactionId,
        messageId: testMessageId,
        userId: otherUserId, // Different user created this reaction
        emoji: "👍",
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/reactions/${reactionId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should allow delete for user who created the reaction", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(db.query.reactions.findFirst).mockResolvedValue({
        id: reactionId,
        messageId: testMessageId,
        userId: testUserId, // Same user
        emoji: "👍",
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/reactions/${reactionId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 404 if reaction does not exist", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(db.query.reactions.findFirst).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/reactions/${reactionId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
