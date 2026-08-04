-- Release B1: add the bounded filesystem tools to existing installations.
-- Contract synchronization in seedTools() supplies the canonical JSON schemas
-- after this migration has made the catalog rows available.
INSERT OR IGNORE INTO tools (
  id, category, name, description, params_schema, result_schema,
  is_builtin, is_enabled, requires_permission, created_at
) VALUES
  (
    'fs_stat', 'fs', 'File Stat',
    'Return bounded metadata for a local file, directory, or symlink.',
    '{"path":{"type":"string"}}',
    '{"path":{"type":"string"},"type":{"type":"string"},"size":{"type":"number"},"modifiedAt":{"type":"string"}}',
    1, 1, 'fs', strftime('%s','now') * 1000
  ),
  (
    'workspace_search', 'fs', 'Workspace Search',
    'Search approved workspace files by text or glob with bounded pagination.',
    '{"query":{"type":"string"},"mode":{"type":"string"}}',
    '{"mode":{"type":"string"},"results":{"type":"array"},"total":{"type":"number"}}',
    1, 1, 'fs', strftime('%s','now') * 1000
  );
