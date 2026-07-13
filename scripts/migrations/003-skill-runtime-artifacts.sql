CREATE TABLE IF NOT EXISTS skill_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime_type TEXT,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES skill_runs_v2(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_run ON skill_artifacts(run_id);
