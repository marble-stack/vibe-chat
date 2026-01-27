import { describe, it, expect } from 'vitest';
import { validatePayload } from '../../websocket/schemas.js';

describe('WebSocket Message Validation', () => {
  describe('reaction:add', () => {
    it('should reject missing messageId', () => {
      const payload = {
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: '👍',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should reject missing channelId', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        emoji: '👍',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should reject missing emoji', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should reject invalid messageId format', () => {
      const payload = {
        messageId: 'not-a-uuid',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: '👍',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should reject invalid channelId format', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: 'not-a-uuid',
        emoji: '👍',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should reject empty emoji', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: '',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).toBeNull();
    });

    it('should accept valid reaction payload', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: '👍',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).not.toBeNull();
      expect(result).toEqual(payload);
    });

    it('should accept custom emoji with ID format', () => {
      const payload = {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: ':custom_emoji:550e8400-e29b-41d4-a716-446655440099',
      };
      const result = validatePayload('reaction:add', payload);
      expect(result).not.toBeNull();
      expect(result?.emoji).toBe(payload.emoji);
    });
  });

  describe('reaction:remove', () => {
    it('should reject missing reactionId', () => {
      const payload = {
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        emoji: '👍',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).toBeNull();
    });

    it('should reject missing channelId', () => {
      const payload = {
        reactionId: '550e8400-e29b-41d4-a716-446655440003',
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        emoji: '👍',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).toBeNull();
    });

    it('should reject missing messageId', () => {
      const payload = {
        reactionId: '550e8400-e29b-41d4-a716-446655440003',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        emoji: '👍',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).toBeNull();
    });

    it('should reject missing emoji', () => {
      const payload = {
        reactionId: '550e8400-e29b-41d4-a716-446655440003',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        messageId: '550e8400-e29b-41d4-a716-446655440002',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).toBeNull();
    });

    it('should reject invalid reactionId format', () => {
      const payload = {
        reactionId: 'not-a-uuid',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        emoji: '👍',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).toBeNull();
    });

    it('should accept valid reaction:remove payload', () => {
      const payload = {
        reactionId: '550e8400-e29b-41d4-a716-446655440003',
        channelId: '550e8400-e29b-41d4-a716-446655440001',
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        emoji: '👍',
      };
      const result = validatePayload('reaction:remove', payload);
      expect(result).not.toBeNull();
      expect(result).toEqual(payload);
    });
  });
});
