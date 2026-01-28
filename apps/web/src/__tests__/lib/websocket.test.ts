/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before imports
vi.mock("../../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;

  private sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  getSentMessages() {
    return this.sentMessages;
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError(error: Event) {
    this.onerror?.(error);
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Store WebSocket instances for testing
let mockWebSocketInstances: MockWebSocket[] = [];

describe("WebSocketClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockWebSocketInstances = [];

    // Mock global WebSocket
    vi.stubGlobal(
      "WebSocket",
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockWebSocketInstances.push(this);
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("connect", () => {
    it("should create WebSocket connection with correct URL", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      // Wait for async connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWebSocketInstances.length).toBe(1);
      expect(mockWebSocketInstances[0].url).toContain("ws");
    });

    it("should send auth message on connection", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      const sentMessages = ws.getSentMessages();

      expect(sentMessages.length).toBeGreaterThanOrEqual(1);
      const authMessage = JSON.parse(sentMessages[0]);
      expect(authMessage.type).toBe("auth");
      expect(authMessage.payload.token).toBe("token-abc");
    });

    it("should handle auth:success and set authenticated", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];

      expect(wsClient.isConnected()).toBe(false); // Not authenticated yet

      ws.simulateMessage({ type: "auth:success", payload: {} });

      expect(wsClient.isConnected()).toBe(true);
    });

    it("should rejoin channels after authentication", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];

      // Join a channel before auth completes (will be queued)
      wsClient.joinChannel("channel-456");

      // Simulate auth success
      ws.simulateMessage({ type: "auth:success", payload: {} });

      const sentMessages = ws.getSentMessages();
      const channelJoin = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "channel:join" && parsed.payload.channelId === "channel-456";
      });

      expect(channelJoin).toBeDefined();
    });
  });

  describe("disconnect", () => {
    it("should close WebSocket and clear state", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      wsClient.disconnect();

      expect(wsClient.isConnected()).toBe(false);
    });
  });

  describe("send", () => {
    it("should queue messages when not connected", async () => {
      const { wsClient } = await import("../../lib/websocket");

      // Don't connect, just try to send
      const result = wsClient.sendMessage("channel-123", "encrypted-data");

      expect(result).toBe(false);
    });

    it("should queue messages when not authenticated", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Connected but not authenticated yet
      const result = wsClient.sendMessage("channel-123", "encrypted-data");

      expect(result).toBe(false);
    });

    it("should send messages when authenticated", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      const result = wsClient.sendMessage("channel-123", "encrypted-data");

      expect(result).toBe(true);

      const sentMessages = ws.getSentMessages();
      const messagesSent = sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message:send";
      });

      expect(messagesSent.length).toBe(1);
    });

    it("should send queued messages after authentication", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Queue a message before auth
      wsClient.sendMessage("channel-123", "queued-message");

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      const sentMessages = ws.getSentMessages();
      const messagesSent = sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message:send";
      });

      expect(messagesSent.length).toBe(1);
    });
  });

  describe("message handlers", () => {
    it("should emit events to registered handlers", async () => {
      const { wsClient } = await import("../../lib/websocket");

      const handler = vi.fn();
      wsClient.on("message:new", handler);

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({
        type: "message:new",
        payload: { id: "msg-1", content: "Hello" },
      });

      expect(handler).toHaveBeenCalledWith({
        type: "message:new",
        payload: { id: "msg-1", content: "Hello" },
      });
    });

    it("should remove handlers with off", async () => {
      const { wsClient } = await import("../../lib/websocket");

      const handler = vi.fn();
      wsClient.on("message:new", handler);
      wsClient.off("message:new", handler);

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({
        type: "message:new",
        payload: { id: "msg-1", content: "Hello" },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle multiple handlers for same event", async () => {
      const { wsClient } = await import("../../lib/websocket");

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      wsClient.on("typing:update", handler1);
      wsClient.on("typing:update", handler2);

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({
        type: "typing:update",
        payload: { userId: "user-456", isTyping: true },
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should emit error events on server error messages", async () => {
      const { wsClient } = await import("../../lib/websocket");

      const errorHandler = vi.fn();
      wsClient.on("error", errorHandler);

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({
        type: "error",
        payload: { message: "Something went wrong" },
      });

      expect(errorHandler).toHaveBeenCalled();
    });

    it("should emit auth:failed on token-related errors", async () => {
      const { wsClient } = await import("../../lib/websocket");

      const authFailedHandler = vi.fn();
      wsClient.on("auth:failed", authFailedHandler);

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({
        type: "error",
        payload: { message: "Invalid token" },
      });

      expect(authFailedHandler).toHaveBeenCalled();
    });

    it("should handle malformed JSON gracefully", async () => {
      const { wsClient } = await import("../../lib/websocket");
      const { logger } = await import("../../lib/logger");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];

      // Simulate malformed message
      ws.onmessage?.({ data: "not valid json {" });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("channel operations", () => {
    it("should track joined channels", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.joinChannel("channel-1");
      wsClient.joinChannel("channel-2");

      const sentMessages = ws.getSentMessages();
      const joinMessages = sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "channel:join";
      });

      expect(joinMessages.length).toBe(2);
    });

    it("should send leave channel message", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.joinChannel("channel-1");
      wsClient.leaveChannel("channel-1");

      const sentMessages = ws.getSentMessages();
      const leaveMessage = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "channel:leave" && parsed.payload.channelId === "channel-1";
      });

      expect(leaveMessage).toBeDefined();
    });
  });

  describe("community operations", () => {
    it("should send join community message", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.joinCommunity("community-1");

      const sentMessages = ws.getSentMessages();
      const joinMessage = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "community:join" && parsed.payload.communityId === "community-1";
      });

      expect(joinMessage).toBeDefined();
    });

    it("should send leave community message", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.leaveCommunity("community-1");

      const sentMessages = ws.getSentMessages();
      const leaveMessage = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "community:leave" && parsed.payload.communityId === "community-1";
      });

      expect(leaveMessage).toBeDefined();
    });
  });

  describe("message operations", () => {
    it("should send message with correct payload", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.sendMessage("channel-123", "encrypted-ciphertext", "reply-to-id");

      const sentMessages = ws.getSentMessages();
      const messagePayload = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message:send";
      });

      expect(messagePayload).toBeDefined();
      const parsed = JSON.parse(messagePayload!);
      expect(parsed.payload.channelId).toBe("channel-123");
      expect(parsed.payload.ciphertext).toBe("encrypted-ciphertext");
      expect(parsed.payload.replyToId).toBe("reply-to-id");
    });

    it("should send edit message", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.editMessage("channel-123", "msg-456", "new-ciphertext");

      const sentMessages = ws.getSentMessages();
      const editMessage = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message:edit";
      });

      expect(editMessage).toBeDefined();
      const parsed = JSON.parse(editMessage!);
      expect(parsed.payload.messageId).toBe("msg-456");
      expect(parsed.payload.ciphertext).toBe("new-ciphertext");
    });

    it("should send delete message", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.deleteMessage("channel-123", "msg-456");

      const sentMessages = ws.getSentMessages();
      const deleteMessage = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "message:delete";
      });

      expect(deleteMessage).toBeDefined();
    });
  });

  describe("typing indicators", () => {
    it("should send typing start", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.startTyping("channel-123");

      const sentMessages = ws.getSentMessages();
      const typingStart = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "typing:start";
      });

      expect(typingStart).toBeDefined();
    });

    it("should send typing stop", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.stopTyping("channel-123");

      const sentMessages = ws.getSentMessages();
      const typingStop = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "typing:stop";
      });

      expect(typingStop).toBeDefined();
    });
  });

  describe("reactions", () => {
    it("should send add reaction", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.addReaction("msg-123", "channel-456", "👍");

      const sentMessages = ws.getSentMessages();
      const reactionAdd = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "reaction:add";
      });

      expect(reactionAdd).toBeDefined();
      const parsed = JSON.parse(reactionAdd!);
      expect(parsed.payload.emoji).toBe("👍");
    });

    it("should send remove reaction", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.removeReaction("reaction-id", "channel-456", "msg-123", "👍");

      const sentMessages = ws.getSentMessages();
      const reactionRemove = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "reaction:remove";
      });

      expect(reactionRemove).toBeDefined();
    });
  });

  describe("key requests", () => {
    it("should send key request", async () => {
      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage({ type: "auth:success", payload: {} });

      wsClient.requestKey("channel-123", "from-user-456");

      const sentMessages = ws.getSentMessages();
      const keyRequest = sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "key:request";
      });

      expect(keyRequest).toBeDefined();
      const parsed = JSON.parse(keyRequest!);
      expect(parsed.payload.channelId).toBe("channel-123");
      expect(parsed.payload.fromUserId).toBe("from-user-456");
    });
  });

  describe("reconnection", () => {
    it("should attempt reconnect on disconnect", async () => {
      vi.useFakeTimers();

      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await vi.advanceTimersByTimeAsync(10);

      const ws = mockWebSocketInstances[0];
      ws.simulateClose();

      // Should schedule reconnection
      await vi.advanceTimersByTimeAsync(2000);

      // A new WebSocket should be created
      expect(mockWebSocketInstances.length).toBe(2);

      vi.useRealTimers();
    });

    it("should use exponential backoff for reconnection", async () => {
      vi.useFakeTimers();

      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await vi.advanceTimersByTimeAsync(10);

      // First disconnect
      mockWebSocketInstances[0].simulateClose();
      await vi.advanceTimersByTimeAsync(2000); // First retry after 2s

      expect(mockWebSocketInstances.length).toBe(2);

      // Second disconnect
      mockWebSocketInstances[1].simulateClose();
      await vi.advanceTimersByTimeAsync(4000); // Second retry after 4s

      expect(mockWebSocketInstances.length).toBe(3);

      vi.useRealTimers();
    });

    it("should track reconnect attempts", async () => {
      vi.useFakeTimers();

      const { wsClient } = await import("../../lib/websocket");

      wsClient.connect("user-123", "token-abc");

      await vi.advanceTimersByTimeAsync(10);

      // First disconnect triggers reconnection
      mockWebSocketInstances[0].simulateClose();
      await vi.advanceTimersByTimeAsync(2000);

      // Should have created a new WebSocket for reconnection
      expect(mockWebSocketInstances.length).toBe(2);

      vi.useRealTimers();
    });
  });
});
