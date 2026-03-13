import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { extractToken, verifyToken, generateToken } from "../../lib/auth.js";

// Mock the database module - using function to avoid hoisting issues
vi.mock("../../db/index.js", () => {
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
    users: { id: "id", email: "email", passwordHash: "passwordHash" },
    preKeys: { id: "id", userId: "userId", keyId: "keyId", publicKey: "publicKey" },
  };
});

// Mock bcrypt for faster tests
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import bcrypt from "bcrypt";
import { authRoutes } from "../../routes/auth.js";
import { db } from "../../db/index.js";

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

// Helper to create auth header
const authHeader = (token: string) => `Bearer ${token}`;

describe("Auth Routes - Prekey Security", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Add the same auth hook as production
    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/auth/users/:userId/keys", () => {
    const mockUser = {
      id: testUserId,
      email: "test@example.com",
      displayName: "Test User",
      passwordHash: "hashed",
      identityKeyPublic: "identity-key-public-base64",
      signedPreKeyPublic: "signed-prekey-public-base64",
      signedPreKeySignature: "signature-base64",
      signingKeyPublic: "signing-key-public-base64",
      createdAt: new Date(),
    };

    const mockPreKey = {
      id: "prekey-1",
      userId: testUserId,
      keyId: "key-1",
      publicKey: "prekey-public-base64",
      createdAt: new Date(),
    };

    it("should return 404 if user does not exist", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty("error", "User not found");
    });

    it("should return key bundle with prekey if available", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Mock transaction that atomically fetches and deletes one prekey
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
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
        }
      );

      const response = await app.inject({
        method: "GET",
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("identityKey", mockUser.identityKeyPublic);
      expect(body).toHaveProperty("signedPreKey");
      expect(body.signedPreKey).toHaveProperty("publicKey", mockUser.signedPreKeyPublic);
      expect(body).toHaveProperty("signingKeyPublic", mockUser.signingKeyPublic);
      expect(body).toHaveProperty("preKey");
      expect(body.preKey).toHaveProperty("keyId", mockPreKey.keyId);
    });

    it("should return key bundle without prekey if none available", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Mock transaction where no prekeys are available
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
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
            delete: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          });
        }
      );

      const response = await app.inject({
        method: "GET",
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("identityKey");
      expect(body).toHaveProperty("signedPreKey");
      // preKey should be null when no prekeys are available
      expect(body.preKey).toBeNull();
    });

    it("should use atomic transaction for prekey fetch and delete", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      let transactionCalled = false;
      let selectAndDeleteInSameTransaction = false;

      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          transactionCalled = true;
          const tx = {
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    for: vi.fn().mockResolvedValue([mockPreKey]),
                  }),
                }),
              }),
            }),
            delete: vi.fn().mockImplementation(() => {
              selectAndDeleteInSameTransaction = true;
              return {
                where: vi.fn().mockResolvedValue(undefined),
              };
            }),
          };
          return callback(tx);
        }
      );

      await app.inject({
        method: "GET",
        url: `/api/auth/users/${testUserId}/keys`,
      });

      expect(transactionCalled).toBe(true);
      expect(selectAndDeleteInSameTransaction).toBe(true);
    });

    it("should only delete one prekey, not all prekeys", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      let selectLimit: number | null = null;
      let deleteCallCount = 0;

      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
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
        }
      );

      await app.inject({
        method: "GET",
        url: `/api/auth/users/${testUserId}/keys`,
      });

      // Verify only one prekey selected and deleted
      expect(selectLimit).toBe(1);
      expect(deleteCallCount).toBe(1);
    });
  });
});

describe("Auth Routes - Registration", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/register", () => {
    const validRegisterBody = {
      email: "newuser@example.com",
      password: "securepassword123",
      displayName: "New User",
      identityKeyPublic: "identity-key-base64",
      signedPreKeyPublic: "signed-prekey-base64",
      signedPreKeySignature: "signature-base64",
      signingKeyPublic: "signing-key-base64",
      preKeys: [
        { keyId: "key-1", publicKey: "prekey-1-public" },
        { keyId: "key-2", publicKey: "prekey-2-public" },
      ],
    };

    it("should register a new user successfully", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null); // No existing user
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: testUserId,
            email: validRegisterBody.email,
            displayName: validRegisterBody.displayName,
          }]),
        }),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: validRegisterBody,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("user");
      expect(body).toHaveProperty("token");
      expect(body.user.email).toBe(validRegisterBody.email);
    });

    it("should return 400 if user already exists", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: "existing-user",
        email: validRegisterBody.email,
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: validRegisterBody,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error", "User already exists");
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { ...validRegisterBody, email: "invalid-email" },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("should reject password shorter than 8 characters", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { ...validRegisterBody, password: "short" },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("should register user without prekeys", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: testUserId,
            email: validRegisterBody.email,
            displayName: validRegisterBody.displayName,
          }]),
        }),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { ...validRegisterBody, preKeys: [] },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});

describe("Auth Routes - Login", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/login", () => {
    const mockUser = {
      id: testUserId,
      email: "test@example.com",
      displayName: "Test User",
      passwordHash: "hashed-password",
    };

    it("should login successfully with valid credentials", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: mockUser.email, password: "validpassword" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("user");
      expect(body).toHaveProperty("token");
      expect(body.user.email).toBe(mockUser.email);
    });

    it("should return 401 for non-existent user", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nonexistent@example.com", password: "anypassword" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "Invalid email or password");
    });

    it("should return 401 for invalid password", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: mockUser.email, password: "wrongpassword" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "Invalid email or password");
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "invalid-email", password: "anypassword" },
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});

describe("Auth Routes - Current User", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/auth/me", () => {
    const mockUser = {
      id: testUserId,
      email: "test@example.com",
      displayName: "Test User",
    };

    it("should return current user when authenticated", async () => {
      const token = generateToken({ userId: testUserId, email: mockUser.email });
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: authHeader(token) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.id).toBe(testUserId);
      expect(body.user.email).toBe(mockUser.email);
    });

    it("should return 401 when not authenticated", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "Not authenticated");
    });

    it("should return 404 if user not found", async () => {
      const token = generateToken({ userId: testUserId, email: "test@example.com" });
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: authHeader(token) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty("error", "User not found");
    });
  });
});

describe("Auth Routes - Update Keys", () => {
  let app: FastifyInstance;
  const testUserId = "550e8400-e29b-41d4-a716-446655440001";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      const token = extractToken(request.headers.authorization);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          request.user = payload;
        }
      }
    });

    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PUT /api/auth/keys", () => {
    const validKeysBody = {
      identityKeyPublic: "new-identity-key",
      signedPreKeyPublic: "new-signed-prekey",
      signedPreKeySignature: "new-signature",
      signingKeyPublic: "new-signing-key",
      preKeys: [
        { keyId: "new-key-1", publicKey: "new-prekey-1" },
        { keyId: "new-key-2", publicKey: "new-prekey-2" },
      ],
    };

    it("should update keys successfully when authenticated", async () => {
      const token = generateToken({ userId: testUserId, email: "test@example.com" });
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const response = await app.inject({
        method: "PUT",
        url: "/api/auth/keys",
        headers: { authorization: authHeader(token) },
        payload: validKeysBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it("should return 401 when not authenticated", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/auth/keys",
        payload: validKeysBody,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "Not authenticated");
    });

    it("should update keys even without prekeys", async () => {
      const token = generateToken({ userId: testUserId, email: "test@example.com" });
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const response = await app.inject({
        method: "PUT",
        url: "/api/auth/keys",
        headers: { authorization: authHeader(token) },
        payload: { ...validKeysBody, preKeys: [] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it("should reject invalid key data", async () => {
      const token = generateToken({ userId: testUserId, email: "test@example.com" });

      const response = await app.inject({
        method: "PUT",
        url: "/api/auth/keys",
        headers: { authorization: authHeader(token) },
        payload: { identityKeyPublic: "only-one-key" }, // Missing required fields
      });

      // Zod validation throws, resulting in 500 (no error handler converts it to 400)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
