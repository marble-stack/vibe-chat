import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { wsClient } from "../lib/websocket";
import { encryptChannelMessage, ensureChannelKey } from "../lib/channelCrypto";
import { encryptFile } from "../lib/fileCrypto";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { PollCreator } from "./PollCreator";

let messageCounter = 0;

export function MessageInput() {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [plusMenuPos, setPlusMenuPos] = useState<{ x: number; y: number } | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const { activeChannelId, channels, activeCommunityId, members, replyingTo, setReplyingTo, addMessage, updateMessage } =
    useChatStore();
  const user = useAuthStore((state) => state.user);

  const activeChannel =
    activeCommunityId && activeChannelId
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

    // Clear any previous error
    setSendError(null);

    // Check if WebSocket is connected
    if (!wsClient.isConnected()) {
      setSendError("Not connected. Please wait or refresh the page.");
      return;
    }

    // Ensure members are loaded before sending to properly distribute encryption keys
    if (communityMembers.length === 0) {
      logger.warn("Members not loaded yet, cannot encrypt message properly");
      setSendError("Loading... please try again.");
      return;
    }

    // Ensure current user is in the members list for proper key distribution
    const membersWithSelf = communityMembers.some((m) => m.id === user.id)
      ? communityMembers
      : [...communityMembers, { id: user.id, displayName: user.displayName || "Me" }];

    const plaintext = message.trim();
    const replyToId = replyingTo?.id;
    const clientId = `optimistic-${Date.now()}-${++messageCounter}`;
    setMessage("");
    setReplyingTo(null);
    setIsSending(true);

    // Insert optimistic message immediately (appears instantly for the sender)
    addMessage({
      id: clientId, // temporary id, replaced when server confirms
      clientId,
      channelId: activeChannelId,
      senderId: user.id,
      ciphertext: "",
      plaintext,
      replyToId,
      createdAt: new Date().toISOString(),
      pending: true,
    });

    try {
      // Encrypt message with channel key
      const ciphertext = await encryptChannelMessage(
        activeChannelId,
        plaintext,
        membersWithSelf,
        user.id
      );

      const sent = wsClient.sendMessage(activeChannelId, ciphertext, replyToId, clientId);
      if (!sent) {
        setSendError("Message queued - connection issue. Will send when reconnected.");
      }
    } catch (err) {
      logger.error("Failed to encrypt message:", err);
      // Mark the optimistic message as failed
      updateMessage(activeChannelId, clientId, { sendFailed: true, pending: false });
      setSendError("Encryption failed. Please try again or refresh the page.");
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChannelId || !user || isSending) return;

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (file.size > 25 * 1024 * 1024) {
      setSendError("File too large. Maximum size is 25MB.");
      return;
    }

    setSendError(null);
    setIsSending(true);

    const membersWithSelf = communityMembers.some((m) => m.id === user.id)
      ? communityMembers
      : [...communityMembers, { id: user.id, displayName: user.displayName || "Me" }];

    try {
      // Get channel key for encryption
      const { key: channelKey } = await ensureChannelKey(
        activeChannelId,
        membersWithSelf,
        user.id
      );

      // Encrypt file
      const { encryptedBlob, iv } = await encryptFile(file, channelKey);

      // Upload encrypted file
      const { fileId } = await api.files.upload(encryptedBlob, activeChannelId, iv);

      // Send message with file metadata
      const fileMetadata = JSON.stringify({
        type: "file",
        filename: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        fileId,
      });

      const ciphertext = await encryptChannelMessage(
        activeChannelId,
        fileMetadata,
        membersWithSelf,
        user.id
      );

      wsClient.sendMessage(activeChannelId, ciphertext);
    } catch (err) {
      logger.error("Failed to upload file:", err);
      setSendError("Failed to upload file. Please try again.");
    } finally {
      setIsSending(false);
    }
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

  // Clear error after a few seconds
  useEffect(() => {
    if (sendError) {
      const timer = setTimeout(() => setSendError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [sendError]);

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-6">
      {/* Error message */}
      {sendError && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-400 text-sm px-4 py-2 rounded-lg mb-2">
          {sendError}
        </div>
      )}

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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      <div
        className={`bg-background-tertiary flex items-center px-4 ${replyingTo ? "rounded-b-lg" : "rounded-lg"}`}
      >
        <button
          ref={plusBtnRef}
          type="button"
          onClick={() => {
            if (!showPlusMenu && plusBtnRef.current) {
              const rect = plusBtnRef.current.getBoundingClientRect();
              setPlusMenuPos({ x: rect.left, y: rect.top });
            }
            setShowPlusMenu(!showPlusMenu);
          }}
          className="text-text-muted hover:text-text-primary p-2"
          title="More options"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {showPlusMenu && plusMenuPos && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
            <div
              className="fixed z-50 bg-background-secondary border border-background-tertiary rounded-lg shadow-lg py-1 min-w-[160px]"
              style={{ left: plusMenuPos.x, bottom: window.innerHeight - plusMenuPos.y + 8 }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowPlusMenu(false);
                  fileInputRef.current?.click();
                }}
                className="w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-background-tertiary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Upload File
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPlusMenu(false);
                  setShowPollCreator(true);
                }}
                className="w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-background-tertiary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Create Poll
              </button>
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
        />

        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={handleChange}
          placeholder={`Message #${activeChannel?.name || "channel"}`}
          className="flex-1 bg-transparent text-text-primary py-3 px-2 outline-none"
        />

        <button type="button" className="text-text-muted hover:text-text-primary p-2" title="Emoji">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>

        <button
          type="submit"
          disabled={!message.trim() || isSending || communityMembers.length === 0}
          className="text-text-muted hover:text-accent-primary p-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={communityMembers.length === 0 ? "Loading..." : "Send message"}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>

      {showPollCreator && activeChannelId && (
        <PollCreator
          channelId={activeChannelId}
          onClose={() => setShowPollCreator(false)}
        />
      )}
    </form>
  );
}
