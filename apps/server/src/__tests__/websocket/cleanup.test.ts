import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";

// The connection management functions are not exported, so we test them
// through the exported module state accessors we'll create

describe("WebSocket Connection Management", () => {
  let connectionMaps: {
    getChannelConnectionsSize: () => number;
    getCommunityConnectionsSize: () => number;
    getCommunityOnlineUsersSize: () => number;
    getSocketUsersSize: () => number;
    cleanupEmptyMaps: () => void;
    sendToUser: (userId: string, message: object) => void;
    socketUsers: Map<
      WebSocket,
      { userId: string; channelIds: Set<string>; communityIds: Set<string> }
    >;
  };

  beforeEach(async () => {
    // Import the module fresh for each test
    vi.resetModules();
    const mod = await import("../../websocket/connectionMaps.js");
    connectionMaps = mod;
  });

  describe("Empty Set Cleanup", () => {
    it("should expose functions to check map sizes", () => {
      expect(connectionMaps.getChannelConnectionsSize).toBeDefined();
      expect(connectionMaps.getCommunityConnectionsSize).toBeDefined();
      expect(connectionMaps.getCommunityOnlineUsersSize).toBeDefined();
      expect(connectionMaps.getSocketUsersSize).toBeDefined();
    });

    it("should start with empty maps", () => {
      expect(connectionMaps.getChannelConnectionsSize()).toBe(0);
      expect(connectionMaps.getCommunityConnectionsSize()).toBe(0);
      expect(connectionMaps.getCommunityOnlineUsersSize()).toBe(0);
      expect(connectionMaps.getSocketUsersSize()).toBe(0);
    });

    it("should provide a cleanupEmptyMaps function", () => {
      expect(connectionMaps.cleanupEmptyMaps).toBeDefined();
      expect(typeof connectionMaps.cleanupEmptyMaps).toBe("function");
    });
  });

  describe("sendToUser", () => {
    it("should be defined as a function", () => {
      expect(connectionMaps.sendToUser).toBeDefined();
      expect(typeof connectionMaps.sendToUser).toBe("function");
    });

    it("should send message to all sockets for a user", () => {
      const userId = "user-123";
      const message = { type: "test", payload: { data: "value" } };

      // Create mock WebSocket
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      // Add socket to socketUsers map
      connectionMaps.socketUsers.set(mockSocket, {
        userId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.sendToUser(userId, message);

      expect(mockSocket.send).toHaveBeenCalledTimes(1);
      expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should not send to sockets for different users", () => {
      const targetUserId = "user-123";
      const otherUserId = "user-456";
      const message = { type: "test", payload: {} };

      const targetSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      const otherSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      connectionMaps.socketUsers.set(targetSocket, {
        userId: targetUserId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.socketUsers.set(otherSocket, {
        userId: otherUserId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.sendToUser(targetUserId, message);

      expect(targetSocket.send).toHaveBeenCalledTimes(1);
      expect(otherSocket.send).not.toHaveBeenCalled();
    });

    it("should not send to closed sockets", () => {
      const userId = "user-123";
      const message = { type: "test", payload: {} };

      const closedSocket = {
        readyState: WebSocket.CLOSED,
        send: vi.fn(),
      } as unknown as WebSocket;

      connectionMaps.socketUsers.set(closedSocket, {
        userId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.sendToUser(userId, message);

      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it("should send to multiple sockets for the same user", () => {
      const userId = "user-123";
      const message = { type: "test", payload: {} };

      const socket1 = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      const socket2 = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      connectionMaps.socketUsers.set(socket1, {
        userId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.socketUsers.set(socket2, {
        userId,
        channelIds: new Set(),
        communityIds: new Set(),
      });

      connectionMaps.sendToUser(userId, message);

      expect(socket1.send).toHaveBeenCalledTimes(1);
      expect(socket2.send).toHaveBeenCalledTimes(1);
    });
  });
});
