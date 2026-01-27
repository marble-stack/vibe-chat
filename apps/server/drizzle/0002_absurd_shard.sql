ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
-- password_hash was already added in 0001_chubby_human_cannonball.sql
DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;