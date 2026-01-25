import { FastifyPluginAsync } from "fastify";
import { WebSocket } from "ws";
import { db, messages, users } from "../db/index.js";
import { eq } from "drizzle-orm";

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
      socketUsers.set(socket, { userId, channelIds: new Set(), communityIds: new Set() });
      socket.send(JSON.stringify({ type: "auth:success", payload: {} }));
      break;
    }

    case "community:join": {
      const { communityId } = message.payload as { communityId: string };
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
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
      const { communityId } = message.payload as { communityId: string };
      const user = socketUsers.get(socket);

      if (user) {
        handleUserLeaveCommunity(socket, user.userId, communityId);
      }
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

    case "message:edit": {
      const { messageId, channelId, ciphertext } = message.payload as {
        messageId: string;
        channelId: string;
        ciphertext: string;
      };
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
      const { messageId, channelId } = message.payload as {
        messageId: string;
        channelId: string;
      };
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

  console.log("WebSocket client disconnected");
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
