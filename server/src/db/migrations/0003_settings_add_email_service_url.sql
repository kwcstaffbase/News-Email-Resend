-- Add email_service_url to the settings table so each plugin instance can
-- configure the endpoint used to send reminder emails to non-acknowledging users.
--
-- Rollback:
--   ALTER TABLE "settings" DROP COLUMN "email_service_url";

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_service_url" text;
