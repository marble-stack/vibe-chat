import { useEffect, useRef, useState } from "react";
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
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
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
    addReaction,
    removeReaction,
  } = useChatStore();

  // Mobile navigation state
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Close mobile sidebar when clicking outside
  const handleBackdropClick = () => {
    setShowMobileSidebar(false);
  };

  // Ref to track current members for the WebSocket handler
  const membersRef = useRef(members);
  const activeCommunityRef = useRef(activeCommunityId);

  useEffect(() => {
    membersRef.current = members;
    activeCommunityRef.current = activeCommunityId;
  }, [members, activeCommunityId]);

  // Load communities on mount (wait for auth store to rehydrate first)
  useEffect(() => {
    if (!user || !hasHydrated) return;

    const loadCommunities = async () => {
      try {
        const { communities } = await api.communities.list(user.id);
        setCommunities(communities);
      } catch (err) {
        logger.error('Failed to load communities:', err);
        // Retry once after a short delay (helps with mobile auth timing)
        setTimeout(async () => {
          try {
            const { communities } = await api.communities.list(user.id);
            setCommunities(communities);
          } catch (retryErr) {
            logger.error('Failed to load communities on retry:', retryErr);
          }
        }, 500);
      }
    };

    loadCommunities();
  }, [user, hasHydrated, setCommunities]);

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
      let currentMembers = currentCommunityId
        ? membersRef.current[currentCommunityId] || []
        : [];

      // Ensure current user is in members list for key distribution/retrieval
      if (user && !currentMembers.some(m => m.id === user.id)) {
        currentMembers = [...currentMembers, { id: user.id, displayName: user.displayName || 'Me' }];
      }

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
      let currentMembers = currentCommunityId
        ? membersRef.current[currentCommunityId] || []
        : [];

      // Ensure current user is in members list for key distribution/retrieval
      if (user && !currentMembers.some(m => m.id === user.id)) {
        currentMembers = [...currentMembers, { id: user.id, displayName: user.displayName || 'Me' }];
      }

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

    // Handle reaction added
    const handleReactionAdded = (msg: { payload: Record<string, unknown> }) => {
      const { reactionId, messageId, userId, emoji } = msg.payload as {
        reactionId: string;
        messageId: string;
        userId: string;
        emoji: string;
      };
      addReaction(messageId, reactionId, userId, emoji);
    };

    // Handle reaction removed
    const handleReactionRemoved = (msg: { payload: Record<string, unknown> }) => {
      const { messageId, userId, emoji } = msg.payload as {
        messageId: string;
        userId: string;
        emoji: string;
      };
      removeReaction(messageId, userId, emoji);
    };

    wsClient.on("message:new", handleNewMessage);
    wsClient.on("typing:update", handleTypingUpdate);
    wsClient.on("presence:list", handlePresenceList);
    wsClient.on("presence:update", handlePresenceUpdate);
    wsClient.on("message:edited", handleMessageEdited);
    wsClient.on("message:deleted", handleMessageDeleted);
    wsClient.on("reaction:added", handleReactionAdded);
    wsClient.on("reaction:removed", handleReactionRemoved);

    return () => {
      wsClient.off("message:new", handleNewMessage);
      wsClient.off("typing:update", handleTypingUpdate);
      wsClient.off("presence:list", handlePresenceList);
      wsClient.off("presence:update", handlePresenceUpdate);
      wsClient.off("message:edited", handleMessageEdited);
      wsClient.off("message:deleted", handleMessageDeleted);
      wsClient.off("reaction:added", handleReactionAdded);
      wsClient.off("reaction:removed", handleReactionRemoved);
      wsClient.disconnect();
    };
  }, [user, addMessage, setTypingUser, setOnlineUsers, setUserOnline, updateMessage, deleteMessage, addReaction, removeReaction, addMemberIfMissing]);

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
      {/* Mobile backdrop overlay */}
      {showMobileSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={handleBackdropClick}
        />
      )}

      {/* Community sidebar */}
      <Sidebar
        showMobile={showMobileSidebar}
        onClose={() => setShowMobileSidebar(false)}
      />

      {/* Channel list - hidden on mobile when chat is active */}
      <ChannelList
        showOnMobile={!activeChannelId}
        onOpenSidebar={() => setShowMobileSidebar(true)}
      />

      {/* Main chat area - only show on mobile when channel is selected */}
      <div className={`flex-1 flex flex-col ${activeChannelId ? 'flex' : 'hidden md:flex'}`}>
        {activeChannelId ? (
          <>
            <MessageList
              onOpenSidebar={() => setShowMobileSidebar(true)}
            />
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
