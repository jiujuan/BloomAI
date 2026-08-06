-- P1-001: persistent run state-machine fields. The migration runner records
-- this file before any worker/API is allowed to rely on the columns.
ALTER TABLE skill_runs_v2 ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE skill_runs_v2 ADD COLUMN current_step TEXT;
ALTER TABLE skill_runs_v2 ADD COLUMN required_action_json TEXT;
ALTER TABLE skill_runs_v2 ADD COLUMN worker_id TEXT;
ALTER TABLE skill_runs_v2 ADD COLUMN heartbeat_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_skill_runs_v2_active_worker
  ON skill_runs_v2(status, worker_id, heartbeat_at);