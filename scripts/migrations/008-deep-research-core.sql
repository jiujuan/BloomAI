CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  topic TEXT NOT NULL,
  profile TEXT NOT NULL,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL,
  brief_json TEXT,
  budget_json TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  quality_json TEXT,
  workflow_run_id TEXT,
  report_artifact_id TEXT,
  resume_phase TEXT,
  executor_id TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS research_questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_question_id TEXT,
  ordinal INTEGER NOT NULL,
  question TEXT NOT NULL,
  intent TEXT NOT NULL,
  required_evidence_types_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_question_id) REFERENCES research_questions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS research_search_queries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  query TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES research_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  author TEXT,
  publisher TEXT,
  published_at INTEGER,
  source_type TEXT NOT NULL,
  selection_status TEXT NOT NULL,
  scores_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_source_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  final_url TEXT NOT NULL,
  http_status INTEGER,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES research_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  passage TEXT NOT NULL,
  summary TEXT NOT NULL,
  stance TEXT NOT NULL,
  confidence REAL NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES research_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES research_source_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_report_sections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  draft TEXT,
  verified_text TEXT,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_claims (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  importance TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence REAL NOT NULL,
  repair_history_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES research_report_sections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_citations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  entailment_status TEXT NOT NULL,
  rationale TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES research_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES research_evidence(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_quality_assessments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_status TEXT NOT NULL,
  high_priority_question_coverage REAL NOT NULL,
  factual_claim_citation_coverage REAL NOT NULL,
  supported_citation_coverage REAL NOT NULL,
  independent_cited_domain_count INTEGER NOT NULL,
  contradiction_disclosure_coverage REAL NOT NULL,
  required_section_coverage REAL NOT NULL,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  assessor_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  phase TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_runs_status_updated
  ON research_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_research_questions_run_parent_ordinal
  ON research_questions(run_id, parent_question_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_research_search_queries_run_status
  ON research_search_queries(run_id, status);
CREATE INDEX IF NOT EXISTS idx_research_sources_run_selection
  ON research_sources(run_id, selection_status);
CREATE INDEX IF NOT EXISTS idx_research_evidence_run_question
  ON research_evidence(run_id, question_id);
CREATE INDEX IF NOT EXISTS idx_research_report_sections_run_ordinal
  ON research_report_sections(run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_research_claims_run_section
  ON research_claims(run_id, section_id);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_run_type
  ON research_artifacts(run_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_search_queries_run_idempotency
  ON research_search_queries(run_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_sources_run_canonical_url
  ON research_sources(run_id, canonical_url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_source_snapshots_run_idempotency
  ON research_source_snapshots(run_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_evidence_run_idempotency
  ON research_evidence(run_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_report_sections_run_idempotency
  ON research_report_sections(run_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_claims_run_idempotency
  ON research_claims(run_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_citations_run_ordinal
  ON research_citations(run_id, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_events_run_sequence
  ON research_events(run_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_artifacts_run_idempotency
  ON research_artifacts(run_id, idempotency_key);
