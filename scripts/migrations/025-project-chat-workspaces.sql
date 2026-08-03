CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  directory_kind TEXT NOT NULL CHECK (directory_kind IN ('auto', 'selected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path_unique
  ON projects(root_path COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_projects_updated
  ON projects(updated_at DESC);

ALTER TABLE sessions ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
  ON sessions(project_id, updated_at DESC);
