import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, pollVotes, messages } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { canUserAccessChannel } from "../lib/authorization.js";

const voteSchema = z.object({
  messageId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(9),
  exclusive: z.boolean().optional(), // If true, remove all other votes by this user first
});

export const pollRoutes: FastifyPluginAsync = async (fastify) => {
  // Add or toggle a vote
  fastify.post("/vote", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const body = voteSchema.parse(request.body);

    // Get the message to verify channel access
    const message = await db.query.messages.findFirst({
      where: eq(messages.id, body.messageId),
    });

    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    const canAccess = await canUserAccessChannel(request.user.userId, message.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

    // Check if already voted for this option
    const existing = await db.query.pollVotes.findFirst({
      where: and(
        eq(pollVotes.messageId, body.messageId),
        eq(pollVotes.userId, request.user.userId),
        eq(pollVotes.optionIndex, body.optionIndex)
      ),
    });

    if (existing) {
      // Toggle off - remove the vote
      await db.delete(pollVotes).where(eq(pollVotes.id, existing.id));
      return { success: true, action: "removed" };
    }

    // If exclusive mode, remove all other votes by this user for this poll first
    if (body.exclusive) {
      await db
        .delete(pollVotes)
        .where(
          and(
            eq(pollVotes.messageId, body.messageId),
            eq(pollVotes.userId, request.user.userId)
          )
        );
    }

    // Add vote
    await db.insert(pollVotes).values({
      messageId: body.messageId,
      userId: request.user.userId,
      optionIndex: body.optionIndex,
    });

    return { success: true, action: "added" };
  });

  // Remove a vote
  fastify.delete("/vote", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const body = voteSchema.parse(request.body);

    const message = await db.query.messages.findFirst({
      where: eq(messages.id, body.messageId),
    });

    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    const canAccess = await canUserAccessChannel(request.user.userId, message.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

    await db
      .delete(pollVotes)
      .where(
        and(
          eq(pollVotes.messageId, body.messageId),
          eq(pollVotes.userId, request.user.userId),
          eq(pollVotes.optionIndex, body.optionIndex)
        )
      );

    return { success: true };
  });

  // Get poll results
  fastify.get("/:messageId/results", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { messageId } = request.params as { messageId: string };

    const message = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
    });

    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    const canAccess = await canUserAccessChannel(request.user.userId, message.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

    const allVotes = await db.query.pollVotes.findMany({
      where: eq(pollVotes.messageId, messageId),
    });

    // Group by optionIndex
    const grouped: Record<number, { optionIndex: number; count: number; userIds: string[] }> = {};
    for (const vote of allVotes) {
      if (!grouped[vote.optionIndex]) {
        grouped[vote.optionIndex] = { optionIndex: vote.optionIndex, count: 0, userIds: [] };
      }
      grouped[vote.optionIndex].count++;
      grouped[vote.optionIndex].userIds.push(vote.userId);
    }

    return { votes: Object.values(grouped) };
  });
};
