import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSchemaContract, getExpectedSchemaContract } from './schema-contract'
import { loadSqlMigrations, runSqlMigrations } from './migrations'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type Db = InstanceType<typeof DatabaseSync>

describe('MCP database schema contract', () => {
  let db: Db | undefined

  afterEach(() => db?.close())

  function createLegacyMigrationPrerequisites() {
    db!.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Chat',
        persona_id TEXT, model TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
        status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE tool_permissions (
        id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, granted INTEGER DEFAULT 0,
        granted_at INTEGER, scope TEXT DEFAULT 'session'
      );
    `)
  }

  it('declares all MCP tables, columns, indexes, unique constraints, and foreign keys', () => {
    const contract = getExpectedSchemaContract()
    expect(contract.tables).toHaveProperty('mcp_servers')
    expect(contract.tables).toHaveProperty('mcp_server_tools')
    expect(contract.tables).toHaveProperty('mcp_tool_runs')
    expect(contract.tables.mcp_server_tools.uniqueConstraints).toContainEqual(['server_id', 'remote_name'])
    expect(contract.tables.mcp_server_tools.indexes).toHaveProperty('idx_mcp_server_tools_schema_hash')
    expect(contract.tables.mcp_tool_runs.indexes).toHaveProperty('idx_mcp_tool_runs_server_created')
    expect(contract.tables.mcp_server_tools.foreignKeys).toContainEqual({ from: 'server_id', table: 'mcp_servers', to: 'id' })
    expect(contract.tables.mcp_tool_runs.foreignKeys).toContainEqual({ from: 'tool_id', table: 'mcp_server_tools', to: 'id' })
  })

  it('matches migration 048 on a clean database and catches removed MCP indexes', () => {
    db = new DatabaseSync(':memory:')
    createLegacyMigrationPrerequisites()
    runSqlMigrations(db)

    expect(() => assertSchemaContract(db!)).not.toThrow()
    db.exec('DROP INDEX idx_mcp_tool_runs_server_created')
    expect(() => assertSchemaContract(db!)).toThrow(/missing index idx_mcp_tool_runs_server_created on mcp_tool_runs/)
  })
})
