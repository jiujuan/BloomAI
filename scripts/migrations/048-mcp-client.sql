-- MCP client persistence: servers, discovered tool catalog, and auditable tool runs.
-- Secrets are persisted only as references; resolved values must never enter SQLite.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport_kind TEXT NOT NULL
    CHECK (transport_kind IN ('stdio', 'streamable_http')),
  config_json TEXT NOT NULL,
  secret_refs_json TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  trust_level TEXT NOT NULL DEFAULT 'untrusted'
    CHECK (trust_level IN ('untrusted', 'reviewed', 'trusted')),
  connection_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (connection_status IN ('unknown', 'healthy', 'error', 'disabled')),
  catalog_version INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_server_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  remote_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  output_schema_json TEXT,
  schema_hash TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  is_removed INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  risk_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  discovered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER,

  FOREIGN KEY (server_id) REFERENCES mcp_servers(id)
);

CREATE TABLE IF NOT EXISTS mcp_tool_runs (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  remote_name TEXT NOT NULL,
  session_id TEXT,
  agent_role TEXT,
  status TEXT NOT NULL
    CHECK (status IN (
      'pending_approval', 'running', 'success', 'error',
      'denied', 'cancelled'
    )),
  input_hash TEXT NOT NULL,
  safe_input_json TEXT,
  safe_output_json TEXT,
  error_code TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id),
  FOREIGN KEY (tool_id) REFERENCES mcp_server_tools(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_server_tools_server_remote
  ON mcp_server_tools(server_id, remote_name);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_catalog_version
  ON mcp_servers(catalog_version);

CREATE INDEX IF NOT EXISTS idx_mcp_server_tools_catalog
  ON mcp_server_tools(server_id, is_removed, is_enabled, updated_at);

CREATE INDEX IF NOT EXISTS idx_mcp_server_tools_schema_hash
  ON mcp_server_tools(server_id, schema_hash);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_runs_server_created
  ON mcp_tool_runs(server_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_runs_tool_created
  ON mcp_tool_runs(tool_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_runs_status_created
  ON mcp_tool_runs(status, created_at);
