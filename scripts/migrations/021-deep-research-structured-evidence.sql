-- DRQ-07: durable, structured evidence fields. Defaults preserve legacy evidence rows.
ALTER TABLE research_evidence ADD COLUMN source_id TEXT NOT NULL DEFAULT '';
ALTER TABLE research_evidence ADD COLUMN claim TEXT NOT NULL DEFAULT '';
ALTER TABLE research_evidence ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'uncertain';
ALTER TABLE research_evidence ADD COLUMN entities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_evidence ADD COLUMN numbers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_evidence ADD COLUMN timeframe TEXT;
ALTER TABLE research_evidence ADD COLUMN relevance REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_research_evidence_run_source
  ON research_evidence(run_id, source_id);
