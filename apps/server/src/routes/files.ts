import { FastifyPluginAsync } from "fastify";
import { db, fileAttachments } from "../db/index.js";
import { eq } from "drizzle-orm";
import { canUserAccessChannel, isUserInCommunity } from "../lib/authorization.js";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { join, extname } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_EMOJI_SIZE = 256 * 1024; // 256KB
const ALLOWED_EMOJI_MIMES = new Set(["image/png", "image/gif", "image/webp", "image/jpeg"]);

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

    // Validate channelId is a UUID before it is used as a filesystem path
    // segment, to prevent path traversal.
    if (!UUID_RE.test(channelId)) {
      return reply.status(400).send({ error: "Invalid channelId" });
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

  // Upload a community icon image (not encrypted)
  fastify.post("/community-icon", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_EMOJI_MIMES.has(data.mimetype) && data.mimetype !== "image/jpeg") {
      return reply.status(400).send({ error: "Only PNG, GIF, WebP, and JPEG images are allowed" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(413).send({ error: "Image too large. Maximum size is 2MB." });
    }

    const base64 = buffer.toString("base64");
    return { iconUrl: `data:${data.mimetype};base64,${base64}` };
  });

  // Upload a user avatar image (not encrypted)
  fastify.post("/avatar", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_EMOJI_MIMES.has(data.mimetype) && data.mimetype !== "image/jpeg") {
      return reply.status(400).send({ error: "Only PNG, GIF, WebP, and JPEG images are allowed" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(413).send({ error: "Image too large. Maximum size is 2MB." });
    }

    const base64 = buffer.toString("base64");
    return { avatarUrl: `data:${data.mimetype};base64,${base64}` };
  });

  // Upload a custom emoji image (not encrypted)
  fastify.post("/emoji-upload", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const communityId = (data.fields.communityId as { value: string } | undefined)?.value;
    if (!communityId) {
      return reply.status(400).send({ error: "communityId is required" });
    }

    const isMember = await isUserInCommunity(request.user.userId, communityId);
    if (!isMember) {
      return reply.status(403).send({ error: "Not a member of this community" });
    }

    if (!ALLOWED_EMOJI_MIMES.has(data.mimetype)) {
      return reply.status(400).send({ error: "Only PNG, GIF, WebP, and JPEG images are allowed" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_EMOJI_SIZE) {
      return reply.status(413).send({ error: "Emoji too large. Maximum size is 256KB." });
    }

    const base64 = buffer.toString("base64");
    return { fileUrl: `data:${data.mimetype};base64,${base64}` };
  });

  // Serve a custom emoji image
  fastify.get("/emoji/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };

    // Sanitize filename (only allow uuid.ext pattern)
    if (!/^[a-f0-9-]+\.(png|gif|webp|jpe?g)$/.test(filename)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = join(UPLOADS_DIR, "emojis", filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Emoji not found" });
    }

    const ext = extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };

    reply.header("Content-Type", mimeMap[ext] || "application/octet-stream");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(filePath));
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
