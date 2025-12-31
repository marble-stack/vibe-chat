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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("WebSocket connected");
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
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket disconnected");
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

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

  sendMessage(channelId: string, ciphertext: string, replyToId?: string) {
    this.send({
      type: "message:send",
      payload: { channelId, ciphertext, replyToId },
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
