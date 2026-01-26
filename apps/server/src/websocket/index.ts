import { FastifyPluginAsync } from "fastify";
import { WebSocket } from "ws";
import { db, messages, users, reactions } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { validatePayload } from "./schemas.js";
import { isUserInCommunity, canUserAccessChannel } from "../lib/authorization.js";
import { verifyToken } from "../lib/auth.js";

// Map of channelId -> Set of connected WebSockets
const channelConnections = new Map<string, Set<WebSocket>>();

// Map of WebSocket -> user info
const socketUsers = new Map<WebSocket, { userId: string; channelIds: Set<string>; communityIds: Set<string> }>();

// Map of communityId -> Set of online userIds
const communityOnlineUsers = new Map<string, Set<string>>();

// Map of communityId -> Set of connected WebSockets (for presence broadcasts)
const communityConnections = new Map<string, Set<WebSocket>>();

interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

export const websocketHandler: FastifyPluginAsync = async (fastify) => {
  fastify.get("/ws", { websocket: true }, (socket, _req) => {
    logger.debug("WebSocket client connected");

    socket.on("message", async (data) => {
      try {
        const message: WsMessage = JSON.parse(data.toString());
        await handleMessage(socket, message);
      } catch (err) {
        logger.error("WebSocket message error:", err);
        socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid message format" } }));
      }
    });

    socket.on("close", () => {
      handleDisconnect(socket);
    });
  });
};

async function handleMessage(socket: WebSocket, message: WsMessage) {
  // Helper to send validation error
  const sendValidationError = () => {
    socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid payload" } }));
  };

  switch (message.type) {
    case "auth": {
      // Validate payload
      const payload = validatePayload("auth", message.payload);
      if (!payload) {
        sendValidationError();
        return;
      }

      // Verify JWT token and extract userId
      const tokenPayload = verifyToken(payload.token);
      if (!tokenPayload) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid or expired token" } }));
        return;
      }

      // Associate user with socket using verified userId from token
      socketUsers.set(socket, { userId: tokenPayload.userId, channelIds: new Set(), communityIds: new Set() });
      socket.send(JSON.stringify({ type: "auth:success", payload: { userId: tokenPayload.userId } }));
      break;
    }

    case "community:join": {
      // Validate payload
      const payload = validatePayload("community:join", message.payload);
      if (!payload) {
        sendValidationError();
        return;
      }
      const { communityId } = payload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization check: verify user is a member of this community
      const isMember = await isUserInCommunity(user.userId, communityId);
      if (!isMember) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not a member of this community" } }));
        return;
      }

      // Track this socket in community connections
      if (!communityConnections.has(communityId)) {
        communityConnections.set(communityId, new Set());
      }
      communityConnections.get(communityId)!.add(socket);
      user.communityIds.add(communityId);

      // Track user as online in community
      if (!communityOnlineUsers.has(communityId)) {
        communityOnlineUsers.set(communityId, new Set());
      }
      const wasOnline = communityOnlineUsers.get(communityId)!.has(user.userId);
      communityOnlineUsers.get(communityId)!.add(user.userId);

      // Send current online users to the joining socket
      const onlineUsers = Array.from(communityOnlineUsers.get(communityId) || []);
      socket.send(JSON.stringify({
        type: "presence:list",
        payload: { communityId, onlineUserIds: onlineUsers },
      }));

      // Broadcast user came online (if they weren't already online from another tab)
      if (!wasOnline) {
        broadcastToCommunity(communityId, {
          type: "presence:update",
          payload: { communityId, userId: user.userId, isOnline: true },
        }, socket);
      }
      break;
    }

    case "community:leave": {
      // Validate payload
      const payload = validatePayload("community:leave", message.payload);
      if (!payload) {
        sendValidationError();
        return;
      }
      const user = socketUsers.get(socket);

      if (user) {
        handleUserLeaveCommunity(socket, user.userId, payload.communityId);
      }
      break;
    }

    case "channel:join": {
      // Validate payload
      const channelPayload = validatePayload("channel:join", message.payload);
      if (!channelPayload) {
        sendValidationError();
        return;
      }
      const { channelId } = channelPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization check: verify user can access this channel
      const canAccess = await canUserAccessChannel(user.userId, channelId);
      if (!canAccess) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Cannot access this channel" } }));
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
      // Validate payload
      const leavePayload = validatePayload("channel:leave", message.payload);
      if (!leavePayload) {
        sendValidationError();
        return;
      }
      const user = socketUsers.get(socket);

      if (user) {
        channelConnections.get(leavePayload.channelId)?.delete(socket);
        user.channelIds.delete(leavePayload.channelId);
      }
      break;
    }

    case "message:send": {
      // Validate payload
      const sendPayload = validatePayload("message:send", message.payload);
      if (!sendPayload) {
        sendValidationError();
        return;
      }
      const { channelId, ciphertext, replyToId } = sendPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization check: verify user can access this channel
      const canSend = await canUserAccessChannel(user.userId, channelId);
      if (!canSend) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Cannot send messages to this channel" } }));
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

    case "message:edit": {
      // Validate payload
      const editPayload = validatePayload("message:edit", message.payload);
      if (!editPayload) {
        sendValidationError();
        return;
      }
      const { messageId, channelId, ciphertext } = editPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Verify the user owns this message
      const existingMessage = await db.query.messages.findFirst({
        where: eq(messages.id, messageId),
      });

      if (!existingMessage || existingMessage.senderId !== user.userId) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Cannot edit this message" } }));
        return;
      }

      // Update the message
      const [updatedMessage] = await db.update(messages)
        .set({ ciphertext, editedAt: new Date() })
        .where(eq(messages.id, messageId))
        .returning();

      // Broadcast to all users in channel
      const editChannelSockets = channelConnections.get(channelId);
      if (editChannelSockets) {
        const broadcastMsg = JSON.stringify({
          type: "message:edited",
          payload: {
            id: messageId,
            channelId,
            ciphertext,
            editedAt: updatedMessage.editedAt?.toISOString(),
          },
        });

        for (const clientSocket of editChannelSockets) {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(broadcastMsg);
          }
        }
      }
      break;
    }

    case "message:delete": {
      // Validate payload
      const deletePayload = validatePayload("message:delete", message.payload);
      if (!deletePayload) {
        sendValidationError();
        return;
      }
      const { messageId, channelId } = deletePayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Verify the user owns this message
      const existingMsg = await db.query.messages.findFirst({
        where: eq(messages.id, messageId),
      });

      if (!existingMsg || existingMsg.senderId !== user.userId) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Cannot delete this message" } }));
        return;
      }

      // Soft delete the message
      await db.update(messages)
        .set({ deletedAt: new Date() })
        .where(eq(messages.id, messageId));

      // Broadcast to all users in channel
      const deleteChannelSockets = channelConnections.get(channelId);
      if (deleteChannelSockets) {
        const broadcastMsg = JSON.stringify({
          type: "message:deleted",
          payload: { id: messageId, channelId },
        });

        for (const clientSocket of deleteChannelSockets) {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(broadcastMsg);
          }
        }
      }
      break;
    }

    case "typing:start": {
      // Validate payload
      const typingStartPayload = validatePayload("typing:start", message.payload);
      if (!typingStartPayload) {
        sendValidationError();
        return;
      }
      const user = socketUsers.get(socket);

      if (user) {
        broadcastToChannel(typingStartPayload.channelId, {
          type: "typing:update",
          payload: { channelId: typingStartPayload.channelId, userId: user.userId, isTyping: true },
        }, socket);
      }
      break;
    }

    case "typing:stop": {
      // Validate payload
      const typingStopPayload = validatePayload("typing:stop", message.payload);
      if (!typingStopPayload) {
        sendValidationError();
        return;
      }
      const user = socketUsers.get(socket);

      if (user) {
        broadcastToChannel(typingStopPayload.channelId, {
          type: "typing:update",
          payload: { channelId: typingStopPayload.channelId, userId: user.userId, isTyping: false },
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

    default: {
      // Unknown message type
      socket.send(JSON.stringify({ type: "error", payload: { message: "Unknown message type" } }));
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

    // Remove from all community connections and update presence
    for (const communityId of user.communityIds) {
      handleUserLeaveCommunity(socket, user.userId, communityId);
    }

    socketUsers.delete(socket);
  }

  logger.debug("WebSocket client disconnected");
}

function handleUserLeaveCommunity(socket: WebSocket, userId: string, communityId: string) {
  // Remove socket from community connections
  communityConnections.get(communityId)?.delete(socket);

  // Check if user has any other sockets in this community
  let hasOtherConnections = false;
  for (const [otherSocket, otherUser] of socketUsers) {
    if (otherSocket !== socket && otherUser.userId === userId && otherUser.communityIds.has(communityId)) {
      hasOtherConnections = true;
      break;
    }
  }

  // If no other connections, mark user as offline
  if (!hasOtherConnections) {
    communityOnlineUsers.get(communityId)?.delete(userId);
    broadcastToCommunity(communityId, {
      type: "presence:update",
      payload: { communityId, userId, isOnline: false },
    });
  }

  // Update socket's community tracking
  const user = socketUsers.get(socket);
  if (user) {
    user.communityIds.delete(communityId);
  }
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

function broadcastToCommunity(communityId: string, message: WsMessage, excludeSocket?: WebSocket) {
  const communitySockets = communityConnections.get(communityId);

  if (communitySockets) {
    const msgStr = JSON.stringify(message);

    for (const clientSocket of communitySockets) {
      if (clientSocket !== excludeSocket && clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(msgStr);
      }
    }
  }
}
