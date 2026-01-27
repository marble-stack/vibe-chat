import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, reactions, messages } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { canUserAccessChannel } from "../lib/authorization.js";

const addReactionSchema = z.object({
  messageId: z.string().uuid(),
  userId: z.string().uuid(),
  emoji: z.string().min(1).max(10),
});

export const reactionRoutes: FastifyPluginAsync = async (fastify) => {
  // Add reaction to a message
  fastify.post("/", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const body = addReactionSchema.parse(request.body);

    // Authorization: userId must match authenticated user
    if (request.user.userId !== body.userId) {
      return reply.status(403).send({ error: "Cannot add reactions as another user" });
    }

    // Get the message to check channel access
    const message = await db.query.messages.findFirst({
      where: eq(messages.id, body.messageId),
    });

    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    // Authorization: verify user can access the message's channel
    const canAccess = await canUserAccessChannel(request.user.userId, message.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

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

    const [reaction] = await db
      .insert(reactions)
      .values({
        messageId: body.messageId,
        userId: body.userId,
        emoji: body.emoji,
      })
      .returning();

    return { reaction };
  });

  // Remove reaction
  fastify.delete("/:reactionId", async (request, reply) => {
    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { reactionId } = request.params as { reactionId: string };

    // Check if reaction exists and verify ownership
    const existingReaction = await db.query.reactions.findFirst({
      where: eq(reactions.id, reactionId),
    });

    if (!existingReaction) {
      return reply.status(404).send({ error: "Reaction not found" });
    }

    // Authorization: only the user who created the reaction can delete it
    if (existingReaction.userId !== request.user.userId) {
      return reply.status(403).send({ error: "Cannot delete reactions created by others" });
    }

    await db.delete(reactions).where(eq(reactions.id, reactionId));

    return { success: true };
  });
};
