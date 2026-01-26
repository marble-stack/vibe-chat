import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, users, preKeys } from "../db/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(50),
  identityKeyPublic: z.string(),
  signedPreKeyPublic: z.string(),
  signedPreKeySignature: z.string(),
  preKeys: z.array(z.object({
    keyId: z.string(),
    publicKey: z.string(),
  })),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const updateKeysSchema = z.object({
  identityKeyPublic: z.string(),
  signedPreKeyPublic: z.string(),
  signedPreKeySignature: z.string(),
  preKeys: z.array(z.object({
    keyId: z.string(),
    publicKey: z.string(),
  })),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register new user
  fastify.post("/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);

    // Check if user exists
    const existing = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    if (existing) {
      return reply.status(400).send({ error: "User already exists" });
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user
    const [user] = await db.insert(users).values({
      email: body.email,
      passwordHash,
      displayName: body.displayName,
      identityKeyPublic: body.identityKeyPublic,
      signedPreKeyPublic: body.signedPreKeyPublic,
      signedPreKeySignature: body.signedPreKeySignature,
    }).returning();

    // Store prekeys
    if (body.preKeys.length > 0) {
      await db.insert(preKeys).values(
        body.preKeys.map((pk) => ({
          userId: user.id,
          keyId: pk.keyId,
          publicKey: pk.publicKey,
        }))
      );
    }

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      token,
    };
  });

  // Login
  fastify.post("/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    if (!user) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    // Verify password
    const isValid = await verifyPassword(body.password, user.passwordHash);

    if (!isValid) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      token,
    };
  });

  // Get current user (requires authentication)
  fastify.get("/me", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, request.user.userId),
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  });

  // Update user's encryption keys (for device recovery/new device)
  fastify.put("/keys", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const body = updateKeysSchema.parse(request.body);

    // Update user's keys
    await db.update(users)
      .set({
        identityKeyPublic: body.identityKeyPublic,
        signedPreKeyPublic: body.signedPreKeyPublic,
        signedPreKeySignature: body.signedPreKeySignature,
      })
      .where(eq(users.id, request.user.userId));

    // Delete old prekeys and insert new ones
    await db.delete(preKeys).where(eq(preKeys.userId, request.user.userId));

    if (body.preKeys.length > 0) {
      await db.insert(preKeys).values(
        body.preKeys.map((pk) => ({
          userId: request.user!.userId,
          keyId: pk.keyId,
          publicKey: pk.publicKey,
        }))
      );
    }

    return { success: true };
  });

  // Get user's key bundle (for establishing encrypted session)
  fastify.get("/users/:userId/keys", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    // Get one prekey (and remove it - one-time use)
    const [preKey] = await db.delete(preKeys)
      .where(eq(preKeys.userId, userId))
      .returning();

    return {
      identityKey: user.identityKeyPublic,
      signedPreKey: {
        publicKey: user.signedPreKeyPublic,
        signature: user.signedPreKeySignature,
      },
      preKey: preKey ? {
        keyId: preKey.keyId,
        publicKey: preKey.publicKey,
      } : null,
    };
  });
};
