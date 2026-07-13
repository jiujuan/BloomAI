ALTER TABLE skill_capability_grants ADD COLUMN session_id TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN consumed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_skill_capability_grants_active
  ON skill_capability_grants(skill_version_id, capability, session_id);
