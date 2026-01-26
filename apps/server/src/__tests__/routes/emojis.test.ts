import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { extractToken, verifyToken, generateToken } from '../../lib/auth.js';

// Mock the database module
vi.mock('../../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'emoji-123', name: 'test_emoji' }]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'emoji-123' }]),
      }),
    }),
    query: {
      emojis: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  },
  emojis: { id: 'id', communityId: 'communityId', name: 'name', uploadedBy: 'uploadedBy' },
}));

// Mock authorization module
vi.mock('../../lib/authorization.js', () => ({
  isUserInCommunity: vi.fn(),
}));

import { emojiRoutes } from '../../routes/emojis.js';
import { db } from '../../db/index.js';
import { isUserInCommunity } from '../../lib/authorization.js';

// Helper to create test app
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    const token = extractToken(request.headers.authorization);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        request.user = payload;
      }
    }
  });

  await app.register(emojiRoutes, { prefix: '/api/emojis' });
  return app;
}

function createTestToken(userId: string): string {
  return generateToken({ userId, email: 'test@example.com' });
}

describe('Emoji Routes - Authorization', () => {
  let app: FastifyInstance;
  const testUserId = '550e8400-e29b-41d4-a716-446655440001';
  const otherUserId = '550e8400-e29b-41d4-a716-446655440002';
  const testCommunityId = '550e8400-e29b-41d4-a716-446655440003';

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/emojis', () => {
    const validBody = {
      communityId: testCommunityId,
      name: 'test_emoji',
      fileUrl: 'https://example.com/emoji.png',
      animated: false,
      uploadedBy: testUserId,
    };

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/emojis',
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty('error');
    });

    it('should return 403 if user not in community', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/api/emojis',
        headers: { authorization: `Bearer ${token}` },
        payload: validBody,
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 403 if uploadedBy does not match authenticated user', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(true);
      vi.mocked(db.query.emojis.findFirst).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/emojis',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...validBody, uploadedBy: otherUserId },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow emoji creation for authenticated community member', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(true);
      vi.mocked(db.query.emojis.findFirst).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/emojis',
        headers: { authorization: `Bearer ${token}` },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('emoji');
    });
  });

  describe('GET /api/emojis/community/:communityId', () => {
    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/emojis/community/${testCommunityId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if user not in community', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: `/api/emojis/community/${testCommunityId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return emojis for authenticated community member', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(isUserInCommunity).mockResolvedValue(true);

      const response = await app.inject({
        method: 'GET',
        url: `/api/emojis/community/${testCommunityId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('emojis');
    });
  });

  describe('DELETE /api/emojis/:emojiId', () => {
    const emojiId = '550e8400-e29b-41d4-a716-446655440004';

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/emojis/${emojiId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if user did not upload the emoji', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(db.query.emojis.findFirst).mockResolvedValue({
        id: emojiId,
        communityId: testCommunityId,
        name: 'test',
        fileUrl: 'https://example.com/emoji.png',
        animated: false,
        uploadedBy: otherUserId, // Different user
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/emojis/${emojiId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow delete for user who uploaded the emoji', async () => {
      const token = createTestToken(testUserId);
      vi.mocked(db.query.emojis.findFirst).mockResolvedValue({
        id: emojiId,
        communityId: testCommunityId,
        name: 'test',
        fileUrl: 'https://example.com/emoji.png',
        animated: false,
        uploadedBy: testUserId, // Same user
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/emojis/${emojiId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
