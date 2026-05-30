-- Phase 30 secure editable admin configuration store.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL,
  is_secret INTEGER NOT NULL,
  encrypted INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS admin_config_audit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  is_secret INTEGER NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  request_id TEXT,
  previous_value_redacted TEXT,
  new_value_redacted TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_config_audit_changed_at ON admin_config_audit(changed_at);
CREATE INDEX IF NOT EXISTS idx_admin_config_audit_key ON admin_config_audit(key);
