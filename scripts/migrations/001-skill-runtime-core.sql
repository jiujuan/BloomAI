CREATE TABLE IF NOT EXISTS skill_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT 'instruction-agent',
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  package_path TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  is_compatible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (package_id) REFERENCES skill_packages(id),
  UNIQUE (package_id, version, manifest_hash)
);

CREATE TABLE IF NOT EXISTS skill_installations (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (package_id) REFERENCES skill_packages(id),
  FOREIGN KEY (current_version_id) REFERENCES skill_versions(id)
);

CREATE TABLE IF NOT EXISTS skill_runs_v2 (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  surface TEXT,
  session_id TEXT,
  image_session_id TEXT,
  waiting_reason TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (skill_version_id) REFERENCES skill_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_package ON skill_versions(package_id);
CREATE INDEX IF NOT EXISTS idx_skill_installations_package ON skill_installations(package_id);
CREATE INDEX IF NOT EXISTS idx_skill_runs_v2_version ON skill_runs_v2(skill_version_id);
