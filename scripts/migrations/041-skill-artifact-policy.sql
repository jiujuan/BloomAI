ALTER TABLE skill_artifacts ADD COLUMN artifact_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE skill_artifacts ADD COLUMN relative_path TEXT NOT NULL DEFAULT '';

UPDATE skill_artifacts
SET artifact_kind = kind
WHERE artifact_kind = 'unknown' OR artifact_kind IS NULL;

UPDATE skill_artifacts
SET relative_path = path
WHERE relative_path = '' OR relative_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_run_created
  ON skill_artifacts(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_retention
  ON skill_artifacts(retention_until, exported_at);
