import { logger } from './logger';

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
  private joinedChannels: Set<string> = new Set();

  connect(userId: string) {
    this.userId = userId;

    // Use environment variable if available, otherwise fall back to window.location
    const wsUrl = import.meta.env.VITE_WS_URL || (() => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}/ws`;
    })();

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      logger.debug("WebSocket connected");
      this.reconnectAttempts = 0;

      // Authenticate
      this.send({ type: "auth", payload: { userId } });

      // Rejoin channels
      for (const channelId of this.joinedChannels) {
        this.send({ type: "channel:join", payload: { channelId } });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data);
        this.emit(message.type, message);
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    };

    this.ws.onclose = () => {
      logger.debug("WebSocket disconnected");
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
      if (this.userId) {
        this.connect(this.userId);
      }
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.joinedChannels.clear();
  }

  send(message: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
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
    this.send({ type: "community:join", payload: { communityId } });
  }

  leaveCommunity(communityId: string) {
    this.send({ type: "community:leave", payload: { communityId } });
  }

  sendMessage(channelId: string, ciphertext: string, replyToId?: string) {
    this.send({
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
