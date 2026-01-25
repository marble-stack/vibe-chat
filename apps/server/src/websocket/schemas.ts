import { z } from "zod";

// Base message schema
export const baseMessageSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()),
});

// Auth message
export const authPayloadSchema = z.object({
  userId: z.string().uuid(),
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
