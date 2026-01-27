-- Migration: Clean up duplicate rows before adding unique constraints
-- This fixes the Railway deployment failure from migration 0005

-- Clean up duplicate community members (keep oldest by id)
-- Duplicates = same user in same community multiple times (invalid state)
DELETE FROM community_members
WHERE id NOT IN (
  SELECT MIN(id)
  FROM community_members
  GROUP BY community_id, user_id
);

-- Clean up duplicate sender keys (keep NEWEST by created_at)
-- Duplicates = same key distributed multiple times (keep most recent)
DELETE FROM sender_keys
WHERE id NOT IN (
  SELECT id FROM (
    SELECT DISTINCT ON (channel_id, user_id, for_user_id) id
    FROM sender_keys
    ORDER BY channel_id, user_id, for_user_id, created_at DESC
  ) AS keepers
);

-- Add constraints if they don't exist (idempotent)
DO $$ BEGIN
  ALTER TABLE "community_members" ADD CONSTRAINT "community_members_unique" UNIQUE("community_id","user_id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sender_keys" ADD CONSTRAINT "sender_keys_unique" UNIQUE("channel_id","user_id","for_user_id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
