-- Persist the publish idempotency boundary and the immutable result of the
-- first successful Creator publish. Keeping both values on the Draft lets a
-- retry return the original Package/Version/Snapshot/Installation without
-- creating a second Package.
ALTER TABLE skill_drafts
  ADD COLUMN publish_idempotency_key TEXT;

ALTER TABLE skill_drafts
  ADD COLUMN publish_result_json TEXT NOT NULL DEFAULT '{}';
