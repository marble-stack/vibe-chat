import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, emojis } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { isUserInCommunity } from "../lib/authorization.js";

const createEmojiSchema = z.object({
  communityId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_]+$/, "Emoji name must be lowercase alphanumeric with underscores"),
  fileUrl: z.string().min(1),
  animated: z.boolean().default(false),
  uploadedBy: z.string().uuid(),
});

export const emojiRoutes: FastifyPluginAsync = async (fastify) => {
  // Add emoji to community
  fastify.post("/", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const body = createEmojiSchema.parse(request.body);

    // Authorization: verify user is a member of this community
    const isMember = await isUserInCommunity(request.user.userId, body.communityId);
    if (!isMember) {
      return reply.status(403).send({ error: "Not a member of this community" });
    }

    // Authorization: uploadedBy must match authenticated user
    if (request.user.userId !== body.uploadedBy) {
      return reply.status(403).send({ error: "Cannot upload emojis as another user" });
    }

    // Check if emoji name already exists in community
    const existing = await db.query.emojis.findFirst({
      where: and(eq(emojis.communityId, body.communityId), eq(emojis.name, body.name)),
    });

    if (existing) {
      return reply.status(400).send({ error: "Emoji name already exists" });
    }

    const [emoji] = await db
      .insert(emojis)
      .values({
        communityId: body.communityId,
        name: body.name,
        fileUrl: body.fileUrl,
        animated: body.animated,
        uploadedBy: body.uploadedBy,
      })
      .returning();

    return { emoji };
  });

  // Get all emojis for a community
  fastify.get("/community/:communityId", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { communityId } = request.params as { communityId: string };

    // Authorization: verify user is a member of this community
    const isMember = await isUserInCommunity(request.user.userId, communityId);
    if (!isMember) {
      return reply.status(403).send({ error: "Not a member of this community" });
    }

    const communityEmojis = await db.query.emojis.findMany({
      where: eq(emojis.communityId, communityId),
    });

    return { emojis: communityEmojis };
  });

  // Delete emoji
  fastify.delete("/:emojiId", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { emojiId } = request.params as { emojiId: string };

    // Check if emoji exists and verify ownership
    const existingEmoji = await db.query.emojis.findFirst({
      where: eq(emojis.id, emojiId),
    });

    if (!existingEmoji) {
      return reply.status(404).send({ error: "Emoji not found" });
    }

    // Authorization: only the uploader can delete the emoji
    if (existingEmoji.uploadedBy !== request.user.userId) {
      return reply.status(403).send({ error: "Cannot delete emojis uploaded by others" });
    }

    await db.delete(emojis).where(eq(emojis.id, emojiId));

    return { success: true };
  });
};
