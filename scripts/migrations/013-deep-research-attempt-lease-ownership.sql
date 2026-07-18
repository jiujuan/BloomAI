ALTER TABLE research_run_attempts ADD COLUMN ownership_token TEXT;
CREATE INDEX IF NOT EXISTS idx_research_run_attempts_ownership_token
  ON research_run_attempts(ownership_token);