import { FastifyPluginAsync } from "fastify";
import { WebSocket } from "ws";
import { db, messages, users, reactions, senderKeys, pendingKeyRequests, pollVotes } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { validatePayload } from "./schemas.js";
import { isUserInCommunity, canUserAccessChannel } from "../lib/authorization.js";
import { verifyToken } from "../lib/auth.js";
import {
  channelConnections,
  socketUsers,
  communityOnlineUsers,
  communityConnections,
  cleanupEmptyMaps,
  sendToChannel,
} from "./connectionMaps.js";

// In-memory cache for display names (populated during auth, avoids DB query per message)
const displayNameCache = new Map<string, string>();

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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Invalid message format" } })
        );
      }
    });

    socket.on("close", () => {
      handleDisconnect(socket);
    });
  });
};

export async function handleMessage(socket: WebSocket, message: WsMessage) {
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Invalid or expired token" } })
        );
        return;
      }

      // Associate user with socket using verified userId from token
      socketUsers.set(socket, {
        userId: tokenPayload.userId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      // Cache display name if not already cached
      if (!displayNameCache.has(tokenPayload.userId)) {
        const authUser = await db.query.users.findFirst({
          where: eq(users.id, tokenPayload.userId),
          columns: { displayName: true },
        });
        if (authUser?.displayName) {
          displayNameCache.set(tokenPayload.userId, authUser.displayName);
        }
      }

      socket.send(
        JSON.stringify({ type: "auth:success", payload: { userId: tokenPayload.userId } })
      );
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Not a member of this community" } })
        );
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
      socket.send(
        JSON.stringify({
          type: "presence:list",
          payload: { communityId, onlineUserIds: onlineUsers },
        })
      );

      // Broadcast user came online (if they weren't already online from another tab)
      if (!wasOnline) {
        broadcastToCommunity(
          communityId,
          {
            type: "presence:update",
            payload: { communityId, userId: user.userId, isOnline: true },
          },
          socket
        );
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot access this channel" } })
        );
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
      const msgStart = performance.now();
      // Validate payload
      const sendPayload = validatePayload("message:send", message.payload);
      if (!sendPayload) {
        sendValidationError();
        return;
      }
      const { channelId, ciphertext, replyToId, isThreadReply, clientId } = sendPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Fast-path: if socket is already in channelConnections for this channel,
      // it was authorized at channel:join time — skip the DB query
      const authStart = performance.now();
      const isAlreadyInChannel = channelConnections.get(channelId)?.has(socket);
      if (!isAlreadyInChannel) {
        const canSend = await canUserAccessChannel(user.userId, channelId);
        if (!canSend) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: { message: "Cannot send messages to this channel" },
            })
          );
          return;
        }
      }
      const authTime = performance.now() - authStart;

      // Run DB insert and display name lookup in parallel
      const dbStart = performance.now();
      const cachedDisplayName = displayNameCache.get(user.userId);
      const [insertResult, senderResult] = await Promise.all([
        db
          .insert(messages)
          .values({
            channelId,
            senderId: user.userId,
            ciphertext,
            replyToId,
            isThreadReply: isThreadReply ?? false,
          })
          .returning(),
        cachedDisplayName
          ? Promise.resolve({ displayName: cachedDisplayName })
          : db.query.users.findFirst({
              where: eq(users.id, user.userId),
              columns: { displayName: true },
            }),
      ]);
      const dbTime = performance.now() - dbStart;

      const savedMessage = insertResult[0];
      const sender = senderResult;

      // Update cache if we had to fetch
      if (!cachedDisplayName && sender?.displayName) {
        displayNameCache.set(user.userId, sender.displayName);
      }

      // Broadcast to all users in channel
      const broadcastStart = performance.now();
      const channelSockets = channelConnections.get(channelId);
      const broadcastMsg = JSON.stringify({
        type: "message:new",
        payload: {
          id: savedMessage.id,
          channelId,
          senderId: user.userId,
          senderDisplayName: sender?.displayName,
          ciphertext,
          replyToId,
          isThreadReply: savedMessage.isThreadReply,
          clientId,
          createdAt: savedMessage.createdAt.toISOString(),
        },
      });

      // Always send back to the sender first (handles race condition where
      // channel:join might still be processing when message is sent)
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(broadcastMsg);
      }

      // Then broadcast to other channel members
      if (channelSockets) {
        for (const clientSocket of channelSockets) {
          // Skip sender since we already sent to them
          if (clientSocket !== socket && clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(broadcastMsg);
          }
        }
      }
      const broadcastTime = performance.now() - broadcastStart;
      const totalTime = performance.now() - msgStart;

      if (process.env.NODE_ENV !== "production") {
        logger.debug(
          `[PERF] message:send total=${totalTime.toFixed(1)}ms ` +
          `(auth=${authTime.toFixed(1)}ms, db=${dbTime.toFixed(1)}ms, broadcast=${broadcastTime.toFixed(1)}ms)`
        );
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot edit this message" } })
        );
        return;
      }

      // Update the message
      const [updatedMessage] = await db
        .update(messages)
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot delete this message" } })
        );
        return;
      }

      // Soft delete the message
      await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));

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
        sendToChannel(
          typingStartPayload.channelId,
          {
            type: "typing:update",
            payload: {
              channelId: typingStartPayload.channelId,
              userId: user.userId,
              isTyping: true,
            },
          },
          socket
        );
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
        sendToChannel(
          typingStopPayload.channelId,
          {
            type: "typing:update",
            payload: {
              channelId: typingStopPayload.channelId,
              userId: user.userId,
              isTyping: false,
            },
          },
          socket
        );
      }
      break;
    }

    case "reaction:add": {
      // Validate payload
      const reactionPayload = validatePayload("reaction:add", message.payload);
      if (!reactionPayload) {
        sendValidationError();
        return;
      }
      const { messageId, channelId, emoji } = reactionPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization: user must be able to access the channel
      const canReact = await canUserAccessChannel(user.userId, channelId);
      if (!canReact) {
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot access this channel" } })
        );
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
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Reaction already exists" } })
        );
        return;
      }

      const [reaction] = await db
        .insert(reactions)
        .values({
          messageId,
          userId: user.userId,
          emoji,
        })
        .returning();

      // Broadcast to channel
      sendToChannel(channelId, {
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
      // Validate payload
      const removePayload = validatePayload("reaction:remove", message.payload);
      if (!removePayload) {
        sendValidationError();
        return;
      }
      const { reactionId, channelId, messageId, emoji } = removePayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization: only the user who created the reaction can remove it
      const existingReaction = await db.query.reactions.findFirst({
        where: eq(reactions.id, reactionId),
      });

      if (!existingReaction) {
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Reaction not found" } })
        );
        return;
      }

      if (existingReaction.userId !== user.userId) {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { message: "Cannot delete reactions created by others" },
          })
        );
        return;
      }

      await db.delete(reactions).where(eq(reactions.id, reactionId));

      // Broadcast to channel
      sendToChannel(channelId, {
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

    case "key:request": {
      // Validate payload
      const keyRequestPayload = validatePayload("key:request", message.payload);
      if (!keyRequestPayload) {
        sendValidationError();
        return;
      }
      const { channelId } = keyRequestPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      // Authorization check: verify user can access this channel
      const canAccess = await canUserAccessChannel(user.userId, channelId);
      if (!canAccess) {
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot access this channel" } })
        );
        return;
      }

      // Get ALL users who have distributed keys for this channel (not just the specified one)
      const keyOwners = await db.query.senderKeys.findMany({
        where: eq(senderKeys.channelId, channelId),
        columns: { userId: true },
      });
      const uniqueKeyOwnerIds = [...new Set(keyOwners.map((k) => k.userId))];

      // Send key:requested to ALL online key owners (any of them can redistribute)
      let sentToSomeone = false;
      for (const [targetSocket, targetUser] of socketUsers) {
        if (
          uniqueKeyOwnerIds.includes(targetUser.userId) &&
          targetSocket !== socket && // Don't send back to the requesting socket (allow other devices of same user)
          targetSocket.readyState === WebSocket.OPEN
        ) {
          targetSocket.send(
            JSON.stringify({
              type: "key:requested",
              payload: {
                channelId,
                requestingUserId: user.userId,
              },
            })
          );
          sentToSomeone = true;
        }
      }

      // Store the request in database for offline key holders to process when they come online
      try {
        await db
          .insert(pendingKeyRequests)
          .values({ channelId, requestingUserId: user.userId })
          .onConflictDoNothing();
      } catch (err) {
        // Non-fatal: online key holders already received the request above.
        // This can fail if the pending_key_requests table hasn't been migrated yet.
        logger.error("Failed to store pending key request:", err);
      }

      // Acknowledge the request was sent
      socket.send(
        JSON.stringify({
          type: "key:request:sent",
          payload: { channelId, sentToOnlineKeyHolder: sentToSomeone },
        })
      );
      break;
    }

    case "poll:vote": {
      const pollPayload = validatePayload("poll:vote", message.payload);
      if (!pollPayload) {
        sendValidationError();
        return;
      }
      const { messageId, channelId, optionIndex } = pollPayload;
      const user = socketUsers.get(socket);

      if (!user) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Not authenticated" } }));
        return;
      }

      const canAccess = await canUserAccessChannel(user.userId, channelId);
      if (!canAccess) {
        socket.send(
          JSON.stringify({ type: "error", payload: { message: "Cannot access this channel" } })
        );
        return;
      }

      // Check if already voted for this option
      const existing = await db.query.pollVotes.findFirst({
        where: and(
          eq(pollVotes.messageId, messageId),
          eq(pollVotes.userId, user.userId),
          eq(pollVotes.optionIndex, optionIndex)
        ),
      });

      let action: "add" | "remove";
      if (existing) {
        await db.delete(pollVotes).where(eq(pollVotes.id, existing.id));
        action = "remove";
      } else {
        await db.insert(pollVotes).values({
          messageId,
          userId: user.userId,
          optionIndex,
        });
        action = "add";
      }

      // Broadcast to channel
      sendToChannel(channelId, {
        type: "poll:voted",
        payload: {
          messageId,
          channelId,
          userId: user.userId,
          optionIndex,
          action,
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

  // Clean up empty Sets to prevent memory leaks
  cleanupEmptyMaps();

  logger.debug("WebSocket client disconnected");
}

function handleUserLeaveCommunity(socket: WebSocket, userId: string, communityId: string) {
  // Remove socket from community connections
  communityConnections.get(communityId)?.delete(socket);

  // Check if user has any other sockets in this community
  let hasOtherConnections = false;
  for (const [otherSocket, otherUser] of socketUsers) {
    if (
      otherSocket !== socket &&
      otherUser.userId === userId &&
      otherUser.communityIds.has(communityId)
    ) {
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
