import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, messages } from "../db/index.js";
import { eq, desc, lt } from "drizzle-orm";

const sendMessageSchema = z.object({
  channelId: z.string().uuid(),
  senderId: z.string().uuid(),
  ciphertext: z.string(),
  replyToId: z.string().uuid().optional(),
});

export const messageRoutes: FastifyPluginAsync = async (fastify) => {
  // Send message (also handled via WebSocket, this is fallback)
  fastify.post("/", async (request) => {
    const body = sendMessageSchema.parse(request.body);

    const [message] = await db.insert(messages).values({
      channelId: body.channelId,
      senderId: body.senderId,
      ciphertext: body.ciphertext,
      replyToId: body.replyToId,
    }).returning();

    return { message };
  });

  // Get messages for a channel (paginated)
  fastify.get("/channel/:channelId", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const { cursor, limit = "50" } = request.query as { cursor?: string; limit?: string };

    const limitNum = Math.min(parseInt(limit, 10), 100);

    let query = db.query.messages.findMany({
      where: cursor
        ? (messages, { and, lt: ltOp }) => and(
            eq(messages.channelId, channelId),
            ltOp(messages.createdAt, new Date(cursor))
          )
        : eq(messages.channelId, channelId),
      orderBy: desc(messages.createdAt),
      limit: limitNum,
    });

    const channelMessages = await query;

    return {
      messages: channelMessages.reverse(),
      nextCursor: channelMessages.length === limitNum
        ? channelMessages[0]?.createdAt.toISOString()
        : null,
    };
  });
};
