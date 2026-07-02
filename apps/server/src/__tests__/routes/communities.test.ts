import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { extractToken, verifyToken, generateToken } from "../../lib/auth.js";

// Mock the database module
vi.mock("../../db/index.js", () => {
  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "community-123" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "community-123", name: "Renamed" }]),
        }),
      }),
    }),
    query: {
      communities: { findFirst: vi.fn() },
      communityMembers: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
    },
  };

  return {
    db: mockDb,
    communities: { id: "id", inviteCode: "inviteCode", createdBy: "createdBy" },
    communityMembers: { communityId: "communityId", userId: "userId" },
    channels: { communityId: "communityId", name: "name" },
    users: { id: "id" },
    messages: {},
  };
});

vi.mock("../../lib/authorization.js", () => ({
  isUserInCommunity: vi.fn(),
  isCommunityOwner: vi.fn(),
}));

vi.mock("../../websocket/connectionMaps.js", () => ({
  sendToCommunity: vi.fn(),
}));

import { db } from "../../db/index.js";
import { isCommunityOwner } from "../../lib/authorization.js";
import { communityRoutes } from "../../routes/communities.js";

const mockDb = db as unknown as {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  query: {
    communities: { findFirst: ReturnType<typeof vi.fn> };
    communityMembers: { findFirst: ReturnType<typeof vi.fn> };
    users: { findFirst: ReturnType<typeof vi.fn> };
  };
};

const authHeader = (token: string) => `Bearer ${token}`;

describe("Community Routes - Authorization", () => {
  let app: FastifyInstance;
  const ownerId = "550e8400-e29b-41d4-a716-446655440001";
  const otherUserId = "550e8400-e29b-41d4-a716-446655440002";
  const communityId = "550e8400-e29b-41d4-a716-446655440003";
  const ownerToken = generateToken({ userId: ownerId, email: "owner@example.com" });
  const otherToken = generateToken({ userId: otherUserId, email: "other@example.com" });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });
    await app.register(communityRoutes, { prefix: "/api/communities" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/communities/", () => {
    it("should reject unauthenticated requests with 401 and not create anything", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/communities/",
        payload: { name: "Hax", userId: otherUserId },
      });

      expect(response.statusCode).toBe(401);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("should attribute the community to the authenticated user, ignoring body userId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/communities/",
        headers: { authorization: authHeader(ownerToken) },
        // Attacker attempts to set a different creator via the body
        payload: { name: "My Community", userId: otherUserId },
      });

      expect(response.statusCode).toBe(200);
      // createdBy on the community insert must be the token user, not body userId
      const communityInsert = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(communityInsert.createdBy).toBe(ownerId);
    });
  });

  describe("POST /api/communities/join", () => {
    it("should reject unauthenticated requests with 401", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/communities/join",
        payload: { inviteCode: "abc123", userId: otherUserId },
      });

      expect(response.statusCode).toBe(401);
      expect(mockDb.query.communities.findFirst).not.toHaveBeenCalled();
    });

    it("should add the authenticated user, ignoring body userId", async () => {
      mockDb.query.communities.findFirst.mockResolvedValue({ id: communityId });
      mockDb.query.communityMembers.findFirst.mockResolvedValue(null);
      mockDb.query.users.findFirst.mockResolvedValue({
        id: otherUserId,
        displayName: "Other",
        avatarUrl: null,
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/communities/join",
        headers: { authorization: authHeader(otherToken) },
        payload: { inviteCode: "abc123", userId: ownerId },
      });

      expect(response.statusCode).toBe(200);
      const memberInsert = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(memberInsert.userId).toBe(otherUserId);
    });
  });

  describe("PATCH /api/communities/:communityId", () => {
    it("should reject a non-owner member with 403", async () => {
      vi.mocked(isCommunityOwner).mockResolvedValue(false);

      const response = await app.inject({
        method: "PATCH",
        url: `/api/communities/${communityId}`,
        headers: { authorization: authHeader(otherToken) },
        payload: { name: "Renamed" },
      });

      expect(response.statusCode).toBe(403);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("should allow the owner to update the community", async () => {
      vi.mocked(isCommunityOwner).mockResolvedValue(true);

      const response = await app.inject({
        method: "PATCH",
        url: `/api/communities/${communityId}`,
        headers: { authorization: authHeader(ownerToken) },
        payload: { name: "Renamed" },
      });

      expect(response.statusCode).toBe(200);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
