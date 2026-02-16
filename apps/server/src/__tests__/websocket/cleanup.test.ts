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

  describe("sendToChannel", () => {
    let sendToChannel: (channelId: string, message: object, excludeSocket?: WebSocket) => void;
    let channelConnectionsMap: Map<string, Set<WebSocket>>;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("../../websocket/connectionMaps.js");
      connectionMaps = mod;
      sendToChannel = mod.sendToChannel;
      channelConnectionsMap = mod.channelConnections;
    });

    it("should send message to all sockets in a channel", () => {
      const channelId = "channel-1";
      const message = { type: "test", payload: {} };
      const socket1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      const socket2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

      channelConnectionsMap.set(channelId, new Set([socket1, socket2]));
      sendToChannel(channelId, message);

      expect(socket1.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(socket2.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should exclude specified socket", () => {
      const channelId = "channel-1";
      const message = { type: "test", payload: {} };
      const socket1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      const socket2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

      channelConnectionsMap.set(channelId, new Set([socket1, socket2]));
      sendToChannel(channelId, message, socket1);

      expect(socket1.send).not.toHaveBeenCalled();
      expect(socket2.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should not send to closed sockets", () => {
      const channelId = "channel-1";
      const message = { type: "test", payload: {} };
      const closedSocket = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;

      channelConnectionsMap.set(channelId, new Set([closedSocket]));
      sendToChannel(channelId, message);

      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it("should handle non-existent channel gracefully", () => {
      expect(() => sendToChannel("nonexistent", { type: "test" })).not.toThrow();
    });
  });

  describe("sendToCommunity", () => {
    let sendToCommunity: (communityId: string, message: object) => void;
    let communityConnectionsMap: Map<string, Set<WebSocket>>;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("../../websocket/connectionMaps.js");
      connectionMaps = mod;
      sendToCommunity = mod.sendToCommunity;
      communityConnectionsMap = mod.communityConnections;
    });

    it("should send message to all sockets in a community", () => {
      const communityId = "community-1";
      const message = { type: "test", payload: {} };
      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

      communityConnectionsMap.set(communityId, new Set([socket]));
      sendToCommunity(communityId, message);

      expect(socket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should not send to closed sockets", () => {
      const communityId = "community-1";
      const message = { type: "test", payload: {} };
      const closedSocket = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;

      communityConnectionsMap.set(communityId, new Set([closedSocket]));
      sendToCommunity(communityId, message);

      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it("should handle non-existent community gracefully", () => {
      expect(() => sendToCommunity("nonexistent", { type: "test" })).not.toThrow();
    });
  });

  describe("cleanupEmptyMaps", () => {
    let channelConnectionsMap: Map<string, Set<WebSocket>>;
    let communityConnectionsMap: Map<string, Set<WebSocket>>;
    let communityOnlineUsersMap: Map<string, Set<string>>;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("../../websocket/connectionMaps.js");
      connectionMaps = mod;
      channelConnectionsMap = mod.channelConnections;
      communityConnectionsMap = mod.communityConnections;
      communityOnlineUsersMap = mod.communityOnlineUsers;
    });

    it("should remove empty Sets from all maps", () => {
      channelConnectionsMap.set("ch-1", new Set());
      communityConnectionsMap.set("com-1", new Set());
      communityOnlineUsersMap.set("com-1", new Set());

      connectionMaps.cleanupEmptyMaps();

      expect(channelConnectionsMap.size).toBe(0);
      expect(communityConnectionsMap.size).toBe(0);
      expect(communityOnlineUsersMap.size).toBe(0);
    });

    it("should keep non-empty Sets", () => {
      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      channelConnectionsMap.set("ch-1", new Set([socket]));
      channelConnectionsMap.set("ch-2", new Set());

      connectionMaps.cleanupEmptyMaps();

      expect(channelConnectionsMap.size).toBe(1);
      expect(channelConnectionsMap.has("ch-1")).toBe(true);
    });
  });

  describe("cleanupSocket", () => {
    let cleanupSocket: (socket: WebSocket) => void;
    let channelConnectionsMap: Map<string, Set<WebSocket>>;
    let socketUsersMap: Map<WebSocket, { userId: string; channelIds: Set<string>; communityIds: Set<string> }>;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("../../websocket/connectionMaps.js");
      connectionMaps = mod;
      cleanupSocket = mod.cleanupSocket;
      channelConnectionsMap = mod.channelConnections;
      socketUsersMap = mod.socketUsers;
    });

    it("should remove socket from all channels and socketUsers", () => {
      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      const channelIds = new Set(["ch-1", "ch-2"]);

      socketUsersMap.set(socket, { userId: "user-1", channelIds, communityIds: new Set() });
      channelConnectionsMap.set("ch-1", new Set([socket]));
      channelConnectionsMap.set("ch-2", new Set([socket]));

      cleanupSocket(socket);

      expect(socketUsersMap.has(socket)).toBe(false);
      expect(channelConnectionsMap.has("ch-1")).toBe(false);
      expect(channelConnectionsMap.has("ch-2")).toBe(false);
    });

    it("should not remove other sockets from channels", () => {
      const socket1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      const socket2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

      socketUsersMap.set(socket1, { userId: "user-1", channelIds: new Set(["ch-1"]), communityIds: new Set() });
      channelConnectionsMap.set("ch-1", new Set([socket1, socket2]));

      cleanupSocket(socket1);

      expect(channelConnectionsMap.has("ch-1")).toBe(true);
      expect(channelConnectionsMap.get("ch-1")!.has(socket2)).toBe(true);
    });

    it("should handle socket not in socketUsers map", () => {
      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
      expect(() => cleanupSocket(socket)).not.toThrow();
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
