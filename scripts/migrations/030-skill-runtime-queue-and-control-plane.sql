CREATE TABLE skill_run_queue (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_until INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES skill_runs_v2(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_run_queue_active_run
  ON skill_run_queue(run_id)
  WHERE status IN ('queued', 'leased', 'retry_wait');

CREATE INDEX idx_skill_run_queue_claim
  ON skill_run_queue(status, available_at, lease_until);

CREATE TABLE skill_import_reviews (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  source_ref TEXT,
  inspection_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  reviewer TEXT,
  decision TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_skill_import_reviews_source
  ON skill_import_reviews(source, source_sha, source_ref);

CREATE INDEX idx_skill_import_reviews_status
  ON skill_import_reviews(status, updated_at);

CREATE TABLE skill_audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_skill_audit_events_resource
  ON skill_audit_events(resource_type, resource_id, created_at);

CREATE INDEX idx_skill_audit_events_created
  ON skill_audit_events(created_at);