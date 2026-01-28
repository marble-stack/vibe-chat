-- Migration: Final fix for sender_keys duplicates
-- Previous migrations (0006, 0008, 0009) are already recorded as applied

-- Drop the constraint if it exists
ALTER TABLE "sender_keys" DROP CONSTRAINT IF EXISTS "sender_keys_unique";
--> statement-breakpoint

-- Delete ALL duplicate sender_keys, keeping only the newest for each combo
DELETE FROM sender_keys a
USING sender_keys b
WHERE a.channel_id = b.channel_id
  AND a.user_id = b.user_id
  AND a.for_user_id = b.for_user_id
  AND a.created_at < b.created_at;
--> statement-breakpoint

-- Add the unique constraint
ALTER TABLE "sender_keys" ADD CONSTRAINT "sender_keys_unique" UNIQUE("channel_id", "user_id", "for_user_id");
