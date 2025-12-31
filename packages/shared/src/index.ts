// Shared types for Vibe Chat

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export interface Community {
  id: string;
  name: string;
  iconUrl?: string;
  inviteCode: string;
  createdBy: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  communityId: string;
  name: string;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  replyToId?: string;
  createdAt: string;
}

export interface Emoji {
  id: string;
  communityId: string;
  name: string;
  fileUrl: string;
  animated: boolean;
}

// WebSocket message types
export type WsClientMessage =
  | { type: "auth"; payload: { userId: string } }
  | { type: "channel:join"; payload: { channelId: string } }
  | { type: "channel:leave"; payload: { channelId: string } }
  | { type: "message:send"; payload: { channelId: string; ciphertext: string; replyToId?: string } }
  | { type: "typing:start"; payload: { channelId: string } }
  | { type: "typing:stop"; payload: { channelId: string } };

export type WsServerMessage =
  | { type: "auth:success"; payload: Record<string, never> }
  | { type: "channel:joined"; payload: { channelId: string } }
  | { type: "message:new"; payload: Message }
  | { type: "typing:update"; payload: { channelId: string; userId: string; isTyping: boolean } }
  | { type: "error"; payload: { message: string } };

// Signal Protocol key types
export interface PreKeyBundle {
  identityKey: string;
  signedPreKey: {
    publicKey: string;
    signature: string;
  };
  preKey: {
    keyId: string;
    publicKey: string;
  } | null;
}

export interface SenderKeyDistribution {
  channelId: string;
  userId: string;
  distributionId: string;
  encryptedKey: string;
}
