import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = "7d";

// JWT_SECRET is required - no fallback default
// Use lazy evaluation to allow environment to be fully loaded before checking
let cachedJwtSecret: string | null = null;

function getJwtSecret(): string {
  // Return cached value if already retrieved
  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // In test environment, provide a more specific error message
    if (process.env.NODE_ENV === "test") {
      throw new Error(
        "JWT_SECRET environment variable is required. " +
        "For tests, set JWT_SECRET in your test setup file."
      );
    }

    throw new Error(
      "JWT_SECRET environment variable is required. " +
      "Please set a secure JWT_SECRET in your environment."
    );
  }

  // Cache the secret for subsequent calls
  cachedJwtSecret = secret;
  return secret;
}

/**
 * Reset the cached JWT secret (for testing purposes only)
 */
export function resetJwtSecretCache(): void {
  cachedJwtSecret = null;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Authentication middleware for protected routes
 * Adds `user` to request object if authenticated
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(request.headers.authorization);

  if (!token) {
    return reply.status(401).send({ error: "Authorization header required" });
  }

  const payload = verifyToken(token);

  if (!payload) {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }

  // Attach user info to request
  (request as FastifyRequest & { user: JwtPayload }).user = payload;
}

// Type augmentation for FastifyRequest
declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
