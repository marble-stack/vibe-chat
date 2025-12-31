import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { api } from "../lib/api";
import { wsClient } from "../lib/websocket";
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
    setCommunities,
    setChannels,
    setMembers,
    addMessage,
    setTypingUser,
  } = useChatStore();

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
    wsClient.on("message:new", (msg) => {
      const payload = msg.payload as {
        id: string;
        channelId: string;
        senderId: string;
        ciphertext: string;
        replyToId?: string;
        createdAt: string;
      };

      addMessage({
        id: payload.id,
        channelId: payload.channelId,
        senderId: payload.senderId,
        ciphertext: payload.ciphertext,
        // TODO: Decrypt message
        plaintext: payload.ciphertext,
        replyToId: payload.replyToId,
        createdAt: payload.createdAt,
      });
    });

    // Handle typing indicators
    wsClient.on("typing:update", (msg) => {
      const { channelId, userId, isTyping } = msg.payload as {
        channelId: string;
        userId: string;
        isTyping: boolean;
      };
      setTypingUser(channelId, userId, isTyping);
    });

    return () => {
      wsClient.disconnect();
    };
  }, [user, addMessage, setTypingUser]);

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
