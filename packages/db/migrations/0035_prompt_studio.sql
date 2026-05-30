-- Prompt Studio: editable, versioned prompt profiles and output bindings.
-- Prompts remain safe D1 data. Secrets and provider credentials stay outside this schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prompt_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '*',
  language TEXT NOT NULL DEFAULT '*',
  content_type TEXT NOT NULL DEFAULT 'social_post',
  output_target TEXT NOT NULL DEFAULT 'telegram',
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'draft',
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  output_schema_ref TEXT NOT NULL DEFAULT 'telegram_output_v1',
  model_hint TEXT,
  temperature REAL,
  max_tokens INTEGER,
  risk_policy TEXT,
  style_guide TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_profiles_lookup ON prompt_profiles(category, language, content_type, output_target, status);
CREATE INDEX IF NOT EXISTS idx_prompt_profiles_status ON prompt_profiles(status, updated_at);

CREATE TABLE IF NOT EXISTS prompt_bindings (
  id TEXT PRIMARY KEY,
  route_id TEXT REFERENCES telegram_routes(id) ON DELETE CASCADE,
  route_output_id TEXT REFERENCES telegram_route_outputs(id) ON DELETE CASCADE,
  category TEXT,
  language TEXT,
  content_type TEXT NOT NULL DEFAULT 'social_post',
  prompt_profile_id TEXT NOT NULL REFERENCES prompt_profiles(id) ON DELETE CASCADE,
  prompt_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_bindings_output ON prompt_bindings(route_output_id, enabled);
CREATE INDEX IF NOT EXISTS idx_prompt_bindings_route ON prompt_bindings(route_id, enabled);
CREATE INDEX IF NOT EXISTS idx_prompt_bindings_category_language ON prompt_bindings(category, language, content_type, enabled);

CREATE TABLE IF NOT EXISTS prompt_test_cases (
  id TEXT PRIMARY KEY,
  prompt_profile_id TEXT NOT NULL REFERENCES prompt_profiles(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  source_url TEXT,
  expected_language TEXT,
  expected_constraints_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_runs (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  generated_output_id TEXT,
  prompt_profile_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  rendered_prompt_hash TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'created',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prompt_runs_profile ON prompt_runs(prompt_profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_runs_item ON prompt_runs(item_id, created_at);
