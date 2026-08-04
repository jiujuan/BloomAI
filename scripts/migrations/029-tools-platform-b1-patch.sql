-- Release B1 PR-12: register the safe unified-diff patch tool.
-- Actual writes remain gated by the capability broker and trusted approval chain.
INSERT OR IGNORE INTO tools (
  id, category, name, description, params_schema, result_schema,
  is_builtin, is_enabled, requires_permission, created_at
) VALUES (
  'fs_apply_patch',
  'fs',
  'Apply Patch',
  'Preview or apply a bounded unified diff inside an approved workspace root.',
  '{"patch":{"type":"string"},"root":{"type":"string"},"dryRun":{"type":"boolean","default":true},"createBackup":{"type":"boolean","default":true}}',
  '{"dryRun":{"type":"boolean"},"applied":{"type":"boolean"},"files":{"type":"array"},"modifiedFiles":{"type":"array"},"conflicts":{"type":"array"},"backupPaths":{"type":"array"},"rollbackToken":{"type":"string"}}',
  1,
  1,
  'write',
  strftime('%s','now') * 1000
);
