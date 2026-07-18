ALTER TABLE research_sources ADD COLUMN original_url TEXT NOT NULL DEFAULT '';
ALTER TABLE research_search_queries ADD COLUMN result_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_research_source_snapshots_run_content_hash
  ON research_source_snapshots(run_id, content_hash);
