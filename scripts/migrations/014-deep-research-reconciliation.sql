CREATE TABLE IF NOT EXISTS research_reconciliations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  reconciliation_key TEXT NOT NULL,
  checkpoint_key TEXT,
  outcome_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_reconciliations_run_key
  ON research_reconciliations(run_id, reconciliation_key);
CREATE INDEX IF NOT EXISTS idx_research_reconciliations_run_created
  ON research_reconciliations(run_id, created_at);
