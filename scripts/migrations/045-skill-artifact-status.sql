-- Track artifact processing state and bind artifacts to the immutable Skill Version used by their Run.
ALTER TABLE skill_artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE skill_artifacts ADD COLUMN skill_version_id TEXT;

UPDATE skill_artifacts
SET skill_version_id = (
  SELECT skill_version_id
  FROM skill_runs_v2
  WHERE skill_runs_v2.id = skill_artifacts.run_id
)
WHERE skill_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_version
  ON skill_artifacts(skill_version_id);
