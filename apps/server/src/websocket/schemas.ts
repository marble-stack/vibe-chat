import { z } from "zod";

// Base message schema
export const baseMessageSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()),
});

// Auth message - requires JWT token, userId is extracted server-side
export const authPayloadSchema = z.object({
  token: z.string().min(1),
});

// Community messages
export const communityJoinPayloadSchema = z.object({
  communityId: z.string().uuid(),
});

export const communityLeavePayloadSchema = z.object({
  communityId: z.string().uuid(),
});

// Channel messages
export const channelJoinPayloadSchema = z.object({
  channelId: z.string().uuid(),
});

export const channelLeavePayloadSchema = z.object({
  channelId: z.string().uuid(),
});

// Message payloads
export const messageSendPayloadSchema = z.object({
  channelId: z.string().uuid(),
  ciphertext: z.string().min(1).max(50000), // Reasonable message size limit
  replyToId: z.string().uuid().optional(),
  clientId: z.string().max(100).optional(), // For optimistic message reconciliation
});

export const messageEditPayloadSchema = z.object({
  messageId: z.string().uuid(),
  channelId: z.string().uuid(),
  ciphertext: z.string().min(1).max(50000),
});

export const messageDeletePayloadSchema = z.object({
  messageId: z.string().uuid(),
  channelId: z.string().uuid(),
});

// Typing indicators
export const typingPayloadSchema = z.object({
  channelId: z.string().uuid(),
});

// Reaction payloads
export const reactionAddPayloadSchema = z.object({
  messageId: z.string().uuid(),
  channelId: z.string().uuid(),
  emoji: z.string().min(1).max(200), // Allow emojis and custom emoji IDs
});

export const reactionRemovePayloadSchema = z.object({
  reactionId: z.string().uuid(),
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(200),
});

// Key distribution request - for when a user needs a channel key
export const keyRequestPayloadSchema = z.object({
  channelId: z.string().uuid(),
  fromUserId: z.string().uuid().optional(), // Deprecated - server broadcasts to all key holders
});

// Poll vote
export const pollVotePayloadSchema = z.object({
  messageId: z.string().uuid(),
  channelId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(9),
});

// Message type to schema mapping
export const payloadSchemas = {
  auth: authPayloadSchema,
  "community:join": communityJoinPayloadSchema,
  "community:leave": communityLeavePayloadSchema,
  "channel:join": channelJoinPayloadSchema,
  "channel:leave": channelLeavePayloadSchema,
  "message:send": messageSendPayloadSchema,
  "message:edit": messageEditPayloadSchema,
  "message:delete": messageDeletePayloadSchema,
  "typing:start": typingPayloadSchema,
  "typing:stop": typingPayloadSchema,
  "reaction:add": reactionAddPayloadSchema,
  "reaction:remove": reactionRemovePayloadSchema,
  "key:request": keyRequestPayloadSchema,
  "poll:vote": pollVotePayloadSchema,
} as const;

export type MessageType = keyof typeof payloadSchemas;

/**
 * Validate a WebSocket message payload
 * Returns the validated payload or null if invalid
 */
export function validatePayload<T extends MessageType>(
  type: T,
  payload: unknown
): z.infer<(typeof payloadSchemas)[T]> | null {
  const schema = payloadSchemas[type];
  if (!schema) return null;

  const result = schema.safeParse(payload);
  if (!result.success) {
    return null;
  }

  return result.data;
}
