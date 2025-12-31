import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, emojis } from "../db/index.js";
import { eq, and } from "drizzle-orm";

const createEmojiSchema = z.object({
  communityId: z.string().uuid(),
  name: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/, "Emoji name must be lowercase alphanumeric with underscores"),
  fileUrl: z.string().url(),
  animated: z.boolean().default(false),
  uploadedBy: z.string().uuid(),
});

export const emojiRoutes: FastifyPluginAsync = async (fastify) => {
  // Add emoji to community
  fastify.post("/", async (request, reply) => {
    const body = createEmojiSchema.parse(request.body);

    // Check if emoji name already exists in community
    const existing = await db.query.emojis.findFirst({
      where: and(
        eq(emojis.communityId, body.communityId),
        eq(emojis.name, body.name)
      ),
    });

    if (existing) {
      return reply.status(400).send({ error: "Emoji name already exists" });
    }

    const [emoji] = await db.insert(emojis).values({
      communityId: body.communityId,
      name: body.name,
      fileUrl: body.fileUrl,
      animated: body.animated,
      uploadedBy: body.uploadedBy,
    }).returning();

    return { emoji };
  });

  // Get all emojis for a community
  fastify.get("/community/:communityId", async (request) => {
    const { communityId } = request.params as { communityId: string };

    const communityEmojis = await db.query.emojis.findMany({
      where: eq(emojis.communityId, communityId),
    });

    return { emojis: communityEmojis };
  });

  // Delete emoji
  fastify.delete("/:emojiId", async (request, reply) => {
    const { emojiId } = request.params as { emojiId: string };

    const [deleted] = await db.delete(emojis)
      .where(eq(emojis.id, emojiId))
      .returning();

    if (!deleted) {
      return reply.status(404).send({ error: "Emoji not found" });
    }

    return { success: true };
  });
};
