CREATE TABLE IF NOT EXISTS article_illustration_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  article_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  skill_version_id TEXT,
  run_id TEXT,
  image_session_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'waiting_approval',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (skill_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (run_id) REFERENCES skill_runs_v2(id),
  FOREIGN KEY (image_session_id) REFERENCES image_sessions(id)
);

CREATE TABLE IF NOT EXISTS article_illustration_scenes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  generation_id TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES article_illustration_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES image_generations(id),
  UNIQUE (job_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_article_illustration_jobs_status_updated
  ON article_illustration_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_article_illustration_scenes_job_ordinal
  ON article_illustration_scenes(job_id, ordinal);