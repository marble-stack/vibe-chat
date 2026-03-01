import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, communities, communityMembers, channels, users, messages } from "../db/index.js";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isUserInCommunity } from "../lib/authorization.js";
import { sendToCommunity } from "../websocket/connectionMaps.js";

const createCommunitySchema = z.object({
  name: z.string().min(1).max(100),
  userId: z.string().uuid(),
  iconUrl: z.string().optional(),
});

const updateCommunitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  iconUrl: z.string().nullable().optional(),
});

const joinCommunitySchema = z.object({
  inviteCode: z.string(),
  userId: z.string().uuid(),
});

export const communityRoutes: FastifyPluginAsync = async (fastify) => {
  // Activity summary - must be before /:communityId to avoid route conflict
  fastify.get("/activity-summary", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const userId = request.user.userId;

    // Get user's lastLoginAt
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { lastLoginAt: true },
    });

    const since = user?.lastLoginAt ?? null;

    // Get user's communities
    const memberships = await db.query.communityMembers.findMany({
      where: eq(communityMembers.userId, userId),
    });

    if (memberships.length === 0) {
      return { summary: [], since: since?.toISOString() ?? null };
    }

    const communityIds = memberships.map((m) => m.communityId);

    const userCommunities = await db.query.communities.findMany({
      where: (communities, { inArray }) => inArray(communities.id, communityIds),
    });

    const summary = await Promise.all(
      userCommunities.map(async (community) => {
        // Count members
        const [memberResult] = await db
          .select({ count: count() })
          .from(communityMembers)
          .where(eq(communityMembers.communityId, community.id));

        // Count new messages since lastLoginAt
        let newMessageCount = 0;
        if (since) {
          const communityChannels = await db.query.channels.findMany({
            where: eq(channels.communityId, community.id),
            columns: { id: true },
          });

          if (communityChannels.length > 0) {
            const channelIds = communityChannels.map((c) => c.id);
            const [msgResult] = await db
              .select({ count: count() })
              .from(messages)
              .where(
                and(
                  sql`${messages.channelId} IN ${channelIds}`,
                  gte(messages.createdAt, since)
                )
              );
            newMessageCount = msgResult?.count ?? 0;
          }
        }

        return {
          communityId: community.id,
          communityName: community.name,
          communityIconUrl: community.iconUrl,
          memberCount: memberResult?.count ?? 0,
          newMessageCount,
        };
      })
    );

    return { summary, since: since?.toISOString() ?? null };
  });

  // Create community
  fastify.post("/", async (request, _reply) => {
    const body = createCommunitySchema.parse(request.body);

    const inviteCode = randomBytes(8).toString("hex");

    const [community] = await db
      .insert(communities)
      .values({
        name: body.name,
        iconUrl: body.iconUrl || null,
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

  // Update community
  fastify.patch("/:communityId", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { communityId } = request.params as { communityId: string };
    const body = updateCommunitySchema.parse(request.body);

    const isMember = await isUserInCommunity(request.user.userId, communityId);
    if (!isMember) {
      return reply.status(403).send({ error: "Not a member of this community" });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.iconUrl !== undefined) updates.iconUrl = body.iconUrl;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No updates provided" });
    }

    const [updated] = await db
      .update(communities)
      .set(updates)
      .where(eq(communities.id, communityId))
      .returning();

    return { community: updated };
  });
};
