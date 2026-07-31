import { describe, it, expect, beforeEach, vi } from "vitest";

// Controllable socketUsers map + sendToChannel spy (hoisted so the mock factory
// below, which is itself hoisted, can reference them).
const { socketUsers, sendToChannel } = vi.hoisted(() => ({
  socketUsers: new Map<
    object,
    { userId: string; channelIds: Set<string>; communityIds: Set<string> }
  >(),
  sendToChannel: vi.fn(),
}));

vi.mock("../../websocket/connectionMaps.js", () => ({
  socketUsers,
  sendToChannel,
  channelConnections: new Map(),
  communityOnlineUsers: new Map(),
  communityConnections: new Map(),
  cleanupEmptyMaps: vi.fn(),
}));

// Pass payloads through unchanged so we exercise the authorization logic
vi.mock("../../websocket/schemas.js", () => ({
  validatePayload: (_type: string, payload: unknown) => payload,
}));

vi.mock("../../lib/authorization.js", () => ({
  isUserInCommunity: vi.fn(),
  canUserAccessChannel: vi.fn(),
}));

vi.mock("../../db/index.js", () => {
  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "reaction-new" }]),
      }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    query: {
      reactions: { findFirst: vi.fn() },
    },
  };
  return {
    db: mockDb,
    reactions: { id: "id", messageId: "messageId", userId: "userId", emoji: "emoji" },
    messages: {},
    users: {},
    senderKeys: {},
    pendingKeyRequests: {},
    pollVotes: {},
  };
});

import { handleMessage } from "../../websocket/index.js";
import { db } from "../../db/index.js";
import { canUserAccessChannel } from "../../lib/authorization.js";

const mockDb = db as unknown as {
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  query: { reactions: { findFirst: ReturnType<typeof vi.fn> } };
};

describe("WebSocket reaction authorization", () => {
  const userId = "user-1";
  const otherUserId = "user-2";
  const channelId = "channel-1";
  const messageId = "message-1";
  const reactionId = "reaction-1";
  let socket: { send: ReturnType<typeof vi.fn> };

  const lastError = () => {
    const call = socket.send.mock.calls.at(-1);
    return call ? JSON.parse(call[0]) : null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    socketUsers.clear();
    socket = { send: vi.fn() };
    socketUsers.set(socket, {
      userId,
      channelIds: new Set([channelId]),
      communityIds: new Set(),
    });
  });

  describe("reaction:add", () => {
    it("rejects a user who cannot access the channel", async () => {
      vi.mocked(canUserAccessChannel).mockResolvedValue(false);

      await handleMessage(socket as never, {
        type: "reaction:add",
        payload: { messageId, channelId, emoji: "👍" },
      });

      expect(lastError().type).toBe("error");
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(sendToChannel).not.toHaveBeenCalled();
    });

    it("allows a channel member to add a reaction", async () => {
      vi.mocked(canUserAccessChannel).mockResolvedValue(true);
      mockDb.query.reactions.findFirst.mockResolvedValue(null);

      await handleMessage(socket as never, {
        type: "reaction:add",
        payload: { messageId, channelId, emoji: "👍" },
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(sendToChannel).toHaveBeenCalledWith(
        channelId,
        expect.objectContaining({ type: "reaction:added" })
      );
    });
  });

  describe("reaction:remove", () => {
    it("rejects deleting a reaction owned by another user (IDOR)", async () => {
      vi.mocked(canUserAccessChannel).mockResolvedValue(true);
      mockDb.query.reactions.findFirst.mockResolvedValue({
        id: reactionId,
        userId: otherUserId,
      });

      await handleMessage(socket as never, {
        type: "reaction:remove",
        payload: { reactionId, channelId, messageId, emoji: "👍" },
      });

      expect(lastError().type).toBe("error");
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(sendToChannel).not.toHaveBeenCalled();
    });

    it("allows a user to delete their own reaction", async () => {
      vi.mocked(canUserAccessChannel).mockResolvedValue(true);
      mockDb.query.reactions.findFirst.mockResolvedValue({
        id: reactionId,
        userId,
      });

      await handleMessage(socket as never, {
        type: "reaction:remove",
        payload: { reactionId, channelId, messageId, emoji: "👍" },
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(sendToChannel).toHaveBeenCalledWith(
        channelId,
        expect.objectContaining({ type: "reaction:removed" })
      );
    });
  });
});
