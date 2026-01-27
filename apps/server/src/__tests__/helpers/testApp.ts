import Fastify, { FastifyInstance } from "fastify";
import { channelRoutes } from "../../routes/channels.js";
import { extractToken, verifyToken, generateToken, JwtPayload } from "../../lib/auth.js";

/**
 * Build a test Fastify app with the channel routes
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

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

  // Register channel routes
  await app.register(channelRoutes, { prefix: "/api/channels" });

  return app;
}

/**
 * Generate a test JWT token
 */
export function createTestToken(userId: string, email: string = "test@example.com"): string {
  return generateToken({ userId, email });
}

/**
 * Generate a test user payload
 */
export function createTestUserPayload(
  userId: string,
  email: string = "test@example.com"
): JwtPayload {
  return { userId, email };
}

/**
 * Create an Authorization header value
 */
export function authHeader(token: string): string {
  return `Bearer ${token}`;
}
