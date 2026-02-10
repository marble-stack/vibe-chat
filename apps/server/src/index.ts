import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { authRoutes } from "./routes/auth.js";
import { communityRoutes } from "./routes/communities.js";
import { channelRoutes } from "./routes/channels.js";
import { messageRoutes } from "./routes/messages.js";
import { emojiRoutes } from "./routes/emojis.js";
import { reactionRoutes } from "./routes/reactions.js";
import { fileRoutes } from "./routes/files.js";
import { pollRoutes } from "./routes/polls.js";
import { websocketHandler } from "./websocket/index.js";
import { logger } from "./lib/logger.js";
import { extractToken, verifyToken } from "./lib/auth.js";

const fastify = Fastify({
  logger: true,
});

async function main() {
  // Plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
    exposedHeaders: ["X-File-IV"],
  });
  await fastify.register(websocket);
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // Rate limiting - protect against abuse
  await fastify.register(rateLimit, {
    max: 100, // Maximum 100 requests
    timeWindow: "1 minute", // Per minute
    // Skip rate limiting for WebSocket upgrade requests
    allowList: (req) => req.url === "/ws",
  });

  // Optional auth - parse JWT if present (doesn't require auth)
  fastify.addHook("onRequest", async (request) => {
    const token = extractToken(request.headers.authorization);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        request.user = payload;
      }
    }
  });

  // REST routes
  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(communityRoutes, { prefix: "/api/communities" });
  await fastify.register(channelRoutes, { prefix: "/api/channels" });
  await fastify.register(messageRoutes, { prefix: "/api/messages" });
  await fastify.register(emojiRoutes, { prefix: "/api/emojis" });
  await fastify.register(reactionRoutes, { prefix: "/api/reactions" });
  await fastify.register(fileRoutes, { prefix: "/api/files" });
  await fastify.register(pollRoutes, { prefix: "/api/polls" });

  // WebSocket
  await fastify.register(websocketHandler);

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  // Start server
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";

  try {
    await fastify.listen({ port, host });
    logger.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
