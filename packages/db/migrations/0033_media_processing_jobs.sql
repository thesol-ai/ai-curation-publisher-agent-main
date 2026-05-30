-- Phase 37 MVP media processing jobs for optional GitHub Actions external-media preparation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_processing_jobs (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  media_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video',
  processor TEXT NOT NULL DEFAULT 'github_actions',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  workflow_run_id TEXT,
  output_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_processing_jobs_item ON media_processing_jobs(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_processing_jobs_asset ON media_processing_jobs(media_asset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_media_processing_jobs_status ON media_processing_jobs(status, updated_at);
