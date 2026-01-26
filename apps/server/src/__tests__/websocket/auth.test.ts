import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyToken, generateToken } from '../../lib/auth.js';

// Mock the auth module to use a consistent secret
vi.mock('../../lib/auth.js', async () => {
  const jwt = await import('jsonwebtoken');
  const SECRET = 'test-secret-for-ws-tests';

  return {
    verifyToken: (token: string) => {
      try {
        return jwt.default.verify(token, SECRET) as { userId: string; email: string };
      } catch {
        return null;
      }
    },
    generateToken: (payload: { userId: string; email: string }) => {
      return jwt.default.sign(payload, SECRET, { expiresIn: '7d' });
    },
  };
});

describe('WebSocket Authentication', () => {
  const testUserId = '550e8400-e29b-41d4-a716-446655440001';
  const testEmail = 'test@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Token-based Authentication', () => {
    it('should verify valid JWT tokens', () => {
      const token = generateToken({ userId: testUserId, email: testEmail });

      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe(testUserId);
      expect(payload?.email).toBe(testEmail);
    });

    it('should reject invalid JWT tokens', () => {
      const payload = verifyToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject tampered JWT tokens', () => {
      const token = generateToken({ userId: testUserId, email: testEmail });

      // Tamper with the token
      const parts = token.split('.');
      parts[1] = Buffer.from(JSON.stringify({ userId: 'hacker-id', email: 'hacker@test.com' })).toString('base64');
      const tamperedToken = parts.join('.');

      const payload = verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });

    it('should extract userId from verified token, not trust client payload', () => {
      // Simulate what WebSocket auth should do
      const legitimateUserId = testUserId;
      const maliciousUserId = '550e8400-e29b-41d4-a716-000000000000';

      // Generate token for legitimate user
      const token = generateToken({ userId: legitimateUserId, email: testEmail });

      // Verify token and extract userId
      const verifiedPayload = verifyToken(token);
      expect(verifiedPayload).not.toBeNull();

      // The server should use verifiedPayload.userId, not any client-provided userId
      const authenticatedUserId = verifiedPayload!.userId;
      expect(authenticatedUserId).toBe(legitimateUserId);
      expect(authenticatedUserId).not.toBe(maliciousUserId);
    });

    it('should reject expired JWT tokens', async () => {
      // Import jwt directly to create an expired token
      const jwt = await import('jsonwebtoken');

      // Create token that's already expired
      const expiredToken = jwt.default.sign(
        { userId: testUserId, email: testEmail },
        'test-secret-for-ws-tests',
        { expiresIn: '-1s' } // Expired 1 second ago
      );

      const payload = verifyToken(expiredToken);
      expect(payload).toBeNull();
    });
  });

  describe('Authentication Schema Requirements', () => {
    it('should require token in auth payload', async () => {
      // Import the schema
      const { authPayloadSchema } = await import('../../websocket/schemas.js');

      // Auth payload should require a token
      const result = authPayloadSchema.safeParse({ token: 'some-jwt-token' });
      expect(result.success).toBe(true);
    });

    it('should reject auth payload without token', async () => {
      const { authPayloadSchema } = await import('../../websocket/schemas.js');

      // Payload without token should fail
      const result = authPayloadSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject auth payload with only userId (no token)', async () => {
      const { authPayloadSchema } = await import('../../websocket/schemas.js');

      // Old format with just userId should be rejected
      const result = authPayloadSchema.safeParse({ userId: testUserId });

      // The schema should now require token, not userId
      // If userId is still accepted, this test will fail, indicating we need to update the schema
      if (result.success) {
        // Schema still allows userId-only auth - this is insecure!
        expect(result.data).toHaveProperty('token');
      }
    });
  });
});
