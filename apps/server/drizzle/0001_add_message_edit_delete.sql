-- Add edited_at and deleted_at columns to messages table
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "edited_at" timestamp;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
