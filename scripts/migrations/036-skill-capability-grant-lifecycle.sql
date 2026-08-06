-- Capability grant lifecycle forward-fix. Existing 004/005 rows remain readable;
-- legacy scope/grants are treated as approved grants by the compatibility default.
ALTER TABLE skill_capability_grants ADD COLUMN requested_scope_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE skill_capability_grants ADD COLUMN granted_scope_json TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE skill_capability_grants ADD COLUMN approved_by TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN approved_at INTEGER;
ALTER TABLE skill_capability_grants ADD COLUMN revoke_reason TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN run_id TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN owner_id TEXT;
ALTER TABLE skill_capability_grants ADD COLUMN max_calls INTEGER;
ALTER TABLE skill_capability_grants ADD COLUMN calls_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_capability_grants ADD COLUMN idempotency_key TEXT;

UPDATE skill_capability_grants
SET requested_scope_json = scope_json,
    granted_scope_json = scope_json,
    status = CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN consumed_at IS NOT NULL THEN 'consumed' ELSE 'approved' END,
    approved_by = granted_by,
    approved_at = granted_at
WHERE requested_scope_json = '{}';

CREATE INDEX IF NOT EXISTS idx_skill_capability_grants_run
  ON skill_capability_grants(run_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_capability_grants_idempotency
  ON skill_capability_grants(run_id, idempotency_key)
  WHERE run_id IS NOT NULL AND idempotency_key IS NOT NULL;
