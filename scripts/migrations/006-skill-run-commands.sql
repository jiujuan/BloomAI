CREATE TABLE IF NOT EXISTS skill_run_commands (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES skill_runs_v2(id) ON DELETE CASCADE,
  UNIQUE (run_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_skill_run_commands_run ON skill_run_commands(run_id, created_at);
