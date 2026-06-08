CREATE TABLE IF NOT EXISTS "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"staffbase_session_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"staffbase_url" text,
	"api_token" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "changelog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"summary" text NOT NULL,
	"payload" jsonb,
	"gdpr_relevant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_staffbase_hash_idx" ON "sessions" ("instance_id","staffbase_session_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_instance_id_idx" ON "items" ("instance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_instance_status_idx" ON "items" ("instance_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_instance_id_created_at_idx" ON "changelog" ("instance_id","created_at");
