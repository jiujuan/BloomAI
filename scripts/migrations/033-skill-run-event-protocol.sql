ALTER TABLE skill_run_events ADD COLUMN producer TEXT NOT NULL DEFAULT 'runtime';
ALTER TABLE skill_run_events ADD COLUMN occurred_at INTEGER NOT NULL DEFAULT 0;
UPDATE skill_run_events SET occurred_at = created_at WHERE occurred_at = 0;
CREATE INDEX IF NOT EXISTS idx_skill_run_events_run_occurred ON skill_run_events(run_id, occurred_at, seq);