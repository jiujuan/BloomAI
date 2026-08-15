-- Retain the newest active package for each immutable source identity and preserve
-- older duplicate imports as archived audit history.
WITH ranked_packages AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY name, source_type, COALESCE(source_uri, ''), COALESCE(source_ref, '')
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM skill_packages
  WHERE deleted_at IS NULL
)
UPDATE skill_packages
SET
  deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  delete_reason = 'Superseded by newer duplicate import'
WHERE id IN (
  SELECT id
  FROM ranked_packages
  WHERE duplicate_rank > 1
);