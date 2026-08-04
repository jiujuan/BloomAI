-- A1: session grants are process-local; durable grants are permanent-only.
DELETE FROM tool_permissions
WHERE id NOT IN (
  SELECT id
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY tool_id
        ORDER BY COALESCE(granted_at, 0) DESC, id DESC
      ) AS row_number
    FROM tool_permissions
  )
  WHERE row_number = 1
);

UPDATE tool_permissions
SET granted = CASE WHEN scope = 'permanent' THEN granted ELSE 0 END,
    scope = 'permanent';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_permissions_unique_tool_id
ON tool_permissions(tool_id);
