ALTER TABLE research_questions ADD COLUMN section_key TEXT;
ALTER TABLE research_questions ADD COLUMN question_type TEXT;
ALTER TABLE research_questions ADD COLUMN need_primary_source INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_questions ADD COLUMN need_recent_source INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_questions ADD COLUMN need_quantitative_evidence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_questions ADD COLUMN source_targets_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_research_questions_run_section_ordinal ON research_questions(run_id, section_key, ordinal);

ALTER TABLE research_report_sections ADD COLUMN section_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_report_sections_run_section_key ON research_report_sections(run_id, section_key);

CREATE TABLE IF NOT EXISTS research_report_section_questions (
  section_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (section_id, question_id),
  UNIQUE (section_id, ordinal),
  FOREIGN KEY (section_id) REFERENCES research_report_sections(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES research_questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_report_section_questions_question ON research_report_section_questions(question_id);
