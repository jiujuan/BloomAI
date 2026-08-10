import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSqlMigrations, runSqlMigrations } from '../../src/server/db/migrations'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type Db = InstanceType<typeof DatabaseSync>

function columns(db: Db, table: string): any[] {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as any[]
}

function column(db: Db, table: string, name: string): any {
  return columns(db, table).find((row) => row.name === name)
}

function indexColumns(db: Db, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as any[])
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((row) => String(row.name))
}

describe('MCP migration 048', () => {
  let db: Db | undefined

  afterEach(() => db?.close())

  it('is the next ordered migration and does not reuse an existing prefix', () => {
    const migrations = loadSqlMigrations()
    const versions = migrations.map((migration) => migration.version)
    const prefixes = versions.map((version) => Number(/^\d+/.exec(version)?.[0]))

    expect(migrations).toHaveLength(48)
    expect(versions.at(-1)).toBe('048-mcp-client')
    expect(versions.indexOf('047-legacy-migration-archive-and-gates')).toBeLessThan(versions.indexOf('048-mcp-client'))
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('creates the three MCP tables idempotently with required defaults, checks, indexes, and foreign keys', () => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const migration = loadSqlMigrations().find((entry) => entry.version === '048-mcp-client')
    expect(migration).toBeDefined()

    runSqlMigrations(db, [migration!])
    expect(() => db!.exec(migration!.sql)).not.toThrow()
    runSqlMigrations(db, [migration!])

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mcp_%' ORDER BY name").all())
      .toEqual([
        { name: 'mcp_server_tools' },
        { name: 'mcp_servers' },
        { name: 'mcp_tool_runs' },
      ])

    expect(column(db, 'mcp_servers', 'is_enabled')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(column(db, 'mcp_servers', 'trust_level')).toMatchObject({ notnull: 1, dflt_value: "'untrusted'" })
    expect(column(db, 'mcp_servers', 'connection_status')).toMatchObject({ notnull: 1, dflt_value: "'unknown'" })
    expect(column(db, 'mcp_servers', 'catalog_version')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(column(db, 'mcp_server_tools', 'is_enabled')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(column(db, 'mcp_server_tools', 'is_removed')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(column(db, 'mcp_server_tools', 'requires_approval')).toMatchObject({ notnull: 1, dflt_value: '1' })
    expect(column(db, 'mcp_server_tools', 'risk_level')).toMatchObject({ notnull: 1, dflt_value: "'medium'" })

    expect(indexColumns(db, 'idx_mcp_servers_catalog_version')).toEqual(['catalog_version'])
    expect(indexColumns(db, 'idx_mcp_server_tools_catalog')).toEqual(['server_id', 'is_removed', 'is_enabled', 'updated_at'])
    expect(indexColumns(db, 'idx_mcp_server_tools_schema_hash')).toEqual(['server_id', 'schema_hash'])
    expect(indexColumns(db, 'idx_mcp_tool_runs_server_created')).toEqual(['server_id', 'created_at'])
    expect(indexColumns(db, 'idx_mcp_tool_runs_tool_created')).toEqual(['tool_id', 'created_at'])
    expect(indexColumns(db, 'idx_mcp_tool_runs_status_created')).toEqual(['status', 'created_at'])

    const uniqueIndexes = (db.prepare('PRAGMA index_list("mcp_server_tools")').all() as any[]).filter((row) => Number(row.unique) === 1)
    expect(uniqueIndexes.some((index) => indexColumns(db!, String(index.name)).join(',') === 'server_id,remote_name')).toBe(true)

    expect(db.prepare('PRAGMA foreign_key_list("mcp_server_tools")').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'mcp_servers', from: 'server_id', to: 'id' }),
    ]))
    expect(db.prepare('PRAGMA foreign_key_list("mcp_tool_runs")').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'mcp_servers', from: 'server_id', to: 'id' }),
      expect.objectContaining({ table: 'mcp_server_tools', from: 'tool_id', to: 'id' }),
    ]))
  })

  it('enforces transport, trust, risk, run status, uniqueness, and foreign-key boundaries', () => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const migration = loadSqlMigrations().find((entry) => entry.version === '048-mcp-client')!
    db.exec(migration.sql)

    db.prepare(`
      INSERT INTO mcp_servers (id, name, transport_kind, config_json, secret_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('server-1', 'Server', 'stdio', '{}', '[]', 1, 1)

    expect(() => db!.prepare(`
      INSERT INTO mcp_servers (id, name, transport_kind, config_json, secret_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('server-invalid-transport', 'Server', 'sse', '{}', '[]', 1, 1)).toThrow()
    expect(() => db!.prepare(`UPDATE mcp_servers SET trust_level = 'unsafe' WHERE id = 'server-1'`).run()).toThrow()

    const toolInsert = db.prepare(`
      INSERT INTO mcp_server_tools (
        id, server_id, remote_name, name, description, input_schema_json, schema_hash, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    toolInsert.run('tool-1', 'server-1', 'search', 'Search', 'Search tool', '{}', 'hash-1', 1, 1)
    expect(() => toolInsert.run('tool-2', 'server-1', 'search', 'Duplicate', 'Duplicate tool', '{}', 'hash-2', 1, 1)).toThrow()
    expect(() => db!.prepare(`
      INSERT INTO mcp_server_tools (
        id, server_id, remote_name, name, description, input_schema_json, schema_hash, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('tool-invalid-server', 'missing', 'x', 'X', 'X', '{}', 'hash', 1, 1)).toThrow()
    expect(() => db!.prepare(`UPDATE mcp_server_tools SET risk_level = 'critical' WHERE id = 'tool-1'`).run()).toThrow()

    const runInsert = db.prepare(`
      INSERT INTO mcp_tool_runs (id, server_id, tool_id, remote_name, status, input_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    runInsert.run('run-1', 'server-1', 'tool-1', 'search', 'pending_approval', 'input-hash', 1)
    expect(() => runInsert.run('run-invalid-status', 'server-1', 'tool-1', 'search', 'queued', 'hash', 1)).toThrow()
    expect(() => runInsert.run('run-invalid-tool', 'server-1', 'missing-tool', 'search', 'running', 'hash', 1)).toThrow()
  })
})
