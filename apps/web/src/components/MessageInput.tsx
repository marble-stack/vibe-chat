import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { wsClient } from "../lib/websocket";

export function MessageInput() {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const { activeChannelId, channels, activeCommunityId } = useChatStore();

  const activeChannel = activeCommunityId && activeChannelId
    ? channels[activeCommunityId]?.find((c) => c.id === activeChannelId)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !activeChannelId) return;

    // TODO: Encrypt message before sending
    const ciphertext = message.trim(); // Placeholder

    wsClient.sendMessage(activeChannelId, ciphertext);
    setMessage("");

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

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-6">
      <div className="bg-background-tertiary rounded-lg flex items-center px-4">
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
