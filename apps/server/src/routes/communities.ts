import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, communities, communityMembers, channels, users } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isUserInCommunity } from "../lib/authorization.js";
import { sendToCommunity } from "../websocket/connectionMaps.js";

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
  fastify.post("/", async (request, _reply) => {
    const body = createCommunitySchema.parse(request.body);

    const inviteCode = randomBytes(8).toString("hex");

    const [community] = await db
      .insert(communities)
      .values({
        name: body.name,
        inviteCode,
        createdBy: body.userId,
      })
      .returning();

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
  fastify.get("/user/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Authorization: users can only get their own communities
    if (request.user.userId !== userId) {
      return reply.status(403).send({ error: "Access denied" });
    }

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

    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Authorization: verify user is a member of this community
    const isMember = await isUserInCommunity(request.user.userId, communityId);
    if (!isMember) {
      return reply.status(403).send({ error: "Not a member of this community" });
    }

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
    const memberUsers =
      memberIds.length > 0
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

    // Get user info to include in the notification
    const user = await db.query.users.findFirst({
      where: eq(users.id, body.userId),
      columns: { id: true, displayName: true, avatarUrl: true },
    });

    // Notify all online members that a new member joined
    if (user) {
      sendToCommunity(community.id, {
        type: "member:joined",
        payload: {
          communityId: community.id,
          member: {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        },
      });
    }

    return { community };
  });
};
