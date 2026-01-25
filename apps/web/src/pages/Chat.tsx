import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { api } from "../lib/api";
import { wsClient } from "../lib/websocket";
import { decryptChannelMessage } from "../lib/channelCrypto";
import { logger } from "../lib/logger";
import { Sidebar } from "../components/Sidebar";
import { ChannelList } from "../components/ChannelList";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { MemberList } from "../components/MemberList";

export function Chat() {
  const user = useAuthStore((state) => state.user);
  const {
    activeCommunityId,
    activeChannelId,
    members,
    setCommunities,
    setChannels,
    setMembers,
    addMessage,
    addMemberIfMissing,
    setTypingUser,
    setOnlineUsers,
    setUserOnline,
    updateMessage,
    deleteMessage,
  } = useChatStore();

  // Ref to track current members for the WebSocket handler
  const membersRef = useRef(members);
  const activeCommunityRef = useRef(activeCommunityId);

  useEffect(() => {
    membersRef.current = members;
    activeCommunityRef.current = activeCommunityId;
  }, [members, activeCommunityId]);

  // Load communities on mount
  useEffect(() => {
    if (!user) return;

    api.communities.list(user.id).then(({ communities }) => {
      setCommunities(communities);
    });
  }, [user, setCommunities]);

  // Load community details when active community changes
  useEffect(() => {
    if (!activeCommunityId) return;

    api.communities.get(activeCommunityId).then(({ channels, members }) => {
      setChannels(activeCommunityId, channels);
      setMembers(activeCommunityId, members);
    });
  }, [activeCommunityId, setChannels, setMembers]);

  // Connect WebSocket
  useEffect(() => {
    if (!user) return;

    wsClient.connect(user.id);

    // Handle incoming messages
    const handleNewMessage = async (msg: { payload: Record<string, unknown> }) => {
      const payload = msg.payload as {
        id: string;
        channelId: string;
        senderId: string;
        senderDisplayName?: string;
        ciphertext: string;
        replyToId?: string;
        createdAt: string;
      };

      // Add sender to members if we have their info and they're not already known
      if (payload.senderDisplayName) {
        addMemberIfMissing(payload.senderId, payload.senderDisplayName);
      }

      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      const currentMembers = currentCommunityId
        ? membersRef.current[currentCommunityId] || []
        : [];

      // Decrypt the message
      let plaintext = payload.ciphertext;
      try {
        if (user) {
          plaintext = await decryptChannelMessage(
            payload.channelId,
            payload.ciphertext,
            currentMembers,
            user.id
          );
        }
      } catch (err) {
        logger.error('Failed to decrypt message:', err);
        // Keep ciphertext as fallback
      }

      addMessage({
        id: payload.id,
        channelId: payload.channelId,
        senderId: payload.senderId,
        ciphertext: payload.ciphertext,
        plaintext,
        replyToId: payload.replyToId,
        createdAt: payload.createdAt,
      });
    };

    // Handle typing indicators
    const handleTypingUpdate = (msg: { payload: Record<string, unknown> }) => {
      const { channelId, userId, isTyping } = msg.payload as {
        channelId: string;
        userId: string;
        isTyping: boolean;
      };
      setTypingUser(channelId, userId, isTyping);
    };

    // Handle presence list (initial online users when joining a community)
    const handlePresenceList = (msg: { payload: Record<string, unknown> }) => {
      const { communityId, onlineUserIds } = msg.payload as {
        communityId: string;
        onlineUserIds: string[];
      };
      setOnlineUsers(communityId, onlineUserIds);
    };

    // Handle presence update (user came online/offline)
    const handlePresenceUpdate = (msg: { payload: Record<string, unknown> }) => {
      const { communityId, userId, isOnline } = msg.payload as {
        communityId: string;
        userId: string;
        isOnline: boolean;
      };
      setUserOnline(communityId, userId, isOnline);
    };

    // Handle message edited
    const handleMessageEdited = async (msg: { payload: Record<string, unknown> }) => {
      const { id, channelId, ciphertext, editedAt } = msg.payload as {
        id: string;
        channelId: string;
        ciphertext: string;
        editedAt: string;
      };

      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      const currentMembers = currentCommunityId
        ? membersRef.current[currentCommunityId] || []
        : [];

      // Decrypt the updated message
      let plaintext = ciphertext;
      try {
        if (user) {
          plaintext = await decryptChannelMessage(
            channelId,
            ciphertext,
            currentMembers,
            user.id
          );
        }
      } catch (err) {
        logger.error('Failed to decrypt edited message:', err);
      }

      updateMessage(channelId, id, { ciphertext, plaintext, editedAt });
    };

    // Handle message deleted
    const handleMessageDeleted = (msg: { payload: Record<string, unknown> }) => {
      const { id, channelId } = msg.payload as {
        id: string;
        channelId: string;
      };
      deleteMessage(channelId, id);
    };

    wsClient.on("message:new", handleNewMessage);
    wsClient.on("typing:update", handleTypingUpdate);
    wsClient.on("presence:list", handlePresenceList);
    wsClient.on("presence:update", handlePresenceUpdate);
    wsClient.on("message:edited", handleMessageEdited);
    wsClient.on("message:deleted", handleMessageDeleted);

    return () => {
      wsClient.off("message:new", handleNewMessage);
      wsClient.off("typing:update", handleTypingUpdate);
      wsClient.off("presence:list", handlePresenceList);
      wsClient.off("presence:update", handlePresenceUpdate);
      wsClient.off("message:edited", handleMessageEdited);
      wsClient.off("message:deleted", handleMessageDeleted);
      wsClient.disconnect();
    };
  }, [user, addMessage, setTypingUser, setOnlineUsers, setUserOnline, updateMessage, deleteMessage]);

  // Join active community for presence updates
  useEffect(() => {
    if (activeCommunityId) {
      wsClient.joinCommunity(activeCommunityId);
    }
  }, [activeCommunityId]);

  // Join active channel
  useEffect(() => {
    if (activeChannelId) {
      wsClient.joinChannel(activeChannelId);
    }
  }, [activeChannelId]);

  return (
    <div className="h-screen flex bg-background-primary">
      {/* Community sidebar */}
      <Sidebar />

      {/* Channel list */}
      <ChannelList />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {activeChannelId ? (
          <>
            <MessageList />
            <MessageInput />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Select a channel to start chatting
          </div>
        )}
      </div>

      {/* Member list */}
      {activeCommunityId && <MemberList />}
    </div>
  );
}
