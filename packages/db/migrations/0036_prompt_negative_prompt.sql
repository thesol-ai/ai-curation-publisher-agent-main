-- Phase 7: optional negative prompt support for simple prompt management.
PRAGMA foreign_keys = ON;

ALTER TABLE prompt_profiles ADD COLUMN negative_prompt TEXT;
