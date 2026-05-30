-- Channel signatures for route outputs.
-- Each output can append an operator-managed signature to review previews and final Telegram publishing.
PRAGMA foreign_keys = ON;

ALTER TABLE telegram_route_outputs ADD COLUMN signature_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_route_outputs ADD COLUMN signature_text TEXT;
ALTER TABLE telegram_route_outputs ADD COLUMN signature_channel_handle TEXT;
ALTER TABLE telegram_route_outputs ADD COLUMN signature_position TEXT NOT NULL DEFAULT 'append';

CREATE INDEX IF NOT EXISTS idx_telegram_route_outputs_signature_enabled ON telegram_route_outputs(signature_enabled);
