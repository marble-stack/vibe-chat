-- Migration: Fix sender_keys duplicates that are blocking deployment
-- This migration is idempotent and can be run multiple times safely

-- First, drop the constraint if it exists (may be partially created)
ALTER TABLE "sender_keys" DROP CONSTRAINT IF EXISTS "sender_keys_unique";

-- Clean up duplicate sender keys (keep NEWEST by created_at)
-- This handles any duplicates that were created after migration 0006 ran
DELETE FROM sender_keys
WHERE id NOT IN (
  SELECT id FROM (
    SELECT DISTINCT ON (channel_id, user_id, for_user_id) id
    FROM sender_keys
    ORDER BY channel_id, user_id, for_user_id, created_at DESC
  ) AS keepers
);

-- Now add the unique constraint
ALTER TABLE "sender_keys" ADD CONSTRAINT "sender_keys_unique" UNIQUE("channel_id", "user_id", "for_user_id");
