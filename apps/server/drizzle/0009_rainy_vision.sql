ALTER TABLE "messages" ADD COLUMN "is_thread_reply" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "messages" SET "is_thread_reply" = true WHERE "reply_to_id" IS NOT NULL;