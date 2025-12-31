import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { decryptChannelMessage } from "../lib/channelCrypto";

export function MessageList() {
  const {
    messages,
    members,
    channels,
    activeChannelId,
    activeCommunityId,
    typingUsers,
    setMessages,
  } = useChatStore();
  const user = useAuthStore((state) => state.user);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center border-b border-background-tertiary shadow-sm">
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
