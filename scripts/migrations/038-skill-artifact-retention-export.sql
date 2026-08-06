ALTER TABLE skill_artifacts ADD COLUMN retention_until INTEGER;
ALTER TABLE skill_artifacts ADD COLUMN exported_at INTEGER;
ALTER TABLE skill_artifacts ADD COLUMN exported_by TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_retention
  ON skill_artifacts(retention_until, exported_at);
