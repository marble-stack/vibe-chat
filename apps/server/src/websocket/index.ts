import { FastifyPluginAsync } from "fastify";
import { WebSocket } from "ws";
import { db, messages, users, reactions } from "../db/index.js";
import { eq, and } from "drizzle-orm";

// Map of channelId -> Set of connected WebSockets
const channelConnections = new Map<string, Set<WebSocket>>();

// Map of WebSocket -> user info
const socketUsers = new Map<WebSocket, { userId: string; channelIds: Set<string> }>();

interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

export const websocketHandler: FastifyPluginAsync = async (fastify) => {
  fastify.get("/ws", { websocket: true }, (socket, req) => {
    console.log("WebSocket client connected");

    socket.on("message", async (data) => {
      try {
        const message: WsMessage = JSON.parse(data.toString());
        await handleMessage(socket, message);
      } catch (err) {
        console.error("WebSocket message error:", err);
        socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid message format" } }));
      }
    });

    socket.on("close", () => {
      handleDisconnect(socket);
    });
  });
};

async function handleMessage(socket: WebSocket, message: WsMessage) {
  switch (message.type) {
    case "auth": {
      // Associate user with socket
      const { userId } = message.payload as { userId: string };
      socketUsers.set(socket, { userId, channelIds: new Set() });
      socket.send(JSON.stringify({ type: "auth:success", payload: {} }));
      break;
    }

    case "channel:join": {
      const { channelId } = message.payload as { channelId: string };
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Add to channel connections
      if (!channelConnections.has(channelId)) {
        channelConnections.set(channelId, new Set());
      }
      channelConnections.get(channelId)!.add(socket);
      user.channelIds.add(channelId);

      socket.send(JSON.stringify({ type: "channel:joined", payload: { channelId } }));
      break;
    }

    case "channel:leave": {
      const { channelId } = message.payload as { channelId: string };
      const user = socketUsers.get(socket);

      if (user) {
        channelConnections.get(channelId)?.delete(socket);
        user.channelIds.delete(channelId);
      }
      break;
    }

    case "message:send": {
      const { channelId, ciphertext, replyToId } = message.payload as {
        channelId: string;
        ciphertext: string;
        replyToId?: string;
      };
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Store message
      const [savedMessage] = await db.insert(messages).values({
        channelId,
        senderId: user.userId,
        ciphertext,
        replyToId,
      }).returning();

      // Get sender's display name for clients that may not have it cached
      const sender = await db.query.users.findFirst({
        where: eq(users.id, user.userId),
        columns: { displayName: true },
      });

      // Broadcast to all users in channel
      const channelSockets = channelConnections.get(channelId);
      if (channelSockets) {
        const broadcastMsg = JSON.stringify({
          type: "message:new",
          payload: {
            id: savedMessage.id,
            channelId,
            senderId: user.userId,
            senderDisplayName: sender?.displayName,
            ciphertext,
            replyToId,
            createdAt: savedMessage.createdAt.toISOString(),
          },
        });

        for (const clientSocket of channelSockets) {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(broadcastMsg);
          }
        }
      }
      break;
    }

    case "typing:start": {
      const { channelId } = message.payload as { channelId: string };
      const user = socketUsers.get(socket);

      if (user) {
        broadcastToChannel(channelId, {
          type: "typing:update",
          payload: { channelId, userId: user.userId, isTyping: true },
        }, socket);
      }
      break;
    }

    case "typing:stop": {
      const { channelId } = message.payload as { channelId: string };
      const user = socketUsers.get(socket);

      if (user) {
        broadcastToChannel(channelId, {
          type: "typing:update",
          payload: { channelId, userId: user.userId, isTyping: false },
        }, socket);
      }
      break;
    }

    case "reaction:add": {
      const { messageId, channelId, emoji } = message.payload as {
        messageId: string;
        channelId: string;
        emoji: string;
      };
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Check if user already reacted with this emoji
      const existing = await db.query.reactions.findFirst({
        where: and(
          eq(reactions.messageId, messageId),
          eq(reactions.userId, user.userId),
          eq(reactions.emoji, emoji)
        ),
      });

      if (existing) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Reaction already exists" } }));
        return;
      }

      const [reaction] = await db.insert(reactions).values({
        messageId,
        userId: user.userId,
        emoji,
      }).returning();

      // Broadcast to channel
      broadcastToChannel(channelId, {
        type: "reaction:added",
        payload: {
          reactionId: reaction.id,
          messageId,
          userId: user.userId,
          emoji,
        },
      });
      break;
    }

    case "reaction:remove": {
      const { reactionId, channelId, messageId, emoji } = message.payload as {
        reactionId: string;
        channelId: string;
        messageId: string;
        emoji: string;
      };
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      await db.delete(reactions).where(eq(reactions.id, reactionId));

      // Broadcast to channel
      broadcastToChannel(channelId, {
        type: "reaction:removed",
        payload: {
          reactionId,
          messageId,
          userId: user.userId,
          emoji,
        },
      });
      break;
    }
  }
}

function handleDisconnect(socket: WebSocket) {
  const user = socketUsers.get(socket);

  if (user) {
    // Remove from all channel connections
    for (const channelId of user.channelIds) {
      channelConnections.get(channelId)?.delete(socket);
    }
    socketUsers.delete(socket);
  }

  console.log("WebSocket client disconnected");
}

function broadcastToChannel(channelId: string, message: WsMessage, excludeSocket?: WebSocket) {
  const channelSockets = channelConnections.get(channelId);

  if (channelSockets) {
    const msgStr = JSON.stringify(message);

    for (const clientSocket of channelSockets) {
      if (clientSocket !== excludeSocket && clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(msgStr);
      }
    }
  }
}
