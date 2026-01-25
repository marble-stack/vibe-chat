import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { wsClient } from "../lib/websocket";
import { encryptChannelMessage } from "../lib/channelCrypto";

export function MessageInput() {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeChannelId, channels, activeCommunityId, members, replyingTo, setReplyingTo } = useChatStore();
  const user = useAuthStore((state) => state.user);

  const activeChannel = activeCommunityId && activeChannelId
    ? channels[activeCommunityId]?.find((c) => c.id === activeChannelId)
    : null;

  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];

  // Get the display name of the user being replied to
  const getReplyingSenderName = () => {
    if (!replyingTo) return "";
    const sender = communityMembers.find((m) => m.id === replyingTo.senderId);
    return sender?.displayName || "Unknown";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !activeChannelId || !user || isSending) return;

    const plaintext = message.trim();
    const replyToId = replyingTo?.id;
    setMessage("");
    setReplyingTo(null);
    setIsSending(true);

    try {
      // Encrypt message with channel key
      const ciphertext = await encryptChannelMessage(
        activeChannelId,
        plaintext,
        communityMembers,
        user.id
      );

      wsClient.sendMessage(activeChannelId, ciphertext, replyToId);
    } catch (err) {
      console.error('Failed to encrypt message:', err);
      // Fallback to plaintext if encryption fails (for backward compatibility)
      wsClient.sendMessage(activeChannelId, plaintext, replyToId);
    } finally {
      setIsSending(false);
    }

    // Stop typing indicator
    if (isTyping) {
      wsClient.stopTyping(activeChannelId);
      setIsTyping(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);

    if (!activeChannelId) return;

    // Typing indicator logic
    if (!isTyping && e.target.value.length > 0) {
      setIsTyping(true);
      wsClient.startTyping(activeChannelId);
    }

    // Reset typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      if (isTyping && activeChannelId) {
        wsClient.stopTyping(activeChannelId);
        setIsTyping(false);
      }
    }, 3000);
  };

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Clear reply when channel changes
  useEffect(() => {
    setReplyingTo(null);
  }, [activeChannelId, setReplyingTo]);

  // Focus input when replying
  useEffect(() => {
    if (replyingTo) {
      inputRef.current?.focus();
    }
  }, [replyingTo]);

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-6">
      {/* Reply preview bar */}
      {replyingTo && (
        <div className="bg-background-tertiary rounded-t-lg border-b border-background-primary px-4 py-2 flex items-center gap-2">
          <div className="w-1 h-8 bg-accent-primary rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-accent-primary font-medium">
              Replying to {getReplyingSenderName()}
            </div>
            <div className="text-sm text-text-muted truncate">
              {replyingTo.plaintext || replyingTo.ciphertext}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="text-text-muted hover:text-text-primary p-1"
            title="Cancel reply"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className={`bg-background-tertiary flex items-center px-4 ${replyingTo ? 'rounded-b-lg' : 'rounded-lg'}`}>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary p-2"
          title="Attach file"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={handleChange}
          placeholder={`Message #${activeChannel?.name || "channel"}`}
          className="flex-1 bg-transparent text-text-primary py-3 px-2 outline-none"
        />

        <button
          type="button"
          className="text-text-muted hover:text-text-primary p-2"
          title="Emoji"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
    </form>
  );
}
