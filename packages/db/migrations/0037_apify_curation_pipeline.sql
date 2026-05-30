-- Apify + Claude autonomous curation pipeline tables.
PRAGMA foreign_keys = ON;

-- Apify source configuration: maps categories to Apify dataset IDs.
CREATE TABLE IF NOT EXISTS apify_curation_sources (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  platform TEXT NOT NULL,
  apify_dataset_id TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_apify_sources_category ON apify_curation_sources(category, enabled);

-- Tracks each curation run per category (merging all platforms).
CREATE TABLE IF NOT EXISTS apify_crawl_runs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  dataset_ids_json TEXT NOT NULL DEFAULT '[]',
  total_items INTEGER DEFAULT 0,
  candidates_after_dedupe INTEGER DEFAULT 0,
  candidates_sent_to_claude INTEGER DEFAULT 0,
  claude_selected_count INTEGER DEFAULT 0,
  claude_rejected_count INTEGER DEFAULT 0,
  claude_error_message TEXT,
  claude_input_tokens INTEGER,
  claude_output_tokens INTEGER,
  items_queued_count INTEGER DEFAULT 0,
  items_dedupe_count INTEGER DEFAULT 0,
  items_failed_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_time_ms INTEGER,
  fetch_apify_ms INTEGER,
  call_claude_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_apify_crawl_runs_category ON apify_crawl_runs(category, status);
CREATE INDEX IF NOT EXISTS idx_apify_crawl_runs_created_at ON apify_crawl_runs(created_at DESC);

-- Records each Claude curation decision (selected or rejected) for audit.
CREATE TABLE IF NOT EXISTS claude_curation_decisions (
  id TEXT PRIMARY KEY,
  apify_crawl_run_id TEXT NOT NULL REFERENCES apify_crawl_runs(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_handle TEXT,
  claude_score REAL NOT NULL,
  claude_reason TEXT,
  selected INTEGER NOT NULL DEFAULT 1,
  media_expected INTEGER NOT NULL DEFAULT 1,
  risk_flags_json TEXT DEFAULT '[]',
  dedupe_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claude_decisions_run ON claude_curation_decisions(apify_crawl_run_id);
CREATE INDEX IF NOT EXISTS idx_claude_decisions_selected ON claude_curation_decisions(selected);
CREATE INDEX IF NOT EXISTS idx_claude_decisions_item ON claude_curation_decisions(item_id);
