import { FastifyPluginAsync } from "fastify";
import { db, fileAttachments } from "../db/index.js";
import { eq } from "drizzle-orm";
import { canUserAccessChannel } from "../lib/authorization.js";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export const fileRoutes: FastifyPluginAsync = async (fastify) => {
  // Upload an encrypted file
  fastify.post("/upload", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const channelId = (data.fields.channelId as { value: string } | undefined)?.value;
    const iv = (data.fields.iv as { value: string } | undefined)?.value;

    if (!channelId || !iv) {
      return reply.status(400).send({ error: "channelId and iv are required" });
    }

    const canAccess = await canUserAccessChannel(request.user.userId, channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this channel" });
    }

    // Read file buffer
    const buffer = await data.toBuffer();

    if (buffer.length > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: "File too large. Maximum size is 25MB." });
    }

    // Ensure upload directory exists
    const channelDir = join(UPLOADS_DIR, channelId);
    await mkdir(channelDir, { recursive: true });

    // Save to disk
    const fileId = randomUUID();
    const fileName = `${fileId}.enc`;
    const filePath = join(channelDir, fileName);
    await writeFile(filePath, buffer);

    // Store in database
    const storagePath = `${channelId}/${fileName}`;
    const [attachment] = await db
      .insert(fileAttachments)
      .values({
        channelId,
        storagePath,
        encryptedSize: buffer.length,
        iv,
        uploadedBy: request.user.userId,
      })
      .returning();

    return { fileId: attachment.id };
  });

  // Download an encrypted file
  fastify.get("/:fileId", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const { fileId } = request.params as { fileId: string };

    const attachment = await db.query.fileAttachments.findFirst({
      where: eq(fileAttachments.id, fileId),
    });

    if (!attachment) {
      return reply.status(404).send({ error: "File not found" });
    }

    const canAccess = await canUserAccessChannel(request.user.userId, attachment.channelId);
    if (!canAccess) {
      return reply.status(403).send({ error: "Cannot access this file" });
    }

    const filePath = join(UPLOADS_DIR, attachment.storagePath);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found on disk" });
    }

    reply.header("Content-Type", "application/octet-stream");
    reply.header("X-File-IV", attachment.iv);
    return reply.send(createReadStream(filePath));
  });
};
