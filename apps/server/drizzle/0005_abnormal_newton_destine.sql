CREATE TABLE IF NOT EXISTS "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_keys" ADD COLUMN IF NOT EXISTS "sender_public_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactions_message_idx" ON "reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactions_user_message_emoji_idx" ON "reactions" USING btree ("user_id","message_id","emoji");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Clean up duplicate community_members (keep oldest)
DELETE FROM community_members a USING community_members b
WHERE a.community_id = b.community_id AND a.user_id = b.user_id AND a.id > b.id;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "community_members" ADD CONSTRAINT "community_members_unique" UNIQUE("community_id","user_id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Clean up duplicate sender_keys (keep newest by created_at, then by id)
DELETE FROM sender_keys a USING sender_keys b
WHERE a.channel_id = b.channel_id AND a.user_id = b.user_id AND a.for_user_id = b.for_user_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sender_keys" ADD CONSTRAINT "sender_keys_unique" UNIQUE("channel_id","user_id","for_user_id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;