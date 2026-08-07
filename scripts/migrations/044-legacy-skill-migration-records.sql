-- Durable, append-only mapping between a historical Legacy Skill source revision and
-- the Package artifacts produced after explicit review. Legacy rows are never mutated
-- by this table; a changed source hash produces a new mapping row.
CREATE TABLE IF NOT EXISTS skill_legacy_migrations (
  id TEXT PRIMARY KEY,
  legacy_skill_id TEXT NOT NULL,
  legacy_type TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL,
  status TEXT NOT NULL,
  package_id TEXT,
  package_version_id TEXT,
  report_artifact_id TEXT,
  owner_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  preview_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  side_effects_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE (legacy_skill_id, source_sha256),
  FOREIGN KEY (package_id) REFERENCES skill_packages(id),
  FOREIGN KEY (package_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (report_artifact_id) REFERENCES skill_artifacts(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_legacy_migrations_source
  ON skill_legacy_migrations(legacy_skill_id, source_sha256);
CREATE INDEX IF NOT EXISTS idx_skill_legacy_migrations_legacy_status
  ON skill_legacy_migrations(legacy_skill_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_skill_legacy_migrations_package
  ON skill_legacy_migrations(package_id, package_version_id);
