CREATE TABLE skill_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  base_version_id TEXT,
  published_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (base_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (published_version_id) REFERENCES skill_versions(id)
);

CREATE INDEX idx_skill_drafts_owner_status
  ON skill_drafts(owner_id, status, updated_at);

CREATE TABLE skill_version_snapshots (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  files_manifest_json TEXT NOT NULL DEFAULT '{}',
  total_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  snapshot_root TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (version_id) REFERENCES skill_versions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_version_snapshots_version
  ON skill_version_snapshots(version_id);

CREATE INDEX idx_skill_version_snapshots_hash
  ON skill_version_snapshots(snapshot_hash);

CREATE TABLE skill_version_diffs (
  id TEXT PRIMARY KEY,
  from_version_id TEXT NOT NULL,
  to_version_id TEXT NOT NULL,
  diff_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_version_id) REFERENCES skill_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (to_version_id) REFERENCES skill_versions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_version_diffs_versions
  ON skill_version_diffs(from_version_id, to_version_id);