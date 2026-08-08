-- Durable read-only archives and resumable gate snapshots for the one-time Legacy migration.
-- This migration deliberately does not drop skills or skill_runs. Retirement is a
-- separate release-gated action after reconciliation and rollback observation.
CREATE TABLE IF NOT EXISTS skill_legacy_archives (
  id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  legacy_skill_id TEXT,
  source_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  redaction_json TEXT NOT NULL DEFAULT '{}',
  read_only INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_legacy_archives_key
  ON skill_legacy_archives(archive_key);
CREATE INDEX IF NOT EXISTS idx_skill_legacy_archives_legacy_skill
  ON skill_legacy_archives(legacy_skill_id, archived_at);

CREATE TABLE IF NOT EXISTS skill_legacy_migration_runs (
  id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  backup_manifest_path TEXT NOT NULL,
  backup_manifest_sha256 TEXT NOT NULL,
  source_counts_json TEXT NOT NULL DEFAULT '{}',
  target_counts_before_json TEXT NOT NULL DEFAULT '{}',
  target_counts_after_json TEXT NOT NULL DEFAULT '{}',
  reconciliation_json TEXT NOT NULL DEFAULT '{}',
  manual_review_count INTEGER NOT NULL DEFAULT 0,
  gate_status TEXT NOT NULL,
  rollback_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_legacy_migration_runs_status
  ON skill_legacy_migration_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_skill_legacy_migration_runs_phase
  ON skill_legacy_migration_runs(phase, created_at);
