import { useEffect, useRef, useCallback, useState, memo } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { decryptChannelMessage, encryptChannelMessage, isDecryptionError } from "../lib/channelCrypto";
import { wsClient } from "../lib/websocket";
import { logger } from "../lib/logger";
import { DecryptionErrorMessage } from "./DecryptionErrorMessage";
import { FileMessage } from "./FileMessage";
import { PollMessage } from "./PollMessage";
import { ProfileCard } from "./ProfileCard";
import { CustomEmojiText, EmojiDisplay } from "./CustomEmojiText";

interface Member {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

interface Message {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  plaintext?: string;
  replyToId?: string | null;
  isThreadReply?: boolean;
  editedAt?: string | null;
  createdAt: string;
  reactions?: { emoji: string; count: number; userIds: string[]; reactionIds: Record<string, string> }[];
  decryptionFailed?: boolean;
  clientId?: string;
  pending?: boolean;
  sendFailed?: boolean;
}

const EMOJI_OPTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F389}"];

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

const formatDateSeparator = (date: Date) => {
  const now = new Date();
  if (isSameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

function ReactionPickerDropdown({
  message,
  userId,
  onReactionClick,
}: {
  message: Message;
  userId: string | undefined;
  onReactionClick: (messageId: string, emoji: string, userReactionId?: string) => void;
}) {
  const { activeCommunityId, customEmojis } = useChatStore();
  const communityEmojis = activeCommunityId ? customEmojis[activeCommunityId] || [] : [];

  return (
    <div className="absolute right-0 top-full mt-1 z-20 bg-background-secondary border border-background-tertiary rounded-lg shadow-lg p-2">
      <div className="flex gap-1">
        {EMOJI_OPTIONS.map((emoji) => {
          const existingReaction = message.reactions?.find((r) => r.emoji === emoji);
          const emojiUserReactionId =
            userId && existingReaction ? existingReaction.reactionIds[userId] : undefined;
          return (
            <button
              key={emoji}
              onClick={() => onReactionClick(message.id, emoji, emojiUserReactionId)}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-background-primary/50 transition-colors text-lg"
              title={emoji}
            >
              {emoji}
            </button>
          );
        })}
      </div>
      {communityEmojis.length > 0 && (
        <div className="flex gap-1 mt-1 pt-1 border-t border-background-tertiary flex-wrap max-w-[240px]">
          {communityEmojis.map((ce) => {
            const emojiStr = `:${ce.name}:`;
            const existingReaction = message.reactions?.find((r) => r.emoji === emojiStr);
            const emojiUserReactionId =
              userId && existingReaction ? existingReaction.reactionIds[userId] : undefined;
            return (
              <button
                key={ce.id}
                onClick={() => onReactionClick(message.id, emojiStr, emojiUserReactionId)}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-background-primary/50 transition-colors"
                title={emojiStr}
              >
                <img src={ce.fileUrl} alt={ce.name} className="w-5 h-5 object-contain" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  sender: Member | undefined;
  showHeader: boolean;
  replyMessage: Message | null | undefined;
  replySender: Member | null | undefined;
  isEditing: boolean;
  isEmojiPickerOpen: boolean;
  editText: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  userId: string | undefined;
  isOwnMessage: boolean;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onScrollToMessage: (id: string) => void;
  onSetEditText: (text: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onCancelEditing: () => void;
  onSaveEdit: () => void;
  onStartEditing: (message: { id: string; plaintext?: string; ciphertext: string }) => void;
  onDelete: (id: string) => void;
  onReactionClick: (messageId: string, emoji: string, userReactionId?: string) => void;
  onToggleEmojiPicker: (id: string | null) => void;
  onCloseEmojiPicker: () => void;
  onOpenThread: (messageId: string) => void;
  onReply: (message: Message) => void;
  onUsernameClick: (userId: string, e: React.MouseEvent) => void;
  getMember: (userId: string) => Member | undefined;
  replyCount: number;
  channelMessages: Message[];
}

const MessageItem = memo(function MessageItem({
  message,
  sender,
  showHeader,
  replyMessage,
  replySender,
  isEditing,
  isEmojiPickerOpen,
  editText,
  editInputRef,
  userId,
  isOwnMessage,
  messageRefs,
  onScrollToMessage,
  onSetEditText,
  onEditKeyDown,
  onCancelEditing,
  onSaveEdit,
  onStartEditing,
  onDelete,
  onReactionClick,
  onToggleEmojiPicker,
  onCloseEmojiPicker,
  onOpenThread,
  onReply,
  onUsernameClick,
  getMember,
  replyCount,
}: MessageItemProps) {
  return (
    <div
      ref={(el) => {
        if (el) messageRefs.current.set(message.id, el);
        else messageRefs.current.delete(message.id);
      }}
      className={`group relative flex gap-4 hover:bg-background-primary/30 px-2 py-0.5 rounded transition-colors ${
        showHeader ? "mt-4" : ""
      } ${message.pending ? "opacity-60" : ""} ${message.sendFailed ? "opacity-80" : ""}`}
    >
      {/* Discord-style floating toolbar - top right on hover */}
      {!isEditing && (
        <div className="absolute -top-3 right-2 hidden group-hover:flex items-center bg-background-tertiary border border-background-secondary rounded shadow-lg z-10">
          {/* Add reaction */}
          <div className="relative">
            <button
              onClick={() =>
                onToggleEmojiPicker(isEmojiPickerOpen ? null : message.id)
              }
              className="p-1.5 hover:bg-background-primary/50 text-text-muted hover:text-text-primary transition-colors rounded-l"
              title="Add Reaction"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Emoji picker dropdown */}
            {isEmojiPickerOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={onCloseEmojiPicker}
                />
                <ReactionPickerDropdown
                  message={message}
                  userId={userId}
                  onReactionClick={onReactionClick}
                />
              </>
            )}
          </div>

          {/* Inline Reply */}
          <button
            onClick={() => onReply(message)}
            className="p-1.5 hover:bg-background-primary/50 text-text-muted hover:text-text-primary transition-colors"
            title="Reply"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10l7-7v4c8 0 11 4 11 11-2-4-5-6-11-6v4l-7-7z" />
            </svg>
          </button>

          {/* Reply in Thread */}
          <button
            onClick={() => onOpenThread(message.id)}
            className="p-1.5 hover:bg-background-primary/50 text-text-muted hover:text-text-primary transition-colors"
            title="Reply in Thread"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </button>

          {/* Edit and delete - only for own messages */}
          {isOwnMessage && (
            <>
              <button
                onClick={() => onStartEditing(message)}
                className="p-1.5 hover:bg-background-primary/50 text-text-muted hover:text-text-primary transition-colors"
                title="Edit"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => onDelete(message.id)}
                className="p-1.5 hover:bg-background-primary/50 text-text-muted hover:text-red-400 transition-colors rounded-r"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {showHeader ? (
        <div className="w-10 h-10 rounded-full bg-accent-primary flex-shrink-0 flex items-center justify-center text-white font-medium">
          {sender?.displayName?.charAt(0).toUpperCase() || "?"}
        </div>
      ) : (
        <div className="w-10 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {/* Reply context */}
        {replyMessage && (
          <div className="mb-1 flex w-fit items-center gap-1.5 rounded-md bg-background-tertiary/70 px-2 py-1 text-xs text-text-muted">
            <button
              onClick={() => onScrollToMessage(replyMessage.id)}
              className="group flex min-w-0 items-center gap-2 text-left text-text-muted transition-colors hover:text-text-primary"
              title="Jump to referenced message"
            >
              <svg className="h-5 w-5 flex-shrink-0 text-text-muted/80 group-hover:text-accent-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path
                  strokeLinecap="round"
                  d="M20 5c-4 0-4 4-8 4s-4 4-8 4"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l2.5 2.5L8 13" />
              </svg>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="font-medium text-text-primary/90">{replySender?.displayName || "Unknown"}</span>
                <span className="truncate max-w-[220px]">{replyMessage.plaintext || replyMessage.ciphertext}</span>
              </div>
            </button>
            <button
              onClick={() => onOpenThread(message.replyToId!)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/15"
              title="Reply in thread"
            >
              Reply
            </button>
          </div>
        )}

        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span
              className="font-medium text-text-primary hover:underline cursor-pointer"
              onClick={(e) => onUsernameClick(message.senderId, e)}
            >
              {sender?.displayName || "Unknown"}
            </span>
            <span className="text-xs text-text-muted">
              {formatTime(message.createdAt)}
            </span>
          </div>
        )}

        {/* Message content or edit input */}
        {isEditing ? (
          <div className="flex gap-2">
            <input
              ref={editInputRef}
              type="text"
              value={editText}
              onChange={(e) => onSetEditText(e.target.value)}
              onKeyDown={onEditKeyDown}
              className="flex-1 bg-background-tertiary text-text-primary px-3 py-1 rounded outline-none border border-accent-primary"
            />
            <button
              onClick={onCancelEditing}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              className="text-xs text-accent-primary hover:text-accent-primary/80"
            >
              Save
            </button>
          </div>
        ) : message.sendFailed ? (
          <div>
            <p className="text-text-primary break-words whitespace-pre-wrap">
              {message.plaintext || message.ciphertext}
            </p>
            <span className="text-xs text-red-400">Failed to send</span>
          </div>
        ) : message.decryptionFailed ? (
          <DecryptionErrorMessage errorType={message.plaintext} />
        ) : (() => {
          // Try to parse as structured content (file, poll)
          const plaintext = message.plaintext || message.ciphertext;
          try {
            const parsed = JSON.parse(plaintext);
            if (parsed.type === "file") {
              return <FileMessage metadata={parsed} channelId={message.channelId} />;
            }
            if (parsed.type === "poll") {
              return <PollMessage metadata={parsed} messageId={message.id} />;
            }
          } catch {
            // Not JSON, render as text
          }
          return (
            <p className="text-text-primary break-words whitespace-pre-wrap">
              <CustomEmojiText text={plaintext} currentUserId={userId} />
              {message.editedAt && (
                <span className="text-xs text-text-muted ml-1">(edited)</span>
              )}
            </p>
          );
        })()}

        {/* Thread reply count indicator */}
        {replyCount > 0 && (
          <button
            onClick={() => onOpenThread(message.id)}
            className="flex items-center gap-1 text-xs text-accent-primary hover:underline mt-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {/* Existing reactions display */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {message.reactions.map((reaction) => {
              const userReacted = userId && reaction.userIds.includes(userId);
              const userReactionId = userId ? reaction.reactionIds[userId] : undefined;

              return (
                <button
                  key={reaction.emoji}
                  onClick={() =>
                    onReactionClick(message.id, reaction.emoji, userReactionId)
                  }
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors ${
                    userReacted
                      ? "bg-accent-primary/20 border border-accent-primary text-accent-primary"
                      : "bg-background-tertiary border border-background-tertiary text-text-primary hover:border-text-muted"
                  }`}
                  title={reaction.userIds
                    .map((id) => getMember(id)?.displayName || "Unknown")
                    .join(", ")}
                >
                  <EmojiDisplay emoji={reaction.emoji} />
                  <span className="text-xs">{reaction.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

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
    getMessageById,
    setActiveChannel,
    setActiveThread,
    setReplyingTo,
    onlineUsers,
    setSearchOpen,
    scrollToMessageId,
    setScrollToMessage,
  } = useChatStore();
  const user = useAuthStore((state) => state.user);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevMessageCountRef = useRef(0);

  // Edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // Reaction emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

  // Profile card state
  const [profileCard, setProfileCard] = useState<{
    userId: string;
    position: { x: number; y: number };
  } | null>(null);

  const allChannelMessages = activeChannelId ? messages[activeChannelId] || [] : [];
  // Filter out thread replies from main view — inline replies (isThreadReply=false) stay visible
  const channelMessages = allChannelMessages.filter((m) => !m.isThreadReply);
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];
  const channelTypingUsers = activeChannelId ? typingUsers[activeChannelId] || [] : [];
  const activeChannel =
    activeCommunityId && activeChannelId
      ? channels[activeCommunityId]?.find((c) => c.id === activeChannelId)
      : null;

  // Use a ref for communityMembers so loadMessages doesn't re-run when members change
  const communityMembersRef = useRef(communityMembers);
  useEffect(() => {
    communityMembersRef.current = communityMembers;
  }, [communityMembers]);

  // Load and decrypt messages when channel changes
  useEffect(() => {
    if (!activeChannelId || !user) return;

    // Reset counter so initial load scrolls to bottom
    prevMessageCountRef.current = 0;

    const loadMessages = async () => {
      const { messages: msgs } = await api.messages.list(activeChannelId);

      // Use ref to get latest members without triggering effect re-runs
      const currentMembers = communityMembersRef.current;

      // Ensure current user is in members list for key distribution/retrieval
      const membersForDecryption = currentMembers.some((m) => m.id === user.id)
        ? currentMembers
        : [...currentMembers, { id: user.id, displayName: user.displayName || "Me" }];

      // Decrypt each message
      const decrypted = await Promise.all(
        msgs.map(async (m) => {
          let plaintext: string | undefined;
          let decryptionFailed = false;
          try {
            plaintext = await decryptChannelMessage(
              activeChannelId,
              m.ciphertext,
              membersForDecryption,
              user.id,
              m.senderId
            );
            if (isDecryptionError(plaintext)) {
              decryptionFailed = true;
            }
          } catch (err) {
            logger.error("Failed to decrypt message:", err);
            decryptionFailed = true;
          }
          return { ...m, plaintext, decryptionFailed };
        })
      );

      setMessages(activeChannelId, decrypted);
    };

    loadMessages();
  }, [activeChannelId, user, setMessages]);

  // Smart auto-scroll: scroll to bottom on initial load, or when a new message
  // arrives and the user is already near the bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const newCount = channelMessages.length;
    const prevCount = prevMessageCountRef.current;
    const wasNewMessage = newCount > prevCount;
    prevMessageCountRef.current = newCount;

    if (!wasNewMessage) return;

    // Initial load (channel just opened) — jump to bottom instantly
    if (prevCount === 0) {
      // Use rAF to ensure DOM has laid out the new messages
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
      return;
    }

    // Subsequent messages — only auto-scroll if user is within 100px of the bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 100) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [channelMessages]);

  const getMember = useCallback(
    (userId: string) => communityMembers.find((m) => m.id === userId),
    [communityMembers]
  );

  // Get the original message being replied to
  const getReplyMessage = useCallback(
    (replyToId: string | null | undefined) => {
      if (!replyToId || !activeChannelId) return null;
      return getMessageById(activeChannelId, replyToId);
    },
    [activeChannelId, getMessageById]
  );

  // Scroll to a specific message
  const scrollToMessage = useCallback((messageId: string) => {
    const element = messageRefs.current.get(messageId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash highlight effect
      element.classList.add("bg-accent-primary/20");
      setTimeout(() => {
        element.classList.remove("bg-accent-primary/20");
      }, 1500);
    }
  }, []);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingMessageId) {
      editInputRef.current?.focus();
    }
  }, [editingMessageId]);

  // Start editing a message
  const startEditing = useCallback(
    (message: { id: string; plaintext?: string; ciphertext: string }) => {
      setEditingMessageId(message.id);
      setEditText(message.plaintext || message.ciphertext);
    },
    []
  );

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingMessageId(null);
    setEditText("");
  }, []);

  // Save edited message
  const saveEdit = useCallback(async () => {
    if (!editingMessageId || !editText.trim() || !activeChannelId || !user) return;

    try {
      // Encrypt the new message content
      const ciphertext = await encryptChannelMessage(
        activeChannelId,
        editText.trim(),
        communityMembers,
        user.id
      );

      wsClient.editMessage(activeChannelId, editingMessageId, ciphertext);
    } catch (err) {
      logger.error("Failed to encrypt edited message:", err);
      // Fallback to plaintext
      wsClient.editMessage(activeChannelId, editingMessageId, editText.trim());
    }

    cancelEditing();
  }, [editingMessageId, editText, activeChannelId, user, communityMembers, cancelEditing]);

  // Handle edit key press (Enter to save, Escape to cancel)
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
      } else if (e.key === "Escape") {
        cancelEditing();
      }
    },
    [saveEdit, cancelEditing]
  );

  // Delete a message
  const confirmDelete = useCallback(() => {
    if (!deletingMessageId || !activeChannelId) return;
    wsClient.deleteMessage(activeChannelId, deletingMessageId);
    setDeletingMessageId(null);
  }, [deletingMessageId, activeChannelId]);

  const typingNames = channelTypingUsers.map((id) => getMember(id)?.displayName).filter(Boolean);

  const handleBack = () => {
    setActiveChannel(null);
  };

  // Handle scroll-to-message from search
  useEffect(() => {
    if (scrollToMessageId) {
      scrollToMessage(scrollToMessageId);
      setScrollToMessage(null);
    }
  }, [scrollToMessageId, scrollToMessage, setScrollToMessage]);

  const handleReactionClick = useCallback(
    (messageId: string, emoji: string, userReactionId?: string) => {
      if (!user || !activeChannelId) return;

      if (userReactionId) {
        wsClient.removeReaction(userReactionId, activeChannelId, messageId, emoji);
      } else {
        wsClient.addReaction(messageId, activeChannelId, emoji);
      }
      setShowEmojiPicker(null);
    },
    [user, activeChannelId]
  );

  const handleReply = useCallback(
    (message: Message) => {
      setReplyingTo(message);
    },
    [setReplyingTo]
  );

  const onlineUserIds = activeCommunityId ? onlineUsers[activeCommunityId] || [] : [];

  const handleUsernameClick = useCallback(
    (userId: string, e: React.MouseEvent) => {
      setProfileCard({
        userId,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    []
  );

  const profileMember = profileCard ? getMember(profileCard.userId) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Profile card popover */}
      {profileCard && profileMember && (
        <ProfileCard
          displayName={profileMember.displayName}
          avatarUrl={profileMember.avatarUrl}
          isOnline={onlineUserIds.includes(profileCard.userId)}
          position={profileCard.position}
          onClose={() => setProfileCard(null)}
        />
      )}

      {/* Channel header */}
      <div className="h-12 px-4 flex items-center border-b border-background-tertiary shadow-sm">
        {/* Back button - only on mobile */}
        <button
          onClick={handleBack}
          className="text-text-muted hover:text-text-primary md:hidden mr-3"
          title="Back to channels"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        {/* Hamburger menu button - only on mobile */}
        <button
          onClick={onOpenSidebar}
          className="text-text-muted hover:text-text-primary md:hidden mr-3"
          title="Open sidebar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        <span className="text-text-muted text-lg mr-2">#</span>
        <span className="font-semibold text-text-primary flex-1">{activeChannel?.name}</span>
        <button
          onClick={() => setSearchOpen(true)}
          className="text-text-muted hover:text-text-primary p-1 ml-auto"
          title="Search messages"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
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
            const currentDate = new Date(message.createdAt);
            const prevDate = prevMessage ? new Date(prevMessage.createdAt) : null;
            const showDateSeparator = !prevDate || !isSameDay(currentDate, prevDate);
            const showHeader =
              !prevMessage ||
              prevMessage.senderId !== message.senderId ||
              new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() >
                5 * 60 * 1000 ||
              message.replyToId || // Always show header for replies
              showDateSeparator; // Always show header after date boundary

            // Get the message being replied to
            const replyMessage = getReplyMessage(message.replyToId);
            const replySender = replyMessage ? getMember(replyMessage.senderId) : null;

            const replyCount = allChannelMessages.filter((m) => m.replyToId === message.id).length;

            return (
              <div key={`wrapper-${message.clientId || message.id}`}>
                {showDateSeparator && (
                  <div className="flex items-center gap-4 my-4 px-2">
                    <div className="flex-1 h-px bg-background-tertiary" />
                    <span className="text-xs font-semibold text-text-muted">
                      {formatDateSeparator(currentDate)}
                    </span>
                    <div className="flex-1 h-px bg-background-tertiary" />
                  </div>
                )}
              <MessageItem
                message={message}
                sender={sender}
                showHeader={!!showHeader}
                replyMessage={replyMessage}
                replySender={replySender}
                isEditing={editingMessageId === message.id}
                isEmojiPickerOpen={showEmojiPicker === message.id}
                editText={editText}
                editInputRef={editInputRef}
                userId={user?.id}
                isOwnMessage={!!user && message.senderId === user.id}
                messageRefs={messageRefs}
                onScrollToMessage={scrollToMessage}
                onSetEditText={setEditText}
                onEditKeyDown={handleEditKeyDown}
                onCancelEditing={cancelEditing}
                onSaveEdit={saveEdit}
                onStartEditing={startEditing}
                onDelete={setDeletingMessageId}
                onReactionClick={handleReactionClick}
                onToggleEmojiPicker={setShowEmojiPicker}
                onCloseEmojiPicker={() => setShowEmojiPicker(null)}
                onOpenThread={setActiveThread}
                onReply={handleReply}
                onUsernameClick={handleUsernameClick}
                getMember={getMember}
                replyCount={replyCount}
                channelMessages={channelMessages}
              />
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {typingNames.length > 0 && (
          <div className="text-text-muted text-sm px-2 py-2">
            <span className="inline-flex gap-1 mr-2">
              <span
                className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Delete confirmation modal */}
      {deletingMessageId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background-secondary rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Delete Message</h3>
            <p className="text-text-muted mb-6">
              Are you sure you want to delete this message? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingMessageId(null)}
                className="px-4 py-2 rounded bg-background-tertiary text-text-primary hover:bg-background-primary"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded bg-red-500 text-white hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
