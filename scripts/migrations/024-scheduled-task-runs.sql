CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  trigger_fired_at INTEGER NOT NULL,
  mastra_run_id TEXT,
  trigger_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  output_text TEXT,
  error_message TEXT,
  usage_json TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_task_runs_schedule_trigger_unique
  ON scheduled_task_runs(schedule_id, trigger_fired_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_schedule_trigger
  ON scheduled_task_runs(schedule_id, trigger_fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status_created
  ON scheduled_task_runs(status, created_at DESC);
