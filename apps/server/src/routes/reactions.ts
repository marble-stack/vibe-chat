import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, reactions } from "../db/index.js";
import { eq, and } from "drizzle-orm";

const addReactionSchema = z.object({
  messageId: z.string().uuid(),
  userId: z.string().uuid(),
  emoji: z.string().min(1).max(10),
});

export const reactionRoutes: FastifyPluginAsync = async (fastify) => {
  // Add reaction to a message
  fastify.post("/", async (request, reply) => {
    const body = addReactionSchema.parse(request.body);

    // Check if user already reacted with this emoji
    const existing = await db.query.reactions.findFirst({
      where: and(
        eq(reactions.messageId, body.messageId),
        eq(reactions.userId, body.userId),
        eq(reactions.emoji, body.emoji)
      ),
    });

    if (existing) {
      return reply.status(400).send({ error: "Reaction already exists" });
    }

    const [reaction] = await db.insert(reactions).values({
      messageId: body.messageId,
      userId: body.userId,
      emoji: body.emoji,
    }).returning();

    return { reaction };
  });

  // Remove reaction
  fastify.delete("/:reactionId", async (request) => {
    const { reactionId } = request.params as { reactionId: string };

    await db.delete(reactions).where(eq(reactions.id, reactionId));

    return { success: true };
  });
};
