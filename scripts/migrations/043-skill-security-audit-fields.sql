-- Security decisions and supply-chain findings for Skill Runtime imports and versions.
-- Existing rows receive conservative legacy defaults; nullable source_fingerprint preserves
-- historical audits that did not record a source hash.
ALTER TABLE skill_audit_events
  ADD COLUMN security_decision TEXT NOT NULL DEFAULT 'not_evaluated';

ALTER TABLE skill_audit_events
  ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE skill_audit_events
  ADD COLUMN source_fingerprint TEXT;

ALTER TABLE skill_import_reviews
  ADD COLUMN security_findings_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE skill_versions
  ADD COLUMN security_findings_json TEXT NOT NULL DEFAULT '{}';