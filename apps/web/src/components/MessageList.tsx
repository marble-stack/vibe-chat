import { useEffect, useRef, useCallback, useState } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { decryptChannelMessage, encryptChannelMessage } from "../lib/channelCrypto";
import { wsClient } from "../lib/websocket";
import { logger } from "../lib/logger";
import { DecryptionErrorMessage } from "./DecryptionErrorMessage";

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
    setReplyingTo,
    getMessageById,
    setActiveChannel,
  } = useChatStore();
  const user = useAuthStore((state) => state.user);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // Reaction emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
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

      // Ensure current user is in members list for key distribution/retrieval
      const membersForDecryption = communityMembers.some(m => m.id === user.id)
        ? communityMembers
        : [...communityMembers, { id: user.id, displayName: user.displayName || 'Me' }];

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
          } catch (err) {
            logger.error('Failed to decrypt message:', err);
            decryptionFailed = true;
          }
          return { ...m, plaintext, decryptionFailed };
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

  // Get the original message being replied to
  const getReplyMessage = useCallback((replyToId: string | undefined) => {
    if (!replyToId || !activeChannelId) return null;
    return getMessageById(activeChannelId, replyToId);
  }, [activeChannelId, getMessageById]);

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
  const startEditing = useCallback((message: { id: string; plaintext?: string; ciphertext: string }) => {
    setEditingMessageId(message.id);
    setEditText(message.plaintext || message.ciphertext);
  }, []);

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
      logger.error('Failed to encrypt edited message:', err);
      // Fallback to plaintext
      wsClient.editMessage(activeChannelId, editingMessageId, editText.trim());
    }

    cancelEditing();
  }, [editingMessageId, editText, activeChannelId, user, communityMembers, cancelEditing]);

  // Handle edit key press (Enter to save, Escape to cancel)
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  }, [saveEdit, cancelEditing]);

  // Delete a message
  const confirmDelete = useCallback(() => {
    if (!deletingMessageId || !activeChannelId) return;
    wsClient.deleteMessage(activeChannelId, deletingMessageId);
    setDeletingMessageId(null);
  }, [deletingMessageId, activeChannelId]);

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
                5 * 60 * 1000 ||
              message.replyToId; // Always show header for replies

            // Get the message being replied to
            const replyMessage = getReplyMessage(message.replyToId);
            const replySender = replyMessage ? getMember(replyMessage.senderId) : null;

            return (
              <div
                key={message.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(message.id, el);
                  else messageRefs.current.delete(message.id);
                }}
                className={`group flex gap-4 hover:bg-background-primary/30 px-2 py-0.5 rounded transition-colors ${
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
                  {/* Reply context */}
                  {replyMessage && (
                    <button
                      onClick={() => scrollToMessage(replyMessage.id)}
                      className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-1 cursor-pointer"
                    >
                      <svg className="w-3 h-3 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      <span className="font-medium">{replySender?.displayName || "Unknown"}</span>
                      <span className="truncate max-w-[200px]">
                        {replyMessage.plaintext || replyMessage.ciphertext}
                      </span>
                    </button>
                  )}

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

                  {/* Message content or edit input */}
                  {editingMessageId === message.id ? (
                    <div className="flex gap-2">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        className="flex-1 bg-background-tertiary text-text-primary px-3 py-1 rounded outline-none border border-accent-primary"
                      />
                      <button
                        onClick={cancelEditing}
                        className="text-xs text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="text-xs text-accent-primary hover:text-accent-primary/80"
                      >
                        Save
                      </button>
                    </div>
                  ) : message.decryptionFailed ? (
                    <DecryptionErrorMessage />
                  ) : (
                    <p className="text-text-primary break-words">
                      {message.plaintext || message.ciphertext}
                      {message.editedAt && (
                        <span className="text-xs text-text-muted ml-1">(edited)</span>
                      )}
                    </p>
                  )}

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
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-background-tertiary hover:bg-background-modifier-hover text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
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

                {/* Action buttons (reply, edit, delete) - visible on hover */}
                {editingMessageId !== message.id && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-start pt-1 gap-1 transition-opacity">
                    <button
                      onClick={() => setReplyingTo(message)}
                      className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary"
                      title="Reply"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>

                    {/* Edit and delete buttons - only for own messages */}
                    {user && message.senderId === user.id && (
                      <>
                        <button
                          onClick={() => startEditing(message)}
                          className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeletingMessageId(message.id)}
                          className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-red-400"
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

      {/* Delete confirmation modal */}
      {deletingMessageId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background-secondary rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Delete Message
            </h3>
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
