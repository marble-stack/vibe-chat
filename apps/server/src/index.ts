import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { authRoutes } from "./routes/auth.js";
import { communityRoutes } from "./routes/communities.js";
import { channelRoutes } from "./routes/channels.js";
import { messageRoutes } from "./routes/messages.js";
import { emojiRoutes } from "./routes/emojis.js";
import { websocketHandler } from "./websocket/index.js";

const fastify = Fastify({
  logger: true,
});

async function main() {
  // Plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  });
  await fastify.register(websocket);

  // REST routes
  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(communityRoutes, { prefix: "/api/communities" });
  await fastify.register(channelRoutes, { prefix: "/api/channels" });
  await fastify.register(messageRoutes, { prefix: "/api/messages" });
  await fastify.register(emojiRoutes, { prefix: "/api/emojis" });

  // WebSocket
  await fastify.register(websocketHandler);

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  // Start server
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";

  try {
    await fastify.listen({ port, host });
    console.log(`Server running at http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
