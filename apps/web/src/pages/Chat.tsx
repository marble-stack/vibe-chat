import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { api } from "../lib/api";
import { wsClient } from "../lib/websocket";
import { decryptChannelMessage } from "../lib/channelCrypto";
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
        console.error('Failed to decrypt message:', err);
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
    wsClient.on("reaction:added", handleReactionAdded);
    wsClient.on("reaction:removed", handleReactionRemoved);

    return () => {
      wsClient.off("message:new", handleNewMessage);
      wsClient.off("typing:update", handleTypingUpdate);
      wsClient.off("reaction:added", handleReactionAdded);
      wsClient.off("reaction:removed", handleReactionRemoved);
      wsClient.disconnect();
    };
  }, [user, addMessage, setTypingUser, addReaction, removeReaction]);

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
