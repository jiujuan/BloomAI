-- P1-003: persist execution metrics required by worker/adapter observability.
ALTER TABLE skill_runs_v2 ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'instruction-agent';
ALTER TABLE skill_runs_v2 ADD COLUMN step_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_runs_v2 ADD COLUMN token_usage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_runs_v2 ADD COLUMN last_heartbeat_at INTEGER;
ALTER TABLE skill_runs_v2 ADD COLUMN result_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_runs_v2_execution_metrics
  ON skill_runs_v2(status, last_heartbeat_at, step_count);
