CREATE TABLE IF NOT EXISTS skill_capability_grants (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  grant_mode TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (skill_version_id) REFERENCES skill_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_skill_capability_grants_version ON skill_capability_grants(skill_version_id);
