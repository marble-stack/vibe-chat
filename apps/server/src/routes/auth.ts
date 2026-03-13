import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { db, users, preKeys } from "../db/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth.js";
import { sendPasswordResetEmail } from "../lib/email.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(50),
  identityKeyPublic: z.string(),
  signedPreKeyPublic: z.string(),
  signedPreKeySignature: z.string(),
  signingKeyPublic: z.string().optional(),
  preKeys: z.array(
    z.object({
      keyId: z.string(),
      publicKey: z.string(),
    })
  ),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  temporaryPassword: z.string(),
  newPassword: z.string().min(8).max(100),
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().max(500000).nullable().optional(), // base64 data URLs can be large
});

const keyBackupSchema = z.object({
  encryptedKeyBackup: z.string(),
  salt: z.string(),
});

const updateKeysSchema = z.object({
  identityKeyPublic: z.string(),
  signedPreKeyPublic: z.string(),
  signedPreKeySignature: z.string(),
  signingKeyPublic: z.string().optional(),
  preKeys: z.array(
    z.object({
      keyId: z.string(),
      publicKey: z.string(),
    })
  ),
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
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        identityKeyPublic: body.identityKeyPublic,
        signedPreKeyPublic: body.signedPreKeyPublic,
        signedPreKeySignature: body.signedPreKeySignature,
        signingKeyPublic: body.signingKeyPublic,
      })
      .returning();

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
      user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl },
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

    // Capture previous lastLoginAt before updating
    const previousLoginAt = user.lastLoginAt;

    // Update lastLoginAt
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl },
      token,
      hasKeyBackup: !!user.encryptedKeyBackup,
      lastLoginAt: previousLoginAt?.toISOString() ?? null,
    };
  });

  // Forgot password - sends temporary password via email
  fastify.post("/forgot-password", async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return { success: true };
    }

    // Generate a random 8-character temporary password
    const temporaryPassword = crypto.randomBytes(4).toString("hex");

    // Hash it and store with 15-minute expiry
    const hashedToken = await hashPassword(temporaryPassword);
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await db
      .update(users)
      .set({
        passwordResetToken: hashedToken,
        passwordResetExpires: expires,
      })
      .where(eq(users.id, user.id));

    // Send email with temporary password
    await sendPasswordResetEmail(user.email, temporaryPassword);

    return { success: true };
  });

  // Reset password - validates temporary password and sets new password
  fastify.post("/reset-password", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    if (!user || !user.passwordResetToken || !user.passwordResetExpires) {
      return reply.status(400).send({ error: "Invalid or expired reset request" });
    }

    // Check if token has expired
    if (new Date() > user.passwordResetExpires) {
      // Clear expired token
      await db
        .update(users)
        .set({ passwordResetToken: null, passwordResetExpires: null })
        .where(eq(users.id, user.id));
      return reply.status(400).send({ error: "Reset code has expired. Please request a new one." });
    }

    // Verify the temporary password
    const isValid = await verifyPassword(body.temporaryPassword, user.passwordResetToken);
    if (!isValid) {
      return reply.status(400).send({ error: "Invalid temporary password" });
    }

    // Hash and set new password, clear reset token
    const newHash = await hashPassword(body.newPassword);
    await db
      .update(users)
      .set({
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      })
      .where(eq(users.id, user.id));

    return { success: true };
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
      user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl },
    };
  });

  // Update user profile (display name, avatar)
  fastify.patch("/profile", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const body = updateProfileSchema.parse(request.body);

    const updates: Record<string, unknown> = {};
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, request.user.userId))
      .returning();

    return {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
      },
    };
  });

  // Update user's encryption keys (for device recovery/new device)
  fastify.put("/keys", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const body = updateKeysSchema.parse(request.body);

    // Update user's keys
    await db
      .update(users)
      .set({
        identityKeyPublic: body.identityKeyPublic,
        signedPreKeyPublic: body.signedPreKeyPublic,
        signedPreKeySignature: body.signedPreKeySignature,
        signingKeyPublic: body.signingKeyPublic,
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

  // Store encrypted key backup
  fastify.put("/key-backup", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const body = keyBackupSchema.parse(request.body);

    await db
      .update(users)
      .set({
        encryptedKeyBackup: body.encryptedKeyBackup,
        keyBackupSalt: body.salt,
      })
      .where(eq(users.id, request.user.userId));

    return { success: true };
  });

  // Get encrypted key backup
  fastify.get("/key-backup", async (request, reply) => {
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
      encryptedKeyBackup: user.encryptedKeyBackup,
      salt: user.keyBackupSalt,
    };
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

    // Atomically fetch and delete one prekey using a transaction
    // This prevents concurrent requests from using the same prekey
    const preKey = await db.transaction(async (tx) => {
      // Select one prekey with FOR UPDATE to lock the row
      const [selectedPreKey] = await tx
        .select()
        .from(preKeys)
        .where(eq(preKeys.userId, userId))
        .limit(1)
        .for("update", { skipLocked: true });

      if (!selectedPreKey) {
        return null;
      }

      // Delete only this specific prekey
      await tx.delete(preKeys).where(eq(preKeys.id, selectedPreKey.id));

      return selectedPreKey;
    });

    return {
      identityKey: user.identityKeyPublic,
      signedPreKey: {
        publicKey: user.signedPreKeyPublic,
        signature: user.signedPreKeySignature,
      },
      signingKeyPublic: user.signingKeyPublic,
      preKey: preKey
        ? {
            keyId: preKey.keyId,
            publicKey: preKey.publicKey,
          }
        : null,
    };
  });
};
