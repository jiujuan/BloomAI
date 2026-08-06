ALTER TABLE skill_packages ADD COLUMN deleted_at INTEGER;
ALTER TABLE skill_packages ADD COLUMN delete_reason TEXT;

CREATE INDEX idx_skill_packages_deleted_at
  ON skill_packages(deleted_at);
