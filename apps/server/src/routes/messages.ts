import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, messages, reactions } from "../db/index.js";
import { eq, desc, lt, isNull, and } from "drizzle-orm";
import { canUserAccessChannel } from "../lib/authorization.js";

const sendMessageSchema = z.object({
  channelId: z.string().uuid(),
  senderId: z.string().uuid(),
  ciphertext: z.string(),
  replyToId: z.string().uuid().optional(),
});

export const messageRoutes: FastifyPluginAsync = async (fastify) => {
  // Send message (also handled via WebSocket, this is fallback)
  fastify.post("/", async (request, reply) => {
    const body = sendMessageSchema.parse(request.body);

    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Authorization: verify user can access this channel
    const canAccess = await canUserAccessChannel(request.user.userId, body.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot send messages to this channel" });
    }

    // Authorization: verify senderId matches authenticated user
    if (request.user.userId !== body.senderId) {
      return reply.status(403).send({ error: "Cannot send messages as another user" });
    }

    const [message] = await db.insert(messages).values({
      channelId: body.channelId,
      senderId: body.senderId,
      ciphertext: body.ciphertext,
      replyToId: body.replyToId,
    }).returning();

    return { message };
  });

  // Get messages for a channel (paginated)
  fastify.get("/channel/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const { cursor, limit = "50" } = request.query as { cursor?: string; limit?: string };

    // Authorization: require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Authorization: verify user can access this channel
    const canAccess = await canUserAccessChannel(request.user.userId, channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

    const limitNum = Math.min(parseInt(limit, 10), 100);

    let query = db.query.messages.findMany({
      where: cursor
        ? (messages, { and: andOp, lt: ltOp, isNull: isNullOp }) => andOp(
            eq(messages.channelId, channelId),
            ltOp(messages.createdAt, new Date(cursor)),
            isNullOp(messages.deletedAt)
          )
        : (messages, { and: andOp, isNull: isNullOp }) => andOp(
            eq(messages.channelId, channelId),
            isNullOp(messages.deletedAt)
          ),
      orderBy: desc(messages.createdAt),
      limit: limitNum,
    });

    const channelMessages = await query;

    // Get reactions for all messages
    const messageIds = channelMessages.map(m => m.id);
    const messageReactions = messageIds.length > 0
      ? await db.query.reactions.findMany({
          where: (reactions, { inArray }) => inArray(reactions.messageId, messageIds),
        })
      : [];

    // Group reactions by message and emoji
    const reactionsByMessage = messageReactions.reduce((acc, reaction) => {
      if (!acc[reaction.messageId]) {
        acc[reaction.messageId] = {};
      }
      if (!acc[reaction.messageId][reaction.emoji]) {
        acc[reaction.messageId][reaction.emoji] = {
          emoji: reaction.emoji,
          count: 0,
          userIds: [],
          reactionIds: {},
        };
      }
      acc[reaction.messageId][reaction.emoji].count++;
      acc[reaction.messageId][reaction.emoji].userIds.push(reaction.userId);
      acc[reaction.messageId][reaction.emoji].reactionIds[reaction.userId] = reaction.id;
      return acc;
    }, {} as Record<string, Record<string, { emoji: string; count: number; userIds: string[]; reactionIds: Record<string, string> }>>);

    // Add reactions to messages and include editedAt
    const messagesWithReactions = channelMessages.map(msg => ({
      ...msg,
      editedAt: msg.editedAt?.toISOString() || null,
      reactions: Object.values(reactionsByMessage[msg.id] || {}),
    }));

    return {
      messages: messagesWithReactions.reverse(),
      nextCursor: channelMessages.length === limitNum
        ? channelMessages[0]?.createdAt.toISOString()
        : null,
    };
  });
};
