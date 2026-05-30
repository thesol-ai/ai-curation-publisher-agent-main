-- Phase 33 Telegram topic routing, multilingual review outputs, and safe publish queue foundation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telegram_routes (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  source_chat_id TEXT NOT NULL,
  source_thread_id INTEGER NOT NULL,
  prompt_profile TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_chat_id, source_thread_id)
);

CREATE TABLE IF NOT EXISTS telegram_route_outputs (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES telegram_routes(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  review_chat_id TEXT NOT NULL,
  review_thread_id INTEGER NOT NULL,
  final_chat_id TEXT NOT NULL,
  final_thread_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(route_id, language, final_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_route_outputs_route_enabled ON telegram_route_outputs(route_id, enabled);

CREATE TABLE IF NOT EXISTS telegram_generated_outputs (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES telegram_routes(id),
  route_output_id TEXT NOT NULL REFERENCES telegram_route_outputs(id),
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  prompt_profile TEXT NOT NULL,
  model TEXT,
  output_json TEXT NOT NULL DEFAULT '{}',
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_id, route_output_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_generated_outputs_item ON telegram_generated_outputs(item_id);
CREATE INDEX IF NOT EXISTS idx_telegram_generated_outputs_status ON telegram_generated_outputs(status, updated_at);

CREATE TABLE IF NOT EXISTS telegram_review_messages (
  id TEXT PRIMARY KEY,
  generated_output_id TEXT NOT NULL REFERENCES telegram_generated_outputs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES telegram_routes(id),
  route_output_id TEXT NOT NULL REFERENCES telegram_route_outputs(id),
  language TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_review_messages_output ON telegram_review_messages(generated_output_id);

CREATE TABLE IF NOT EXISTS telegram_publish_queue (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  generated_output_id TEXT NOT NULL REFERENCES telegram_generated_outputs(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES telegram_routes(id),
  route_output_id TEXT NOT NULL REFERENCES telegram_route_outputs(id),
  language TEXT NOT NULL,
  final_chat_id TEXT NOT NULL,
  final_thread_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  final_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(generated_output_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_publish_queue_status ON telegram_publish_queue(status, scheduled_for, created_at);

ALTER TABLE media_assets ADD COLUMN telegram_file_id TEXT;
ALTER TABLE media_assets ADD COLUMN telegram_file_unique_id TEXT;
ALTER TABLE media_assets ADD COLUMN telegram_media_group_id TEXT;
ALTER TABLE media_assets ADD COLUMN telegram_file_type TEXT;
ALTER TABLE media_assets ADD COLUMN telegram_mime_type TEXT;
ALTER TABLE media_assets ADD COLUMN telegram_file_size INTEGER;
