import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, channels, senderKeys } from "../db/index.js";
import { eq, and } from "drizzle-orm";

const createChannelSchema = z.object({
  communityId: z.string().uuid(),
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Channel name must be lowercase alphanumeric with dashes"),
});

const distributeSenderKeySchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  distributionId: z.string(),
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
  fastify.post("/sender-keys", async (request) => {
    const body = distributeSenderKeySchema.parse(request.body);

    // Delete existing sender keys from this user for this channel
    await db.delete(senderKeys).where(
      and(
        eq(senderKeys.channelId, body.channelId),
        eq(senderKeys.userId, body.userId)
      )
    );

    // Insert new sender keys
    if (body.encryptedKeys.length > 0) {
      await db.insert(senderKeys).values(
        body.encryptedKeys.map((ek) => ({
          channelId: body.channelId,
          userId: body.userId,
          distributionId: body.distributionId,
          encryptedKey: ek.encryptedKey,
          forUserId: ek.forUserId,
        }))
      );
    }

    return { success: true };
  });

  // Get sender keys for a channel (for a specific user)
  fastify.get("/:channelId/sender-keys/:userId", async (request) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };

    const keys = await db.query.senderKeys.findMany({
      where: and(
        eq(senderKeys.channelId, channelId),
        eq(senderKeys.forUserId, userId)
      ),
    });

    return { senderKeys: keys };
  });
};
