import { WebSocket } from "ws";

// Map of channelId -> Set of connected WebSockets
export const channelConnections = new Map<string, Set<WebSocket>>();

/**
 * Send a message to all connected sockets for a specific user
 */
export function sendToUser(userId: string, message: object): void {
  for (const [socket, user] of socketUsers) {
    if (user.userId === userId && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}

// Map of WebSocket -> user info
export const socketUsers = new Map<
  WebSocket,
  { userId: string; channelIds: Set<string>; communityIds: Set<string> }
>();

// Map of communityId -> Set of online userIds
export const communityOnlineUsers = new Map<string, Set<string>>();

// Map of communityId -> Set of connected WebSockets (for presence broadcasts)
export const communityConnections = new Map<string, Set<WebSocket>>();

// Helper functions to check map sizes (for testing and monitoring)
export function getChannelConnectionsSize(): number {
  return channelConnections.size;
}

export function getCommunityConnectionsSize(): number {
  return communityConnections.size;
}

export function getCommunityOnlineUsersSize(): number {
  return communityOnlineUsers.size;
}

export function getSocketUsersSize(): number {
  return socketUsers.size;
}

/**
 * Clean up empty Sets from all connection maps.
 * This should be called periodically or after disconnects to prevent memory leaks.
 */
export function cleanupEmptyMaps(): void {
  // Clean up empty channel connection Sets
  for (const [channelId, sockets] of channelConnections) {
    if (sockets.size === 0) {
      channelConnections.delete(channelId);
    }
  }

  // Clean up empty community connection Sets
  for (const [communityId, sockets] of communityConnections) {
    if (sockets.size === 0) {
      communityConnections.delete(communityId);
    }
  }

  // Clean up empty community online user Sets
  for (const [communityId, users] of communityOnlineUsers) {
    if (users.size === 0) {
      communityOnlineUsers.delete(communityId);
    }
  }
}

/**
 * Clean up all data for a disconnected socket.
 * Removes socket from all channels and communities, and cleans up empty Sets.
 */
export function cleanupSocket(socket: WebSocket): void {
  const user = socketUsers.get(socket);

  if (user) {
    // Remove from all channel connections
    for (const channelId of user.channelIds) {
      const channelSet = channelConnections.get(channelId);
      if (channelSet) {
        channelSet.delete(socket);
        // Clean up empty Set
        if (channelSet.size === 0) {
          channelConnections.delete(channelId);
        }
      }
    }

    // Note: community cleanup happens in handleUserLeaveCommunity
    // which handles the more complex logic of checking other sockets

    socketUsers.delete(socket);
  }
}
