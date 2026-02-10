import { logger } from "./logger";

type MessageHandler = (message: WsMessage) => void;

interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private userId: string | null = null;
  private token: string | null = null;
  private joinedChannels: Set<string> = new Set();
  private joinedCommunities: Set<string> = new Set();
  private authenticated = false;
  private pendingMessages: WsMessage[] = [];

  connect(userId: string, token: string) {
    this.userId = userId;
    this.token = token;
    this.authenticated = false;

    // Use environment variable if available, otherwise fall back to window.location
    const wsUrl =
      import.meta.env.VITE_WS_URL ||
      (() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/ws`;
      })();

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      logger.debug("WebSocket connected");
      this.reconnectAttempts = 0;

      // Authenticate with JWT token - send directly to avoid queueing
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "auth", payload: { token } }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data);

        // Handle authentication success
        if (message.type === "auth:success") {
          logger.debug("WebSocket authenticated");
          this.authenticated = true;

          // Rejoin channels and communities after auth succeeds
          for (const channelId of this.joinedChannels) {
            this.send({ type: "channel:join", payload: { channelId } });
          }
          for (const communityId of this.joinedCommunities) {
            this.send({ type: "community:join", payload: { communityId } });
          }

          // Send any queued messages
          while (this.pendingMessages.length > 0) {
            const pending = this.pendingMessages.shift();
            if (pending) {
              this.send(pending);
            }
          }
        }

        // Handle errors from server
        if (message.type === "error") {
          const errorMsg = (message.payload?.message as string) || "Unknown error";
          logger.error("WebSocket server error:", errorMsg);

          // Emit error for UI to handle
          this.emit("error", message);

          // If auth failed, clear authenticated state
          if (errorMsg.includes("token") || errorMsg.includes("authenticated")) {
            this.authenticated = false;
            // Emit auth failure for UI to handle (e.g., force re-login)
            this.emit("auth:failed", message);
          }
        }

        this.emit(message.type, message);
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    };

    this.ws.onclose = () => {
      logger.debug("WebSocket disconnected");
      this.authenticated = false;
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      logger.error("WebSocket error:", error);
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.userId && this.token) {
        this.connect(this.userId, this.token);
      }
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.joinedChannels.clear();
    this.joinedCommunities.clear();
    this.authenticated = false;
    this.pendingMessages = [];
  }

  send(message: WsMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn("WebSocket not connected, queueing message:", message.type);
      this.pendingMessages.push(message);
      return false;
    }

    if (!this.authenticated && message.type !== "auth") {
      logger.warn("WebSocket not authenticated, queueing message:", message.type);
      this.pendingMessages.push(message);
      return false;
    }

    this.ws.send(JSON.stringify(message));
    return true;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  joinChannel(channelId: string) {
    this.joinedChannels.add(channelId);
    this.send({ type: "channel:join", payload: { channelId } });
  }

  leaveChannel(channelId: string) {
    this.joinedChannels.delete(channelId);
    this.send({ type: "channel:leave", payload: { channelId } });
  }

  joinCommunity(communityId: string) {
    this.joinedCommunities.add(communityId);
    this.send({ type: "community:join", payload: { communityId } });
  }

  leaveCommunity(communityId: string) {
    this.joinedCommunities.delete(communityId);
    this.send({ type: "community:leave", payload: { communityId } });
  }

  sendMessage(channelId: string, ciphertext: string, replyToId?: string): boolean {
    return this.send({
      type: "message:send",
      payload: { channelId, ciphertext, replyToId },
    });
  }

  editMessage(channelId: string, messageId: string, ciphertext: string) {
    this.send({
      type: "message:edit",
      payload: { channelId, messageId, ciphertext },
    });
  }

  deleteMessage(channelId: string, messageId: string) {
    this.send({
      type: "message:delete",
      payload: { channelId, messageId },
    });
  }

  startTyping(channelId: string) {
    this.send({ type: "typing:start", payload: { channelId } });
  }

  stopTyping(channelId: string) {
    this.send({ type: "typing:stop", payload: { channelId } });
  }

  addReaction(messageId: string, channelId: string, emoji: string) {
    this.send({ type: "reaction:add", payload: { messageId, channelId, emoji } });
  }

  removeReaction(reactionId: string, channelId: string, messageId: string, emoji: string) {
    this.send({ type: "reaction:remove", payload: { reactionId, channelId, messageId, emoji } });
  }

  requestKey(channelId: string, fromUserId: string) {
    this.send({ type: "key:request", payload: { channelId, fromUserId } });
  }

  votePoll(messageId: string, channelId: string, optionIndex: number) {
    this.send({ type: "poll:vote", payload: { messageId, channelId, optionIndex } });
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, message: WsMessage) {
    this.handlers.get(type)?.forEach((handler) => handler(message));
  }
}

export const wsClient = new WebSocketClient();
