import { create } from "zustand";

interface Community {
  id: string;
  name: string;
  iconUrl?: string;
  inviteCode: string;
}

interface Channel {
  id: string;
  communityId: string;
  name: string;
}

interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
  reactionIds: Record<string, string>; // userId -> reactionId mapping
}

interface Message {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  plaintext?: string; // Decrypted content
  replyToId?: string;
  editedAt?: string | null;
  createdAt: string;
  reactions?: Reaction[];
  decryptionFailed?: boolean; // True if decryption failed for this message
  clientId?: string; // For optimistic message reconciliation
  pending?: boolean; // True while message is being sent
  sendFailed?: boolean; // True if send/encrypt failed
}

interface Member {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

interface PollVote {
  optionIndex: number;
  count: number;
  userIds: string[];
}

interface ChatState {
  communities: Community[];
  channels: Record<string, Channel[]>; // communityId -> channels
  messages: Record<string, Message[]>; // channelId -> messages
  members: Record<string, Member[]>; // communityId -> members
  activeCommunityId: string | null;
  activeChannelId: string | null;
  typingUsers: Record<string, string[]>; // channelId -> userIds
  replyingTo: Message | null; // Message being replied to
  onlineUsers: Record<string, string[]>; // communityId -> userIds
  activeThreadId: string | null; // Message ID of the thread being viewed
  pollVotes: Record<string, PollVote[]>; // messageId -> votes
  unreadCounts: Record<string, number>; // channelId -> unread count
  searchQuery: string;
  searchResults: Message[];
  isSearchOpen: boolean;
  scrollToMessageId: string | null;

  setCommunities: (communities: Community[]) => void;
  addCommunity: (community: Community) => void;
  setChannels: (communityId: string, channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setMembers: (communityId: string, members: Member[]) => void;
  addMemberIfMissing: (userId: string, displayName: string) => void;
  addMemberToCommunity: (communityId: string, member: Member) => void;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setActiveCommunity: (communityId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  setTypingUser: (channelId: string, userId: string, isTyping: boolean) => void;
  setReplyingTo: (message: Message | null) => void;
  getMessageById: (channelId: string, messageId: string) => Message | undefined;
  setOnlineUsers: (communityId: string, userIds: string[]) => void;
  setUserOnline: (communityId: string, userId: string, isOnline: boolean) => void;
  isUserOnline: (communityId: string, userId: string) => boolean;
  updateMessage: (channelId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (channelId: string, messageId: string) => void;
  addReaction: (messageId: string, reactionId: string, userId: string, emoji: string) => void;
  removeReaction: (messageId: string, userId: string, emoji: string) => void;
  setActiveThread: (messageId: string | null) => void;
  setPollVotes: (messageId: string, votes: PollVote[]) => void;
  updatePollVote: (messageId: string, userId: string, optionIndex: number, action: "add" | "remove") => void;
  markChannelRead: (channelId: string) => void;
  incrementUnread: (channelId: string) => void;
  setSearchOpen: (open: boolean) => void;
  searchMessages: (query: string) => void;
  setScrollToMessage: (messageId: string | null) => void;
  // Cleanup methods to prevent memory leaks
  clearChannelMessages: (channelId: string) => void;
  clearTypingUsers: (channelId: string) => void;
  clearChannelState: (channelId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  communities: [],
  channels: {},
  messages: {},
  members: {},
  activeCommunityId: null,
  activeChannelId: null,
  typingUsers: {},
  replyingTo: null,
  onlineUsers: {},
  activeThreadId: null,
  pollVotes: {},
  unreadCounts: {},
  searchQuery: "",
  searchResults: [],
  isSearchOpen: false,
  scrollToMessageId: null,

  setCommunities: (communities) => set({ communities }),

  addCommunity: (community) => set((state) => ({ communities: [...state.communities, community] })),

  setChannels: (communityId, channels) =>
    set((state) => ({
      channels: { ...state.channels, [communityId]: channels },
    })),

  addChannel: (channel) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [channel.communityId]: [...(state.channels[channel.communityId] || []), channel],
      },
    })),

  setMembers: (communityId, members) =>
    set((state) => ({
      members: { ...state.members, [communityId]: members },
    })),

  addMemberIfMissing: (userId, displayName) =>
    set((state) => {
      const communityId = state.activeCommunityId;
      if (!communityId) return state;

      const currentMembers = state.members[communityId] || [];
      const exists = currentMembers.some((m) => m.id === userId);
      if (exists) return state;

      return {
        members: {
          ...state.members,
          [communityId]: [...currentMembers, { id: userId, displayName }],
        },
      };
    }),

  addMemberToCommunity: (communityId, member) =>
    set((state) => {
      const currentMembers = state.members[communityId] || [];
      const exists = currentMembers.some((m) => m.id === member.id);
      if (exists) return state;

      return {
        members: {
          ...state.members,
          [communityId]: [...currentMembers, member],
        },
      };
    }),

  setMessages: (channelId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [channelId]: messages },
    })),

  addMessage: (message) =>
    set((state) => {
      const channelMessages = state.messages[message.channelId] || [];

      // Reconcile: if incoming message has a clientId that matches a pending optimistic message,
      // replace the optimistic message in-place (preserving position)
      if (message.clientId) {
        const optimisticIndex = channelMessages.findIndex(
          (m) => m.clientId === message.clientId && m.pending
        );
        if (optimisticIndex !== -1) {
          const updated = [...channelMessages];
          updated[optimisticIndex] = { ...message, pending: false, sendFailed: false };
          return {
            messages: { ...state.messages, [message.channelId]: updated },
          };
        }
      }

      // Deduplicate - check if message already exists by id
      if (channelMessages.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [message.channelId]: [...channelMessages, message],
        },
      };
    }),

  setActiveCommunity: (communityId) => set({ activeCommunityId: communityId }),

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  setTypingUser: (channelId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[channelId] || [];
      const updated = isTyping
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);
      return {
        typingUsers: { ...state.typingUsers, [channelId]: updated },
      };
    }),

  setReplyingTo: (message) => set({ replyingTo: message }),

  getMessageById: (channelId, messageId) => {
    const state = get();
    const channelMessages = state.messages[channelId] || [];
    return channelMessages.find((m) => m.id === messageId);
  },

  setOnlineUsers: (communityId, userIds) =>
    set((state) => ({
      onlineUsers: { ...state.onlineUsers, [communityId]: userIds },
    })),

  setUserOnline: (communityId, userId, isOnline) =>
    set((state) => {
      const current = state.onlineUsers[communityId] || [];
      const updated = isOnline
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);
      return {
        onlineUsers: { ...state.onlineUsers, [communityId]: updated },
      };
    }),

  isUserOnline: (communityId, userId) => {
    const state = get();
    const onlineInCommunity = state.onlineUsers[communityId] || [];
    return onlineInCommunity.includes(userId);
  },

  updateMessage: (channelId, messageId, updates) =>
    set((state) => {
      const channelMessages = state.messages[channelId] || [];
      const updatedMessages = channelMessages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      );
      return {
        messages: { ...state.messages, [channelId]: updatedMessages },
      };
    }),

  deleteMessage: (channelId, messageId) =>
    set((state) => {
      const channelMessages = state.messages[channelId] || [];
      const filteredMessages = channelMessages.filter((m) => m.id !== messageId);
      return {
        messages: { ...state.messages, [channelId]: filteredMessages },
      };
    }),

  addReaction: (messageId, reactionId, userId, emoji) =>
    set((state) => {
      const newMessages = { ...state.messages };

      // Find the channel containing this message
      for (const channelId in newMessages) {
        const channelMessages = newMessages[channelId];
        const msgIndex = channelMessages.findIndex((m) => m.id === messageId);

        if (msgIndex !== -1) {
          const message = channelMessages[msgIndex];
          const reactions = message.reactions || [];
          const existingReaction = reactions.find((r) => r.emoji === emoji);

          if (existingReaction) {
            // Update existing reaction
            existingReaction.count++;
            existingReaction.userIds.push(userId);
            existingReaction.reactionIds[userId] = reactionId;
          } else {
            // Add new reaction
            reactions.push({
              emoji,
              count: 1,
              userIds: [userId],
              reactionIds: { [userId]: reactionId },
            });
          }

          channelMessages[msgIndex] = {
            ...message,
            reactions: [...reactions],
          };

          break;
        }
      }

      return { messages: newMessages };
    }),

  removeReaction: (messageId, userId, emoji) =>
    set((state) => {
      const newMessages = { ...state.messages };

      // Find the channel containing this message
      for (const channelId in newMessages) {
        const channelMessages = newMessages[channelId];
        const msgIndex = channelMessages.findIndex((m) => m.id === messageId);

        if (msgIndex !== -1) {
          const message = channelMessages[msgIndex];
          const reactions = message.reactions || [];

          // If emoji is provided, use it; otherwise find the reaction by userId
          let reactionIndex = -1;
          if (emoji) {
            reactionIndex = reactions.findIndex((r) => r.emoji === emoji);
          } else {
            // Find any reaction by this user
            reactionIndex = reactions.findIndex((r) => r.userIds.includes(userId));
          }

          if (reactionIndex !== -1) {
            const reaction = reactions[reactionIndex];
            reaction.count--;
            reaction.userIds = reaction.userIds.filter((id) => id !== userId);
            delete reaction.reactionIds[userId];

            // Remove reaction if no users left
            if (reaction.count === 0) {
              reactions.splice(reactionIndex, 1);
            }
          }

          channelMessages[msgIndex] = {
            ...message,
            reactions: [...reactions],
          };

          break;
        }
      }

      return { messages: newMessages };
    }),

  setActiveThread: (messageId) => set({ activeThreadId: messageId }),

  setPollVotes: (messageId, votes) =>
    set((state) => ({
      pollVotes: { ...state.pollVotes, [messageId]: votes },
    })),

  updatePollVote: (messageId, userId, optionIndex, action) =>
    set((state) => {
      const currentVotes = [...(state.pollVotes[messageId] || [])];
      const existingIdx = currentVotes.findIndex((v) => v.optionIndex === optionIndex);

      if (action === "add") {
        if (existingIdx !== -1) {
          const vote = { ...currentVotes[existingIdx] };
          if (!vote.userIds.includes(userId)) {
            vote.count++;
            vote.userIds = [...vote.userIds, userId];
          }
          currentVotes[existingIdx] = vote;
        } else {
          currentVotes.push({ optionIndex, count: 1, userIds: [userId] });
        }
      } else {
        if (existingIdx !== -1) {
          const vote = { ...currentVotes[existingIdx] };
          vote.count = Math.max(0, vote.count - 1);
          vote.userIds = vote.userIds.filter((id) => id !== userId);
          if (vote.count === 0) {
            currentVotes.splice(existingIdx, 1);
          } else {
            currentVotes[existingIdx] = vote;
          }
        }
      }

      return { pollVotes: { ...state.pollVotes, [messageId]: currentVotes } };
    }),

  markChannelRead: (channelId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [channelId]: 0 },
    })),

  incrementUnread: (channelId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [channelId]: (state.unreadCounts[channelId] || 0) + 1,
      },
    })),

  setSearchOpen: (open) =>
    set({ isSearchOpen: open, searchQuery: open ? "" : "", searchResults: [] }),

  searchMessages: (query) => {
    const state = get();
    const channelId = state.activeChannelId;
    if (!channelId || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }
    const channelMessages = state.messages[channelId] || [];
    const lowerQuery = query.toLowerCase();
    const results = channelMessages.filter((m) => {
      const text = m.plaintext || m.ciphertext;
      return text.toLowerCase().includes(lowerQuery);
    });
    set({ searchQuery: query, searchResults: results });
  },

  setScrollToMessage: (messageId) => set({ scrollToMessageId: messageId }),

  // Cleanup methods to prevent memory leaks

  clearChannelMessages: (channelId) =>
    set((state) => {
      const { [channelId]: _, ...restMessages } = state.messages;
      return { messages: restMessages };
    }),

  clearTypingUsers: (channelId) =>
    set((state) => {
      const { [channelId]: _, ...restTyping } = state.typingUsers;
      return { typingUsers: restTyping };
    }),

  clearChannelState: (channelId) =>
    set((state) => {
      const { [channelId]: _messages, ...restMessages } = state.messages;
      const { [channelId]: _typing, ...restTyping } = state.typingUsers;
      return {
        messages: restMessages,
        typingUsers: restTyping,
      };
    }),
}));
