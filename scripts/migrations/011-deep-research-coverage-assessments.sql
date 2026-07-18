ALTER TABLE research_coverage_assessments ADD COLUMN attempt_id TEXT;
ALTER TABLE research_coverage_assessments ADD COLUMN assessment_v2_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_coverage_assessments ADD COLUMN coverage_projections_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_research_coverage_assessments_run_attempt
  ON research_coverage_assessments(run_id, attempt_id, created_at DESC);
