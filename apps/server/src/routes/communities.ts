import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, communities, communityMembers, channels, users } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";

const createCommunitySchema = z.object({
  name: z.string().min(1).max(100),
  userId: z.string().uuid(),
});

const joinCommunitySchema = z.object({
  inviteCode: z.string(),
  userId: z.string().uuid(),
});

export const communityRoutes: FastifyPluginAsync = async (fastify) => {
  // Create community
  fastify.post("/", async (request, reply) => {
    const body = createCommunitySchema.parse(request.body);

    const inviteCode = randomBytes(8).toString("hex");

    const [community] = await db.insert(communities).values({
      name: body.name,
      inviteCode,
      createdBy: body.userId,
    }).returning();

    // Add creator as member
    await db.insert(communityMembers).values({
      communityId: community.id,
      userId: body.userId,
    });

    // Create default #general channel
    await db.insert(channels).values({
      communityId: community.id,
      name: "general",
    });

    return { community };
  });

  // Get user's communities
  fastify.get("/user/:userId", async (request) => {
    const { userId } = request.params as { userId: string };

    const memberships = await db.query.communityMembers.findMany({
      where: eq(communityMembers.userId, userId),
    });

    const communityIds = memberships.map((m) => m.communityId);

    if (communityIds.length === 0) {
      return { communities: [] };
    }

    const userCommunities = await db.query.communities.findMany({
      where: (communities, { inArray }) => inArray(communities.id, communityIds),
    });

    return { communities: userCommunities };
  });

  // Get community details with channels
  fastify.get("/:communityId", async (request, reply) => {
    const { communityId } = request.params as { communityId: string };

    const community = await db.query.communities.findFirst({
      where: eq(communities.id, communityId),
    });

    if (!community) {
      return reply.status(404).send({ error: "Community not found" });
    }

    const communityChannels = await db.query.channels.findMany({
      where: eq(channels.communityId, communityId),
    });

    const members = await db.query.communityMembers.findMany({
      where: eq(communityMembers.communityId, communityId),
    });

    const memberIds = members.map((m) => m.userId);
    const memberUsers = memberIds.length > 0
      ? await db.query.users.findMany({
          where: (users, { inArray }) => inArray(users.id, memberIds),
          columns: { id: true, displayName: true, avatarUrl: true },
        })
      : [];

    return {
      community,
      channels: communityChannels,
      members: memberUsers,
    };
  });

  // Join community via invite code
  fastify.post("/join", async (request, reply) => {
    const body = joinCommunitySchema.parse(request.body);

    const community = await db.query.communities.findFirst({
      where: eq(communities.inviteCode, body.inviteCode),
    });

    if (!community) {
      return reply.status(404).send({ error: "Invalid invite code" });
    }

    // Check if already a member
    const existing = await db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.userId, body.userId)
      ),
    });

    if (existing) {
      return reply.status(400).send({ error: "Already a member" });
    }

    await db.insert(communityMembers).values({
      communityId: community.id,
      userId: body.userId,
    });

    return { community };
  });
};
