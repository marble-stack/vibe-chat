/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../../stores/chat";

describe("Chat Store", () => {
  beforeEach(() => {
    // Reset the store before each test
    useChatStore.setState({
      communities: [],
      channels: {},
      messages: {},
      members: {},
      activeCommunityId: null,
      activeChannelId: null,
      typingUsers: {},
      replyingTo: null,
      onlineUsers: {},
    });
  });

  describe("Communities", () => {
    it("should set communities", () => {
      const communities = [
        { id: "1", name: "Community 1", inviteCode: "abc123" },
        { id: "2", name: "Community 2", inviteCode: "def456" },
      ];

      useChatStore.getState().setCommunities(communities);

      expect(useChatStore.getState().communities).toEqual(communities);
    });

    it("should add a community", () => {
      const community = { id: "1", name: "New Community", inviteCode: "xyz789" };

      useChatStore.getState().addCommunity(community);

      expect(useChatStore.getState().communities).toContainEqual(community);
    });

    it("should set active community", () => {
      useChatStore.getState().setActiveCommunity("community-1");

      expect(useChatStore.getState().activeCommunityId).toBe("community-1");
    });

    it("should clear active community", () => {
      useChatStore.getState().setActiveCommunity("community-1");
      useChatStore.getState().setActiveCommunity(null);

      expect(useChatStore.getState().activeCommunityId).toBeNull();
    });
  });

  describe("Channels", () => {
    it("should set channels for a community", () => {
      const channels = [
        { id: "ch1", communityId: "comm1", name: "general" },
        { id: "ch2", communityId: "comm1", name: "random" },
      ];

      useChatStore.getState().setChannels("comm1", channels);

      expect(useChatStore.getState().channels["comm1"]).toEqual(channels);
    });

    it("should add a channel", () => {
      const channel = { id: "ch1", communityId: "comm1", name: "new-channel" };

      useChatStore.getState().addChannel(channel);

      expect(useChatStore.getState().channels["comm1"]).toContainEqual(channel);
    });

    it("should append to existing channels", () => {
      const channel1 = { id: "ch1", communityId: "comm1", name: "general" };
      const channel2 = { id: "ch2", communityId: "comm1", name: "random" };

      useChatStore.getState().addChannel(channel1);
      useChatStore.getState().addChannel(channel2);

      expect(useChatStore.getState().channels["comm1"]).toHaveLength(2);
    });

    it("should set active channel", () => {
      useChatStore.getState().setActiveChannel("channel-1");

      expect(useChatStore.getState().activeChannelId).toBe("channel-1");
    });
  });

  describe("Messages", () => {
    it("should set messages for a channel", () => {
      const messages = [
        {
          id: "msg1",
          channelId: "ch1",
          senderId: "user1",
          ciphertext: "encrypted1",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg2",
          channelId: "ch1",
          senderId: "user2",
          ciphertext: "encrypted2",
          createdAt: "2024-01-01T00:01:00Z",
        },
      ];

      useChatStore.getState().setMessages("ch1", messages);

      expect(useChatStore.getState().messages["ch1"]).toEqual(messages);
    });

    it("should add a message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);

      expect(useChatStore.getState().messages["ch1"]).toContainEqual(message);
    });

    it("should deduplicate messages with same id", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addMessage(message);

      expect(useChatStore.getState().messages["ch1"]).toHaveLength(1);
    });

    it("should update a message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().updateMessage("ch1", "msg1", {
        plaintext: "decrypted content",
      });

      const updated = useChatStore.getState().messages["ch1"][0];
      expect(updated.plaintext).toBe("decrypted content");
    });

    it("should delete a message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().deleteMessage("ch1", "msg1");

      expect(useChatStore.getState().messages["ch1"]).toHaveLength(0);
    });

    it("should get message by id", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);

      const retrieved = useChatStore.getState().getMessageById("ch1", "msg1");
      expect(retrieved).toEqual(message);
    });

    it("should return undefined for non-existent message", () => {
      const retrieved = useChatStore.getState().getMessageById("ch1", "non-existent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("Members", () => {
    it("should set members for a community", () => {
      const members = [
        { id: "user1", displayName: "User One" },
        { id: "user2", displayName: "User Two" },
      ];

      useChatStore.getState().setMembers("comm1", members);

      expect(useChatStore.getState().members["comm1"]).toEqual(members);
    });

    it("should add member if missing", () => {
      useChatStore.getState().setActiveCommunity("comm1");
      useChatStore.getState().setMembers("comm1", []);

      useChatStore.getState().addMemberIfMissing("user1", "New User");

      expect(useChatStore.getState().members["comm1"]).toContainEqual({
        id: "user1",
        displayName: "New User",
      });
    });

    it("should not duplicate existing member", () => {
      useChatStore.getState().setActiveCommunity("comm1");
      useChatStore.getState().setMembers("comm1", [{ id: "user1", displayName: "User One" }]);

      useChatStore.getState().addMemberIfMissing("user1", "User One Updated");

      expect(useChatStore.getState().members["comm1"]).toHaveLength(1);
      expect(useChatStore.getState().members["comm1"][0].displayName).toBe("User One");
    });

    it("should add member to specific community", () => {
      useChatStore.getState().setMembers("comm1", []);

      useChatStore.getState().addMemberToCommunity("comm1", {
        id: "user1",
        displayName: "User One",
      });

      expect(useChatStore.getState().members["comm1"]).toContainEqual({
        id: "user1",
        displayName: "User One",
      });
    });

    it("should not duplicate member in community", () => {
      useChatStore.getState().setMembers("comm1", [{ id: "user1", displayName: "User One" }]);

      useChatStore.getState().addMemberToCommunity("comm1", {
        id: "user1",
        displayName: "User One Again",
      });

      expect(useChatStore.getState().members["comm1"]).toHaveLength(1);
    });
  });

  describe("Typing Users", () => {
    it("should set user as typing", () => {
      useChatStore.getState().setTypingUser("ch1", "user1", true);

      expect(useChatStore.getState().typingUsers["ch1"]).toContain("user1");
    });

    it("should remove user from typing", () => {
      useChatStore.getState().setTypingUser("ch1", "user1", true);
      useChatStore.getState().setTypingUser("ch1", "user1", false);

      expect(useChatStore.getState().typingUsers["ch1"]).not.toContain("user1");
    });

    it("should handle multiple users typing", () => {
      useChatStore.getState().setTypingUser("ch1", "user1", true);
      useChatStore.getState().setTypingUser("ch1", "user2", true);

      expect(useChatStore.getState().typingUsers["ch1"]).toContain("user1");
      expect(useChatStore.getState().typingUsers["ch1"]).toContain("user2");
    });

    it("should not duplicate typing user", () => {
      useChatStore.getState().setTypingUser("ch1", "user1", true);
      useChatStore.getState().setTypingUser("ch1", "user1", true);

      expect(useChatStore.getState().typingUsers["ch1"]).toHaveLength(1);
    });

    it("should handle typing across channels independently", () => {
      useChatStore.getState().setTypingUser("ch1", "user1", true);
      useChatStore.getState().setTypingUser("ch2", "user2", true);

      expect(useChatStore.getState().typingUsers["ch1"]).toContain("user1");
      expect(useChatStore.getState().typingUsers["ch1"]).not.toContain("user2");
      expect(useChatStore.getState().typingUsers["ch2"]).toContain("user2");
    });
  });

  describe("Reply State", () => {
    it("should set replying to message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().setReplyingTo(message);

      expect(useChatStore.getState().replyingTo).toEqual(message);
    });

    it("should clear replying to message", () => {
      useChatStore.getState().setReplyingTo({
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      });
      useChatStore.getState().setReplyingTo(null);

      expect(useChatStore.getState().replyingTo).toBeNull();
    });
  });

  describe("Online Users", () => {
    it("should set online users for community", () => {
      useChatStore.getState().setOnlineUsers("comm1", ["user1", "user2"]);

      expect(useChatStore.getState().onlineUsers["comm1"]).toEqual(["user1", "user2"]);
    });

    it("should set user online", () => {
      useChatStore.getState().setOnlineUsers("comm1", []);
      useChatStore.getState().setUserOnline("comm1", "user1", true);

      expect(useChatStore.getState().onlineUsers["comm1"]).toContain("user1");
    });

    it("should set user offline", () => {
      useChatStore.getState().setOnlineUsers("comm1", ["user1"]);
      useChatStore.getState().setUserOnline("comm1", "user1", false);

      expect(useChatStore.getState().onlineUsers["comm1"]).not.toContain("user1");
    });

    it("should not duplicate online user", () => {
      useChatStore.getState().setOnlineUsers("comm1", ["user1"]);
      useChatStore.getState().setUserOnline("comm1", "user1", true);

      expect(useChatStore.getState().onlineUsers["comm1"]).toHaveLength(1);
    });

    it("should check if user is online", () => {
      useChatStore.getState().setOnlineUsers("comm1", ["user1"]);

      expect(useChatStore.getState().isUserOnline("comm1", "user1")).toBe(true);
      expect(useChatStore.getState().isUserOnline("comm1", "user2")).toBe(false);
    });
  });

  describe("Reactions", () => {
    it("should add reaction to message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addReaction("msg1", "reaction1", "user2", "👍");

      const updatedMessage = useChatStore.getState().messages["ch1"][0];
      expect(updatedMessage.reactions).toBeDefined();
      expect(updatedMessage.reactions).toHaveLength(1);
      expect(updatedMessage.reactions![0].emoji).toBe("👍");
      expect(updatedMessage.reactions![0].count).toBe(1);
      expect(updatedMessage.reactions![0].userIds).toContain("user2");
    });

    it("should increment count for existing reaction", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addReaction("msg1", "reaction1", "user2", "👍");
      useChatStore.getState().addReaction("msg1", "reaction2", "user3", "👍");

      const updatedMessage = useChatStore.getState().messages["ch1"][0];
      expect(updatedMessage.reactions).toHaveLength(1);
      expect(updatedMessage.reactions![0].count).toBe(2);
      expect(updatedMessage.reactions![0].userIds).toContain("user2");
      expect(updatedMessage.reactions![0].userIds).toContain("user3");
    });

    it("should remove reaction from message", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addReaction("msg1", "reaction1", "user2", "👍");
      useChatStore.getState().removeReaction("msg1", "user2", "👍");

      const updatedMessage = useChatStore.getState().messages["ch1"][0];
      expect(updatedMessage.reactions).toHaveLength(0);
    });

    it("should decrement count when removing one of multiple reactions", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addReaction("msg1", "reaction1", "user2", "👍");
      useChatStore.getState().addReaction("msg1", "reaction2", "user3", "👍");
      useChatStore.getState().removeReaction("msg1", "user2", "👍");

      const updatedMessage = useChatStore.getState().messages["ch1"][0];
      expect(updatedMessage.reactions).toHaveLength(1);
      expect(updatedMessage.reactions![0].count).toBe(1);
      expect(updatedMessage.reactions![0].userIds).not.toContain("user2");
      expect(updatedMessage.reactions![0].userIds).toContain("user3");
    });

    it("should handle multiple emoji reactions", () => {
      const message = {
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted",
        createdAt: "2024-01-01T00:00:00Z",
      };

      useChatStore.getState().addMessage(message);
      useChatStore.getState().addReaction("msg1", "reaction1", "user2", "👍");
      useChatStore.getState().addReaction("msg1", "reaction2", "user3", "❤️");

      const updatedMessage = useChatStore.getState().messages["ch1"][0];
      expect(updatedMessage.reactions).toHaveLength(2);
    });
  });

  describe("State Isolation", () => {
    it("should maintain separate messages per channel", () => {
      useChatStore.getState().addMessage({
        id: "msg1",
        channelId: "ch1",
        senderId: "user1",
        ciphertext: "encrypted1",
        createdAt: "2024-01-01T00:00:00Z",
      });
      useChatStore.getState().addMessage({
        id: "msg2",
        channelId: "ch2",
        senderId: "user1",
        ciphertext: "encrypted2",
        createdAt: "2024-01-01T00:00:00Z",
      });

      expect(useChatStore.getState().messages["ch1"]).toHaveLength(1);
      expect(useChatStore.getState().messages["ch2"]).toHaveLength(1);
    });

    it("should maintain separate channels per community", () => {
      useChatStore.getState().addChannel({ id: "ch1", communityId: "comm1", name: "general" });
      useChatStore.getState().addChannel({ id: "ch2", communityId: "comm2", name: "general" });

      expect(useChatStore.getState().channels["comm1"]).toHaveLength(1);
      expect(useChatStore.getState().channels["comm2"]).toHaveLength(1);
    });
  });
});

describe("Chat Store - State Cleanup", () => {
  beforeEach(() => {
    useChatStore.setState({
      communities: [],
      channels: {},
      messages: {},
      members: {},
      activeCommunityId: null,
      activeChannelId: null,
      typingUsers: {},
      replyingTo: null,
      onlineUsers: {},
    });
  });

  it("should clear messages for a specific channel", () => {
    useChatStore.getState().addMessage({
      id: "msg1",
      channelId: "ch1",
      senderId: "user1",
      ciphertext: "encrypted",
      createdAt: "2024-01-01T00:00:00Z",
    });
    useChatStore.getState().addMessage({
      id: "msg2",
      channelId: "ch2",
      senderId: "user1",
      ciphertext: "encrypted",
      createdAt: "2024-01-01T00:00:00Z",
    });

    useChatStore.getState().clearChannelMessages("ch1");

    expect(useChatStore.getState().messages["ch1"]).toBeUndefined();
    expect(useChatStore.getState().messages["ch2"]).toBeDefined();
    expect(useChatStore.getState().messages["ch2"]).toHaveLength(1);
  });

  it("should clear typing users for a specific channel", () => {
    useChatStore.getState().setTypingUser("ch1", "user1", true);
    useChatStore.getState().setTypingUser("ch2", "user2", true);

    useChatStore.getState().clearTypingUsers("ch1");

    expect(useChatStore.getState().typingUsers["ch1"]).toBeUndefined();
    expect(useChatStore.getState().typingUsers["ch2"]).toBeDefined();
    expect(useChatStore.getState().typingUsers["ch2"]).toContain("user2");
  });

  it("should clear both messages and typing users with clearChannelState", () => {
    useChatStore.getState().addMessage({
      id: "msg1",
      channelId: "ch1",
      senderId: "user1",
      ciphertext: "encrypted",
      createdAt: "2024-01-01T00:00:00Z",
    });
    useChatStore.getState().setTypingUser("ch1", "user1", true);

    useChatStore.getState().clearChannelState("ch1");

    expect(useChatStore.getState().messages["ch1"]).toBeUndefined();
    expect(useChatStore.getState().typingUsers["ch1"]).toBeUndefined();
  });

  it("should not affect other channels when clearing state", () => {
    // Set up state for multiple channels
    useChatStore.getState().addMessage({
      id: "msg1",
      channelId: "ch1",
      senderId: "user1",
      ciphertext: "encrypted1",
      createdAt: "2024-01-01T00:00:00Z",
    });
    useChatStore.getState().addMessage({
      id: "msg2",
      channelId: "ch2",
      senderId: "user2",
      ciphertext: "encrypted2",
      createdAt: "2024-01-01T00:01:00Z",
    });
    useChatStore.getState().setTypingUser("ch1", "user1", true);
    useChatStore.getState().setTypingUser("ch2", "user2", true);

    // Clear only ch1
    useChatStore.getState().clearChannelState("ch1");

    // ch2 should be intact
    expect(useChatStore.getState().messages["ch2"]).toHaveLength(1);
    expect(useChatStore.getState().typingUsers["ch2"]).toContain("user2");
  });

  it("should handle clearing non-existent channel gracefully", () => {
    // Should not throw
    useChatStore.getState().clearChannelMessages("non-existent");
    useChatStore.getState().clearTypingUsers("non-existent");
    useChatStore.getState().clearChannelState("non-existent");

    expect(useChatStore.getState().messages["non-existent"]).toBeUndefined();
  });
});
