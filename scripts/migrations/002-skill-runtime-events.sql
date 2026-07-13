CREATE TABLE IF NOT EXISTS skill_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES skill_runs_v2(id) ON DELETE CASCADE,
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_skill_run_events_run_seq ON skill_run_events(run_id, seq);
