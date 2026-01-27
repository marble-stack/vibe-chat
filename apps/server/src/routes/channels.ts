import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, channels, senderKeys } from "../db/index.js";
import { eq, and, sql } from "drizzle-orm";
import { canUserAccessChannel } from "../lib/authorization.js";
import { sendToUser } from "../websocket/connectionMaps.js";

const createChannelSchema = z.object({
  communityId: z.string().uuid(),
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Channel name must be lowercase alphanumeric with dashes"),
});

const distributeSenderKeySchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  distributionId: z.string(),
  // Sender's public key at the time of distribution (for decryption after key rotation)
  senderPublicKey: z.string().optional(),
  // Array of { forUserId, encryptedKey } - key encrypted for each recipient
  encryptedKeys: z.array(z.object({
    forUserId: z.string().uuid(),
    encryptedKey: z.string(),
  })),
});

export const channelRoutes: FastifyPluginAsync = async (fastify) => {
  // Create channel
  fastify.post("/", async (request) => {
    const body = createChannelSchema.parse(request.body);

    const [channel] = await db.insert(channels).values({
      communityId: body.communityId,
      name: body.name,
    }).returning();

    return { channel };
  });

  // Get channel details
  fastify.get("/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });

    if (!channel) {
      return reply.status(404).send({ error: "Channel not found" });
    }

    return { channel };
  });

  // Distribute sender key to channel members
  fastify.post("/sender-keys", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const body = distributeSenderKeySchema.parse(request.body);

    // Authorization: can only distribute keys for yourself
    if (request.user.userId !== body.userId) {
      return reply.status(403).send({ error: "Cannot distribute sender keys for another userId" });
    }

    // Authorization: must be a member of the channel's community
    const canAccess = await canUserAccessChannel(request.user.userId, body.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Not a member of this channel's community" });
    }

    // Upsert sender keys - update if exists, insert if new
    // This is atomic and handles new members joining after initial key distribution
    if (body.encryptedKeys.length > 0) {
      for (const ek of body.encryptedKeys) {
        await db.insert(senderKeys).values({
          channelId: body.channelId,
          userId: body.userId,
          distributionId: body.distributionId,
          encryptedKey: ek.encryptedKey,
          forUserId: ek.forUserId,
          senderPublicKey: body.senderPublicKey,
        }).onConflictDoUpdate({
          target: [senderKeys.channelId, senderKeys.userId, senderKeys.forUserId],
          set: {
            encryptedKey: sql`excluded.encrypted_key`,
            senderPublicKey: sql`excluded.sender_public_key`,
            distributionId: sql`excluded.distribution_id`,
          },
        });
      }

      // Notify recipients via WebSocket that a key is now available for them
      for (const ek of body.encryptedKeys) {
        sendToUser(ek.forUserId, {
          type: 'key:available',
          payload: { channelId: body.channelId, fromUserId: body.userId },
        });
      }
    }

    return { success: true };
  });

  // Get all users who have distributed sender keys in a channel
  // This tells clients if ANY key exists, even if not distributed to them yet
  fastify.get("/:channelId/sender-keys/owners", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { channelId } = request.params as { channelId: string };

    // Authorization: must be a member of the channel's community
    const canAccess = await canUserAccessChannel(request.user.userId, channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Not a member of this channel's community" });
    }

    // Get distinct userIds who have distributed keys in this channel
    // We use sql to get distinct userId values
    const keys = await db.query.senderKeys.findMany({
      where: eq(senderKeys.channelId, channelId),
      columns: {
        userId: true,
        senderPublicKey: true,
      },
    });

    // Deduplicate by userId (each user may have multiple entries for different recipients)
    const ownerMap = new Map<string, string | null>();
    for (const key of keys) {
      if (!ownerMap.has(key.userId)) {
        ownerMap.set(key.userId, key.senderPublicKey);
      }
    }

    const senderKeyOwners = Array.from(ownerMap.entries()).map(([userId, senderPublicKey]) => ({
      userId,
      senderPublicKey,
    }));

    return { senderKeyOwners };
  });

  // Get sender keys for a channel (for a specific user)
  fastify.get("/:channelId/sender-keys/:userId", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { channelId, userId } = request.params as { channelId: string; userId: string };

    // Authorization: must be a member of the channel's community
    const canAccess = await canUserAccessChannel(request.user.userId, channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Not a member of this channel's community" });
    }

    const keys = await db.query.senderKeys.findMany({
      where: and(
        eq(senderKeys.channelId, channelId),
        eq(senderKeys.forUserId, userId)
      ),
    });

    return { senderKeys: keys };
  });
};
