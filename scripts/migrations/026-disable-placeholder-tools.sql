-- Release A0: placeholder executors must never be enabled by default.
-- Keep this migration runnable against databases created by the SQL migration
-- harness before the bootstrap schema has created the tool catalog.
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  params_schema TEXT NOT NULL DEFAULT '{}',
  result_schema TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER DEFAULT 1,
  is_enabled INTEGER DEFAULT 1,
  requires_permission TEXT,
  created_at INTEGER NOT NULL
);

UPDATE tools
SET is_enabled = 0
WHERE is_builtin = 1
  AND id IN ('web_screenshot', 'ocr', 'image_edit');
