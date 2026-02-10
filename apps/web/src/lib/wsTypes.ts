/**
 * WebSocket Message Types
 *
 * Centralized constants for WebSocket message types to prevent typos
 * and enable type-safe message handling.
 */

// Client -> Server message types
export const WS_CLIENT_MESSAGES = {
  AUTH: "auth",
  CHANNEL_JOIN: "channel:join",
  CHANNEL_LEAVE: "channel:leave",
  COMMUNITY_JOIN: "community:join",
  COMMUNITY_LEAVE: "community:leave",
  MESSAGE_SEND: "message:send",
  MESSAGE_EDIT: "message:edit",
  MESSAGE_DELETE: "message:delete",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  REACTION_ADD: "reaction:add",
  REACTION_REMOVE: "reaction:remove",
  KEY_REQUEST: "key:request",
} as const;

// Server -> Client message types
export const WS_SERVER_MESSAGES = {
  AUTH_SUCCESS: "auth:success",
  ERROR: "error",
  MESSAGE_NEW: "message:new",
  MESSAGE_EDITED: "message:edited",
  MESSAGE_DELETED: "message:deleted",
  TYPING_UPDATE: "typing:update",
  PRESENCE_LIST: "presence:list",
  PRESENCE_UPDATE: "presence:update",
  REACTION_ADDED: "reaction:added",
  REACTION_REMOVED: "reaction:removed",
  KEY_REQUESTED: "key:requested",
  KEY_AVAILABLE: "key:available",
  MEMBER_JOINED: "member:joined",
} as const;

// Combined for general use
export const WS_MESSAGES = {
  ...WS_CLIENT_MESSAGES,
  ...WS_SERVER_MESSAGES,
} as const;

// Type helpers
export type WsClientMessageType = (typeof WS_CLIENT_MESSAGES)[keyof typeof WS_CLIENT_MESSAGES];
export type WsServerMessageType = (typeof WS_SERVER_MESSAGES)[keyof typeof WS_SERVER_MESSAGES];
export type WsMessageType = WsClientMessageType | WsServerMessageType;

// Payload types for each message (can be expanded)
export interface WsMessagePayloads {
  [WS_CLIENT_MESSAGES.AUTH]: { token: string };
  [WS_CLIENT_MESSAGES.CHANNEL_JOIN]: { channelId: string };
  [WS_CLIENT_MESSAGES.CHANNEL_LEAVE]: { channelId: string };
  [WS_CLIENT_MESSAGES.COMMUNITY_JOIN]: { communityId: string };
  [WS_CLIENT_MESSAGES.COMMUNITY_LEAVE]: { communityId: string };
  [WS_CLIENT_MESSAGES.MESSAGE_SEND]: {
    channelId: string;
    ciphertext: string;
    replyToId?: string;
    isThreadReply?: boolean;
  };
  [WS_CLIENT_MESSAGES.MESSAGE_EDIT]: {
    channelId: string;
    messageId: string;
    ciphertext: string;
  };
  [WS_CLIENT_MESSAGES.MESSAGE_DELETE]: {
    channelId: string;
    messageId: string;
  };
  [WS_CLIENT_MESSAGES.TYPING_START]: { channelId: string };
  [WS_CLIENT_MESSAGES.TYPING_STOP]: { channelId: string };
  [WS_CLIENT_MESSAGES.REACTION_ADD]: {
    messageId: string;
    channelId: string;
    emoji: string;
  };
  [WS_CLIENT_MESSAGES.REACTION_REMOVE]: {
    reactionId: string;
    channelId: string;
    messageId: string;
    emoji: string;
  };
  [WS_CLIENT_MESSAGES.KEY_REQUEST]: {
    channelId: string;
    fromUserId: string;
  };
}

// Generic message structure
export interface WsMessage<T extends WsMessageType = WsMessageType> {
  type: T;
  payload: T extends keyof WsMessagePayloads ? WsMessagePayloads[T] : Record<string, unknown>;
}
