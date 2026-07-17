-- DeepResearch Phase 2 resilience truth source. This migration is intentionally additive so
-- first-phase data remains readable and resumes conservatively from a planning fallback marker without claiming historical work completed.

ALTER TABLE research_runs ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN current_attempt_id TEXT;
ALTER TABLE research_runs ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE research_runs ADD COLUMN cancel_reason TEXT;
ALTER TABLE research_runs ADD COLUMN stop_reason_json TEXT;
ALTER TABLE research_runs ADD COLUMN limitations_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_runs ADD COLUMN workflow_version TEXT;
ALTER TABLE research_runs ADD COLUMN coverage_policy_version TEXT;
ALTER TABLE research_runs ADD COLUMN parser_version TEXT;
ALTER TABLE research_runs ADD COLUMN model_contract_version TEXT;
ALTER TABLE research_runs ADD COLUMN last_checkpoint_sequence INTEGER;

CREATE TABLE IF NOT EXISTS research_run_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  workflow_run_id TEXT,
  executor_id TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  start_checkpoint_key TEXT,
  end_checkpoint_key TEXT,
  error_code TEXT,
  error_category TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, ordinal),
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_run_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  checkpoint_key TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  resume_cursor_json TEXT NOT NULL DEFAULT '{}',
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT,
  replay_policy TEXT NOT NULL DEFAULT 'reuse',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES research_run_attempts(id) ON DELETE CASCADE,
  UNIQUE (attempt_id, sequence),
  UNIQUE (run_id, checkpoint_key, input_fingerprint)
);

CREATE TABLE IF NOT EXISTS research_iterations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  decision TEXT,
  target_question_ids_json TEXT NOT NULL DEFAULT '[]',
  coverage_before_json TEXT NOT NULL DEFAULT '{}',
  coverage_after_json TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT NOT NULL DEFAULT '{}',
  planned_query_count INTEGER NOT NULL DEFAULT 0,
  executed_query_count INTEGER NOT NULL DEFAULT 0,
  new_source_count INTEGER NOT NULL DEFAULT 0,
  new_evidence_count INTEGER NOT NULL DEFAULT 0,
  budget_before_json TEXT NOT NULL DEFAULT '{}',
  budget_after_json TEXT NOT NULL DEFAULT '{}',
  stop_reason_json TEXT,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS research_coverage_assessments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  iteration_id TEXT,
  iteration_ordinal INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  aggregate_score REAL NOT NULL DEFAULT 0,
  question_verdicts_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (iteration_id) REFERENCES research_iterations(id) ON DELETE SET NULL,
  UNIQUE (run_id, iteration_ordinal, policy_version, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_research_runs_current_attempt ON research_runs(current_attempt_id);
CREATE INDEX IF NOT EXISTS idx_research_runs_cancellation ON research_runs(cancel_requested_at);
CREATE INDEX IF NOT EXISTS idx_research_run_attempts_run_status ON research_run_attempts(run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_research_run_attempts_lease ON research_run_attempts(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_research_run_checkpoints_run_sequence ON research_run_checkpoints(run_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_research_run_checkpoints_attempt_status ON research_run_checkpoints(attempt_id, status, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_research_iterations_run_status ON research_iterations(run_id, status, ordinal);
CREATE INDEX IF NOT EXISTS idx_research_coverage_assessments_run_iteration ON research_coverage_assessments(run_id, iteration_ordinal, created_at DESC);
-- Phase 1 had no durable Attempt/Checkpoint history.  Record a deterministic,
-- audit-only legacy attempt for every extant Run and a completed fallback marker
-- whose cursor always restarts at planning.  The marker does not claim that any
-- former phase completed; retry_incomplete prevents reuse of unproven work.
INSERT INTO research_run_attempts (
  id, run_id, ordinal, trigger, status, workflow_run_id, executor_id,
  lease_expires_at, heartbeat_at, start_checkpoint_key, end_checkpoint_key,
  error_code, error_category, error_message, error_retryable,
  started_at, ended_at, created_at
)
SELECT
  'legacy:attempt:' || id,
  id,
  1,
  'initial',
  CASE
    WHEN status IN ('completed', 'completed_with_limitations') THEN 'succeeded'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'failed' THEN 'failed'
    WHEN status = 'cancelling' THEN 'cancelling'
    ELSE 'interrupted'
  END,
  workflow_run_id,
  executor_id,
  lease_expires_at,
  heartbeat_at,
  'legacy:resume_from_planning',
  NULL,
  error_code,
  NULL,
  error_message,
  error_retryable,
  created_at,
  CASE
    WHEN status IN ('completed', 'completed_with_limitations', 'cancelled', 'failed')
      THEN COALESCE(completed_at, updated_at)
    ELSE NULL
  END,
  created_at
FROM research_runs;

INSERT INTO research_run_checkpoints (
  id, run_id, attempt_id, sequence, checkpoint_key, phase, status,
  resume_cursor_json, input_fingerprint, output_fingerprint, replay_policy, created_at
)
SELECT
  'legacy:checkpoint:' || id,
  id,
  'legacy:attempt:' || id,
  1,
  'legacy:resume_from_planning',
  'planning',
  'completed',
  '{"version":1,"nextPhase":"planning","iteration":0}',
  'legacy:unknown',
  NULL,
  'retry_incomplete',
  created_at
FROM research_runs;

UPDATE research_runs
SET
  current_attempt_id = 'legacy:attempt:' || id,
  last_checkpoint_sequence = 1
WHERE current_attempt_id IS NULL;
