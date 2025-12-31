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

  setCommunities: (communities: Community[]) => void;
  addCommunity: (community: Community) => void;
  setChannels: (communityId: string, channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setMembers: (communityId: string, members: Member[]) => void;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setActiveCommunity: (communityId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  setTypingUser: (channelId: string, userId: string, isTyping: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  communities: [],
  channels: {},
  messages: {},
  members: {},
  activeCommunityId: null,
  activeChannelId: null,
  typingUsers: {},

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

  setMessages: (channelId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [channelId]: messages },
    })),

  addMessage: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channelId]: [
          ...(state.messages[message.channelId] || []),
          message,
        ],
      },
    })),

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
}));
