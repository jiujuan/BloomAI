ALTER TABLE research_runs ADD COLUMN model_selection_snapshot_json TEXT;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('deep_research_model', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
