import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { decryptChannelMessage } from "../lib/channelCrypto";
import { wsClient } from "../lib/websocket";

interface MessageListProps {
  onOpenSidebar: () => void;
}

export function MessageList({ onOpenSidebar }: MessageListProps) {
  const {
    messages,
    members,
    channels,
    activeChannelId,
    activeCommunityId,
    typingUsers,
    setMessages,
    setActiveChannel,
  } = useChatStore();
  const user = useAuthStore((state) => state.user);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null); // messageId of message showing picker

  const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

  const channelMessages = activeChannelId ? messages[activeChannelId] || [] : [];
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];
  const channelTypingUsers = activeChannelId ? typingUsers[activeChannelId] || [] : [];
  const activeChannel = activeCommunityId && activeChannelId
    ? channels[activeCommunityId]?.find((c) => c.id === activeChannelId)
    : null;

  // Load and decrypt messages when channel changes
  useEffect(() => {
    if (!activeChannelId || !user) return;

    const loadMessages = async () => {
      const { messages: msgs } = await api.messages.list(activeChannelId);

      // Decrypt each message
      const decrypted = await Promise.all(
        msgs.map(async (m) => {
          let plaintext = m.ciphertext;
          try {
            plaintext = await decryptChannelMessage(
              activeChannelId,
              m.ciphertext,
              communityMembers,
              user.id
            );
          } catch (err) {
            console.error('Failed to decrypt message:', err);
          }
          return { ...m, plaintext };
        })
      );

      setMessages(activeChannelId, decrypted);
    };

    loadMessages();
  }, [activeChannelId, user, setMessages, communityMembers]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages]);

  const getMember = (userId: string) => {
    return communityMembers.find((m) => m.id === userId);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const typingNames = channelTypingUsers
    .map((id) => getMember(id)?.displayName)
    .filter(Boolean);

  const handleBack = () => {
    setActiveChannel(null);
  };

  const handleReactionClick = (messageId: string, emoji: string, userReactionId?: string) => {
    if (!user || !activeChannelId) return;

    if (userReactionId) {
      // Remove reaction
      wsClient.removeReaction(userReactionId, activeChannelId, messageId, emoji);
    } else {
      // Add reaction
      wsClient.addReaction(messageId, activeChannelId, emoji);
    }
    setShowEmojiPicker(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center border-b border-background-tertiary shadow-sm">
        {/* Back button - only on mobile */}
        <button
          onClick={handleBack}
          className="text-text-muted hover:text-text-primary md:hidden mr-3"
          title="Back to channels"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Hamburger menu button - only on mobile */}
        <button
          onClick={onOpenSidebar}
          className="text-text-muted hover:text-text-primary md:hidden mr-3"
          title="Open sidebar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <span className="text-text-muted text-lg mr-2">#</span>
        <span className="font-semibold text-text-primary">
          {activeChannel?.name}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {channelMessages.length === 0 ? (
          <div className="text-center text-text-muted py-8">
            <div className="text-4xl mb-4">#</div>
            <h3 className="text-xl font-bold text-text-primary mb-2">
              Welcome to #{activeChannel?.name}!
            </h3>
            <p>This is the start of the channel.</p>
          </div>
        ) : (
          channelMessages.map((message, index) => {
            const sender = getMember(message.senderId);
            const prevMessage = channelMessages[index - 1];
            const showHeader =
              !prevMessage ||
              prevMessage.senderId !== message.senderId ||
              new Date(message.createdAt).getTime() -
                new Date(prevMessage.createdAt).getTime() >
                5 * 60 * 1000;

            return (
              <div
                key={message.id}
                className={`flex gap-4 hover:bg-background-primary/30 px-2 py-0.5 rounded ${
                  showHeader ? "mt-4" : ""
                }`}
              >
                {showHeader ? (
                  <div className="w-10 h-10 rounded-full bg-accent-primary flex-shrink-0 flex items-center justify-center text-white font-medium">
                    {sender?.displayName?.charAt(0).toUpperCase() || "?"}
                  </div>
                ) : (
                  <div className="w-10 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {showHeader && (
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-text-primary hover:underline cursor-pointer">
                        {sender?.displayName || "Unknown"}
                      </span>
                      <span className="text-xs text-text-muted">
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  )}
                  <p className="text-text-primary break-words">
                    {message.plaintext || message.ciphertext}
                  </p>

                  {/* Reactions */}
                  <div className="flex flex-wrap gap-1 mt-1 relative">
                    {message.reactions?.map((reaction) => {
                      const userReacted = user && reaction.userIds.includes(user.id);
                      const userReactionId = user ? reaction.reactionIds[user.id] : undefined;

                      return (
                        <button
                          key={reaction.emoji}
                          onClick={() => handleReactionClick(message.id, reaction.emoji, userReactionId)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors ${
                            userReacted
                              ? "bg-accent-primary/20 border border-accent-primary text-accent-primary"
                              : "bg-background-tertiary border border-background-tertiary text-text-primary hover:border-text-muted"
                          }`}
                          title={reaction.userIds.map(id => getMember(id)?.displayName || "Unknown").join(", ")}
                        >
                          <span>{reaction.emoji}</span>
                          <span className="text-xs">{reaction.count}</span>
                        </button>
                      );
                    })}

                    {/* Add reaction button */}
                    <div className="relative">
                      <button
                        onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-background-tertiary hover:bg-background-modifier-hover text-text-muted hover:text-text-primary transition-colors"
                        title="Add reaction"
                      >
                        <span className="text-sm">+</span>
                      </button>

                      {/* Emoji picker */}
                      {showEmojiPicker === message.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowEmojiPicker(null)}
                          />
                          <div className="absolute left-0 top-full mt-1 z-20 bg-background-secondary border border-background-tertiary rounded-lg shadow-lg p-2 flex gap-1">
                            {EMOJI_OPTIONS.map((emoji) => {
                              const existingReaction = message.reactions?.find(r => r.emoji === emoji);
                              const userReactionId = user && existingReaction ? existingReaction.reactionIds[user.id] : undefined;

                              return (
                                <button
                                  key={emoji}
                                  onClick={() => handleReactionClick(message.id, emoji, userReactionId)}
                                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-background-modifier-hover transition-colors text-lg"
                                  title={emoji}
                                >
                                  {emoji}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {typingNames.length > 0 && (
          <div className="text-text-muted text-sm px-2 py-2">
            <span className="inline-flex gap-1 mr-2">
              <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
