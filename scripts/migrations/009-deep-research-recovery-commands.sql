CREATE TABLE IF NOT EXISTS research_recovery_commands (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  command_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  dispatch_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_recovery_commands_run_key
  ON research_recovery_commands(run_id, command_key);
