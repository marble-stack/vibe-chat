import { useEffect, useState, useRef } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { wsClient } from "../lib/websocket";
import { decryptChannelMessage, encryptChannelMessage, isDecryptionError } from "../lib/channelCrypto";
import { logger } from "../lib/logger";
import { DecryptionErrorMessage } from "./DecryptionErrorMessage";
import { FileMessage } from "./FileMessage";
import { PollMessage } from "./PollMessage";
import { MentionText } from "./MentionText";

interface ThreadMessage {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  plaintext?: string;
  decryptionFailed?: boolean;
  replyToId?: string | null;
  createdAt: string;
}

export function ThreadPanel() {
  const { activeThreadId, activeChannelId, activeCommunityId, members, messages, setActiveThread } =
    useChatStore();
  const user = useAuthStore((state) => state.user);

  const [replies, setReplies] = useState<ThreadMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];

  // Get root message
  const rootMessage = activeChannelId && activeThreadId
    ? messages[activeChannelId]?.find((m) => m.id === activeThreadId)
    : null;

  // Load replies when thread opens
  useEffect(() => {
    if (!activeThreadId || !user) return;

    const loadReplies = async () => {
      try {
        const { replies: rawReplies } = await api.messages.getReplies(activeThreadId);

        const membersForDecryption = communityMembers.some((m) => m.id === user.id)
          ? communityMembers
          : [...communityMembers, { id: user.id, displayName: user.displayName || "Me" }];

        const decrypted = await Promise.all(
          rawReplies.map(async (m) => {
            let plaintext: string | undefined;
            let decryptionFailed = false;
            try {
              plaintext = await decryptChannelMessage(
                m.channelId,
                m.ciphertext,
                membersForDecryption,
                user.id,
                m.senderId
              );
              if (isDecryptionError(plaintext)) {
                decryptionFailed = true;
              }
            } catch {
              decryptionFailed = true;
            }
            return { ...m, plaintext, decryptionFailed };
          })
        );

        setReplies(decrypted);
      } catch (err) {
        logger.error("Failed to load thread replies:", err);
      }
    };

    loadReplies();
  }, [activeThreadId, user, communityMembers]);

  // Listen for new messages that are replies to this thread
  useEffect(() => {
    if (!activeThreadId || !activeChannelId) return;

    const channelMessages = messages[activeChannelId] || [];
    const threadReplies = channelMessages.filter((m) => m.replyToId === activeThreadId);

    // Merge with any existing replies we don't have yet
    setReplies((prev) => {
      const existingIds = new Set(prev.map((r) => r.id));
      const newReplies = threadReplies.filter((r) => !existingIds.has(r.id));
      if (newReplies.length === 0) return prev;
      return [...prev, ...newReplies].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, [activeThreadId, activeChannelId, messages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies]);

  const getMember = (userId: string) => communityMembers.find((m) => m.id === userId);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !activeChannelId || !activeThreadId || !user || isSending) return;

    const membersWithSelf = communityMembers.some((m) => m.id === user.id)
      ? communityMembers
      : [...communityMembers, { id: user.id, displayName: user.displayName || "Me" }];

    const plaintext = replyText.trim();
    setReplyText("");
    setIsSending(true);

    try {
      const ciphertext = await encryptChannelMessage(
        activeChannelId,
        plaintext,
        membersWithSelf,
        user.id
      );
      wsClient.sendMessage(activeChannelId, ciphertext, activeThreadId, undefined, true);
    } catch (err) {
      logger.error("Failed to send thread reply:", err);
      setReplyText(plaintext);
    } finally {
      setIsSending(false);
    }
  };

  if (!activeThreadId || !rootMessage) return null;

  const rootSender = getMember(rootMessage.senderId);

  return (
    <div className="w-96 border-l border-background-tertiary flex flex-col bg-background-secondary">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-background-tertiary">
        <h3 className="font-semibold text-text-primary">Thread</h3>
        <button
          onClick={() => setActiveThread(null)}
          className="text-text-muted hover:text-text-primary p-1"
          title="Close thread"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Root message */}
      <div className="px-4 py-3 border-b border-background-tertiary">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-accent-primary flex-shrink-0 flex items-center justify-center text-white text-sm font-medium">
            {rootSender?.displayName?.charAt(0).toUpperCase() || "?"}
          </div>
          <span className="font-medium text-text-primary text-sm">
            {rootSender?.displayName || "Unknown"}
          </span>
          <span className="text-xs text-text-muted">{formatTime(rootMessage.createdAt)}</span>
        </div>
        {rootMessage.decryptionFailed ? (
          <DecryptionErrorMessage errorType={rootMessage.plaintext} />
        ) : (() => {
          const plaintext = rootMessage.plaintext || rootMessage.ciphertext;
          try {
            const parsed = JSON.parse(plaintext);
            if (parsed.type === "file") {
              return <div className="ml-10"><FileMessage metadata={parsed} channelId={rootMessage.channelId} /></div>;
            }
            if (parsed.type === "poll") {
              return <div className="ml-10"><PollMessage metadata={parsed} messageId={rootMessage.id} /></div>;
            }
          } catch {
            // Not JSON, render as text
          }
          return (
            <p className="text-text-primary text-sm break-words ml-10">
              <MentionText text={plaintext} currentUserId={user?.id} />
            </p>
          );
        })()}
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {replies.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-4">No replies yet</p>
        ) : (
          <>
            <div className="text-xs text-text-muted py-2">
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </div>
            {replies.map((reply) => {
              const sender = getMember(reply.senderId);
              return (
                <div key={reply.id} className="flex gap-2 py-1.5">
                  <div className="w-7 h-7 rounded-full bg-accent-primary flex-shrink-0 flex items-center justify-center text-white text-xs font-medium">
                    {sender?.displayName?.charAt(0).toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium text-text-primary text-sm">
                        {sender?.displayName || "Unknown"}
                      </span>
                      <span className="text-xs text-text-muted">{formatTime(reply.createdAt)}</span>
                    </div>
                    {reply.decryptionFailed ? (
                      <DecryptionErrorMessage errorType={reply.plaintext} />
                    ) : (
                      <p className="text-text-primary text-sm break-words">
                        <MentionText text={reply.plaintext || reply.ciphertext} currentUserId={user?.id} />
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply input */}
      <form onSubmit={handleSendReply} className="px-3 pb-3">
        <div className="bg-background-tertiary flex items-center px-3 rounded-lg">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply..."
            className="flex-1 bg-transparent text-text-primary py-2 px-1 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={!replyText.trim() || isSending}
            className="text-text-muted hover:text-accent-primary p-1.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
