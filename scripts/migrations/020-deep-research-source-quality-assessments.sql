CREATE TABLE IF NOT EXISTS research_source_assessments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  canonical_url TEXT,
  original_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  source_category TEXT NOT NULL,
  scoring_method TEXT NOT NULL,
  score_breakdown_json TEXT NOT NULL DEFAULT '{}',
  assessment_reasons_json TEXT NOT NULL DEFAULT '[]',
  rejection_reasons_json TEXT NOT NULL DEFAULT '[]',
  selection_status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES research_questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_source_assessments_run_question
  ON research_source_assessments(run_id, question_id, selection_status);

CREATE INDEX IF NOT EXISTS idx_research_source_assessments_run_query
  ON research_source_assessments(run_id, query_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_source_assessments_run_candidate
  ON research_source_assessments(run_id, candidate_key);