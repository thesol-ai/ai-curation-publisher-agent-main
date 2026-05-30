-- Phase 6 final Telegram publishing metadata.
ALTER TABLE publish_queue ADD COLUMN final_message_id TEXT;
