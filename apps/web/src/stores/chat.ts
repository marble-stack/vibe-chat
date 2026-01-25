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

interface Message {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  plaintext?: string; // Decrypted content
  replyToId?: string;
  editedAt?: string | null;
  createdAt: string;
}

interface Member {
  id: string;
  displayName: string;
  avatarUrl?: string;
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

  setCommunities: (communities: Community[]) => void;
  addCommunity: (community: Community) => void;
  setChannels: (communityId: string, channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setMembers: (communityId: string, members: Member[]) => void;
  addMemberIfMissing: (userId: string, displayName: string) => void;
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

  setCommunities: (communities) => set({ communities }),

  addCommunity: (community) =>
    set((state) => ({ communities: [...state.communities, community] })),

  setChannels: (communityId, channels) =>
    set((state) => ({
      channels: { ...state.channels, [communityId]: channels },
    })),

  addChannel: (channel) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [channel.communityId]: [
          ...(state.channels[channel.communityId] || []),
          channel,
        ],
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

  setMessages: (channelId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [channelId]: messages },
    })),

  addMessage: (message) =>
    set((state) => {
      const channelMessages = state.messages[message.channelId] || [];
      // Deduplicate - check if message already exists
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
}));
