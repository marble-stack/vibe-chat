-- Migration: Fix sender_keys duplicates (v2) - more robust approach
-- Uses CTE-based delete that's more reliable across PostgreSQL versions

-- First, drop the constraint if it exists (cleanup from previous failed attempts)
ALTER TABLE "sender_keys" DROP CONSTRAINT IF EXISTS "sender_keys_unique";
--> statement-breakpoint

-- Delete duplicates using a CTE with ROW_NUMBER
-- Keeps only the most recent row for each (channel_id, user_id, for_user_id) combination
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY channel_id, user_id, for_user_id
           ORDER BY created_at DESC
         ) AS rn
  FROM sender_keys
)
DELETE FROM sender_keys
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);
--> statement-breakpoint

-- Now add the unique constraint (should succeed after duplicates are removed)
ALTER TABLE "sender_keys" ADD CONSTRAINT "sender_keys_unique" UNIQUE("channel_id", "user_id", "for_user_id");
