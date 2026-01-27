import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { extractToken, verifyToken } from '../../lib/auth.js';

// Mock the database module - using function to avoid hoisting issues
vi.mock('../../db/index.js', () => {
  const mockDb = {
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    query: {
      users: {
        findFirst: vi.fn(),
      },
      preKeys: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    transaction: vi.fn(),
  };

  return {
    db: mockDb,
    users: { id: 'id', email: 'email', passwordHash: 'passwordHash' },
    preKeys: { id: 'id', userId: 'userId', keyId: 'keyId', publicKey: 'publicKey' },
  };
});

// Mock bcrypt for faster tests
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import { authRoutes } from '../../routes/auth.js';
import { db } from '../../db/index.js';

// Cast to get type-safe mock access
const mockDb = db as unknown as {
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  query: {
    users: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    preKeys: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  transaction: ReturnType<typeof vi.fn>;
};

describe('Auth Routes - Prekey Security', () => {
  let app: FastifyInstance;
  const testUserId = '550e8400-e29b-41d4-a716-446655440001';

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Add the same auth hook as production
    app.addHook('onRequest', async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/auth/users/:userId/keys', () => {
    const mockUser = {
      id: testUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      passwordHash: 'hashed',
      identityKeyPublic: 'identity-key-public-base64',
      signedPreKeyPublic: 'signed-prekey-public-base64',
      signedPreKeySignature: 'signature-base64',
      createdAt: new Date(),
    };

    const mockPreKey = {
      id: 'prekey-1',
      userId: testUserId,
      keyId: 'key-1',
      publicKey: 'prekey-public-base64',
      createdAt: new Date(),
    };

    it('should return 404 if user does not exist', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('error', 'User not found');
    });

    it('should return key bundle with prekey if available', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Mock transaction that atomically fetches and deletes one prekey
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue([mockPreKey]),
                }),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('identityKey', mockUser.identityKeyPublic);
      expect(body).toHaveProperty('signedPreKey');
      expect(body.signedPreKey.publicKey).toBe(mockUser.signedPreKeyPublic);
    });

    it('should return key bundle without prekey if none available', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Mock transaction that finds no prekeys
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preKey).toBeNull();
    });

    it('should use atomic transaction for prekey fetch and delete', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Verify transaction is called
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue([mockPreKey]),
                }),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        });
      });

      await app.inject({
        method: 'GET',
        url: `/api/auth/users/${testUserId}/keys`,
      });

      // Verify transaction was used
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should only delete one prekey, not all prekeys', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Track what the delete was called with
      let deleteCallCount = 0;
      let selectLimit = 0;

      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockImplementation((n: number) => {
                  selectLimit = n;
                  return {
                    for: vi.fn().mockResolvedValue([mockPreKey]),
                  };
                }),
              }),
            }),
          }),
          delete: vi.fn().mockImplementation(() => {
            deleteCallCount++;
            return {
              where: vi.fn().mockResolvedValue(undefined),
            };
          }),
        });
      });

      await app.inject({
        method: 'GET',
        url: `/api/auth/users/${testUserId}/keys`,
      });

      // Verify only one prekey selected and deleted
      expect(selectLimit).toBe(1);
      expect(deleteCallCount).toBe(1);
    });
  });
});
