import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, users, preKeys } from "../db/index.js";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Hash password using scrypt
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Verify password against hash
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [hashedPassword, salt] = hash.split(".");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(Buffer.from(hashedPassword, "hex"), buf);
}

const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8),
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
      displayName: body.displayName,
      passwordHash,
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

    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
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
    const isValidPassword = await verifyPassword(body.password, user.passwordHash);
    if (!isValidPassword) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    // In production: generate JWT, verify identity, etc.
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
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
