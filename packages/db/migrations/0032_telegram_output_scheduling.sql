-- Telegram output scheduling and channel-level queue controls.
PRAGMA foreign_keys = ON;

ALTER TABLE telegram_route_outputs ADD COLUMN publish_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE telegram_route_outputs ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE telegram_route_outputs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE telegram_route_outputs ADD COLUMN allowed_publish_windows_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE telegram_route_outputs ADD COLUMN minimum_gap_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE telegram_route_outputs ADD COLUMN max_posts_per_hour INTEGER NOT NULL DEFAULT 4;
ALTER TABLE telegram_route_outputs ADD COLUMN max_posts_per_day INTEGER NOT NULL DEFAULT 24;
ALTER TABLE telegram_route_outputs ADD COLUMN queue_priority INTEGER NOT NULL DEFAULT 0;

ALTER TABLE telegram_publish_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_telegram_publish_queue_target_due ON telegram_publish_queue(final_chat_id, final_thread_id, status, scheduled_for, priority);
