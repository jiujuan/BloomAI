ALTER TABLE skill_versions ADD COLUMN immutable_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE skill_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'runnable';
ALTER TABLE skill_versions ADD COLUMN security_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE skill_versions ADD COLUMN snapshot_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE skill_versions ADD COLUMN published_at INTEGER;

ALTER TABLE skill_installations ADD COLUMN previous_version_id TEXT;
ALTER TABLE skill_installations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_installations ADD COLUMN changed_at INTEGER;
ALTER TABLE skill_installations ADD COLUMN disabled_at INTEGER;
ALTER TABLE skill_installations ADD COLUMN uninstalled_at INTEGER;
ALTER TABLE skill_installations ADD COLUMN deleted_at INTEGER;
ALTER TABLE skill_installations ADD COLUMN rollback_reason TEXT;

CREATE INDEX idx_skill_versions_immutable_hash
  ON skill_versions(package_id, immutable_hash);
CREATE INDEX idx_skill_installations_current_version
  ON skill_installations(current_version_id);


CREATE TABLE skill_installation_commands (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES skill_installations(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (installation_id, idempotency_key)
);

CREATE INDEX idx_skill_installation_commands_installation
  ON skill_installation_commands(installation_id, created_at);

CREATE INDEX idx_skill_installation_commands_idempotency
  ON skill_installation_commands(installation_id, idempotency_key);
