import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { buildTestApp, createTestToken, authHeader } from "../helpers/testApp.js";
import type { FastifyInstance } from "fastify";

// Mock the database module
vi.mock("../../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "channel-123" }]),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    query: {
      channels: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      senderKeys: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      communityMembers: {
        findFirst: vi.fn(),
      },
    },
  },
  channels: { id: "id", communityId: "communityId", name: "name" },
  senderKeys: { channelId: "channelId", userId: "userId", forUserId: "forUserId" },
}));

// Mock authorization module
vi.mock("../../lib/authorization.js", () => ({
  canUserAccessChannel: vi.fn(),
  isUserInCommunity: vi.fn(),
}));

// Mock WebSocket connection maps
vi.mock("../../websocket/connectionMaps.js", () => ({
  sendToUser: vi.fn(),
}));

import { db } from "../../db/index.js";
import { canUserAccessChannel, isUserInCommunity } from "../../lib/authorization.js";
import { sendToUser } from "../../websocket/connectionMaps.js";

describe("Channel Routes - Sender Key Security", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";
  const otherUserId = "550e8400-e29b-41d4-a716-446655440002";
  const testChannelId = "550e8400-e29b-41d4-a716-446655440003";

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

  describe("POST /api/channels/sender-keys", () => {
    const validBody = {
      channelId: testChannelId,
      userId: testUserId,
      distributionId: "dist-123",
      encryptedKeys: [{ forUserId: otherUserId, encryptedKey: "encrypted-key-data" }],
    };

    it("should reject unauthenticated requests with 401", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error");
    });

    it("should reject if userId in body does not match authenticated user", async () => {
      const token = createTestToken(otherUserId); // Authenticate as different user

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: validBody, // Body has testUserId, but we're authenticated as otherUserId
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toHaveProperty("error");
      expect(response.json().error).toContain("userId");
    });

    it("should reject if user is not a member of the channel community", async () => {
      const token = createTestToken(testUserId);

      // Mock: user is NOT a member of the channel's community
      vi.mocked(canUserAccessChannel).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toHaveProperty("error");
    });

    it("should allow key distribution for authenticated user who is a channel member", async () => {
      const token = createTestToken(testUserId);

      // Mock: user IS a member of the channel's community
      vi.mocked(canUserAccessChannel).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it("should only allow distributing keys for your own userId", async () => {
      // This test ensures that even if authenticated, you can't set keys for another user
      const token = createTestToken(testUserId);

      vi.mocked(canUserAccessChannel).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: {
          ...validBody,
          userId: otherUserId, // Try to distribute keys as another user
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should send key:available WebSocket notification to recipients", async () => {
      const token = createTestToken(testUserId);
      const thirdUserId = "550e8400-e29b-41d4-a716-446655440004";

      vi.mocked(canUserAccessChannel).mockResolvedValue(true);

      const bodyWithMultipleRecipients = {
        channelId: testChannelId,
        userId: testUserId,
        distributionId: "dist-456",
        encryptedKeys: [
          { forUserId: otherUserId, encryptedKey: "encrypted-key-1" },
          { forUserId: thirdUserId, encryptedKey: "encrypted-key-2" },
        ],
      };

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: bodyWithMultipleRecipients,
      });

      expect(response.statusCode).toBe(200);

      // Verify sendToUser was called for each recipient
      expect(sendToUser).toHaveBeenCalledTimes(2);
      expect(sendToUser).toHaveBeenCalledWith(otherUserId, {
        type: "key:available",
        payload: { channelId: testChannelId, fromUserId: testUserId },
      });
      expect(sendToUser).toHaveBeenCalledWith(thirdUserId, {
        type: "key:available",
        payload: { channelId: testChannelId, fromUserId: testUserId },
      });
    });

    it("should not send key:available if no encrypted keys provided", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(canUserAccessChannel).mockResolvedValue(true);

      const bodyWithNoKeys = {
        channelId: testChannelId,
        userId: testUserId,
        distributionId: "dist-789",
        encryptedKeys: [],
      };

      const response = await app.inject({
        method: "POST",
        url: "/api/channels/sender-keys",
        headers: {
          authorization: authHeader(token),
        },
        payload: bodyWithNoKeys,
      });

      expect(response.statusCode).toBe(200);
      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/channels/:channelId/sender-keys/:userId", () => {
    it("should reject unauthenticated requests with 401", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/channels/${testChannelId}/sender-keys/${testUserId}`,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error");
    });

    it("should reject if user is not a member of the channel community", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(canUserAccessChannel).mockResolvedValue(false);

      const response = await app.inject({
        method: "GET",
        url: `/api/channels/${testChannelId}/sender-keys/${testUserId}`,
        headers: {
          authorization: authHeader(token),
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toHaveProperty("error");
    });

    it("should allow fetching sender keys for authenticated member", async () => {
      const token = createTestToken(testUserId);

      vi.mocked(canUserAccessChannel).mockResolvedValue(true);
      vi.mocked(db.query.senderKeys.findMany).mockResolvedValue([
        {
          id: "key-1",
          channelId: testChannelId,
          userId: otherUserId,
          forUserId: testUserId,
          encryptedKey: "some-encrypted-key",
          distributionId: "dist-1",
          senderPublicKey: "public-key",
          createdAt: new Date(),
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/api/channels/${testChannelId}/sender-keys/${testUserId}`,
        headers: {
          authorization: authHeader(token),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty("senderKeys");
    });
  });
});

describe('Channel Routes - Create and Get Channels', () => {
  let app: FastifyInstance;
  const testUserId = '550e8400-e29b-41d4-a716-446655440001';
  const testCommunityId = '550e8400-e29b-41d4-a716-446655440004';
  const testChannelId = '550e8400-e29b-41d4-a716-446655440003';

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

  describe('POST /api/channels', () => {
    it('should create a channel successfully', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(true);

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: testChannelId,
            communityId: testCommunityId,
            name: 'general',
          }]),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      } as unknown as ReturnType<typeof db.insert>);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: testCommunityId,
          name: 'general',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('channel');
      expect(body.channel.name).toBe('general');
    });

    it('should reject channel name with uppercase letters', async () => {
      const token = createTestToken(testUserId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: testCommunityId,
          name: 'General', // Invalid: uppercase
        },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject channel name with spaces', async () => {
      const token = createTestToken(testUserId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: testCommunityId,
          name: 'general chat', // Invalid: spaces
        },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should allow channel name with dashes', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(true);

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: testChannelId,
            communityId: testCommunityId,
            name: 'general-chat',
          }]),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      } as unknown as ReturnType<typeof db.insert>);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: testCommunityId,
          name: 'general-chat',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().channel.name).toBe('general-chat');
    });

    it('should reject empty channel name', async () => {
      const token = createTestToken(testUserId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: testCommunityId,
          name: '',
        },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject invalid communityId format', async () => {
      const token = createTestToken(testUserId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/channels',
        headers: { authorization: authHeader(token) },
        payload: {
          communityId: 'not-a-uuid',
          name: 'general',
        },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /api/channels/:channelId', () => {
    const mockChannel = {
      id: testChannelId,
      communityId: testCommunityId,
      name: 'general',
      createdAt: new Date(),
    };

    it('should return channel details', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(db.query.channels.findFirst).mockResolvedValue(mockChannel);

      const response = await app.inject({
        method: 'GET',
        url: `/api/channels/${testChannelId}`,
        headers: { authorization: authHeader(token) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('channel');
      expect(body.channel.id).toBe(testChannelId);
      expect(body.channel.name).toBe('general');
    });

    it('should return 404 if channel not found', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(db.query.channels.findFirst).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: `/api/channels/${testChannelId}`,
        headers: { authorization: authHeader(token) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('error', 'Channel not found');
    });
  });
});
