ALTER TABLE research_search_queries ADD COLUMN query_intent TEXT;
ALTER TABLE research_search_queries ADD COLUMN source_targets_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_search_queries ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_research_search_queries_run_question_dedupe
  ON research_search_queries(run_id, question_id, dedupe_key);
