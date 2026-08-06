-- P2-003: durable waiting action lifecycle for resumable Package Skill runs.
ALTER TABLE skill_runs_v2 ADD COLUMN waiting_since INTEGER;
ALTER TABLE skill_runs_v2 ADD COLUMN waiting_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_skill_runs_v2_waiting_actions
  ON skill_runs_v2(status, waiting_expires_at);
