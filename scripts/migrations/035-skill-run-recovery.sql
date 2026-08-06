-- P1-004: persist restart, cancellation, and checkpoint recovery evidence.
ALTER TABLE skill_runs_v2 ADD COLUMN interrupted_at INTEGER;
ALTER TABLE skill_runs_v2 ADD COLUMN cancel_reason TEXT;
ALTER TABLE skill_runs_v2 ADD COLUMN last_checkpoint_json TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_runs_v2_recovery
  ON skill_runs_v2(status, interrupted_at, cancel_requested);
