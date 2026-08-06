-- Image Studio links for Package Skill capability execution. The columns are nullable
-- so historical Image Studio sessions/generations remain readable.
--
-- Some historical databases never created Image Studio tables because they only ran
-- the numbered migration set. Create the legacy-compatible tables here when absent;
-- existing tables are left untouched and are upgraded by the compatibility bootstrap.
CREATE TABLE IF NOT EXISTS image_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新画图',
  default_model TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  skill_run_id TEXT,
  skill_version_id TEXT,
  grant_id TEXT
);

CREATE TABLE IF NOT EXISTS image_generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  prompt TEXT NOT NULL,
  resolved_prompt TEXT,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  aspect_ratio TEXT,
  style TEXT,
  size TEXT,
  seed INTEGER,
  reference_images TEXT,
  status TEXT NOT NULL,
  provider_task_id TEXT,
  progress INTEGER,
  url TEXT,
  local_path TEXT,
  error_msg TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  skill_run_id TEXT,
  skill_version_id TEXT,
  grant_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_image_sessions_skill_run
  ON image_sessions(skill_run_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_image_generations_skill_run
  ON image_generations(skill_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_generations_grant
  ON image_generations(grant_id, created_at);
