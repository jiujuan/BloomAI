import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadClient() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  return await import('./client')
}

function openRawDb() {
  return new DatabaseSync(path.join(dataDir, 'bloomai.db'))
}

function tableNames() {
  const db = openRawDb()
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row: any) => row.name)
  } finally {
    db.close()
  }
}

function migrationVersions() {
  const db = openRawDb()
  try {
    return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row: any) => row.version)
  } finally {
    db.close()
  }
}

function uniqueIndexColumnSets(tableName: string): string[][] {
  const db = openRawDb()
  try {
    return db
      .prepare(`PRAGMA index_list(${tableName})`)
      .all()
      .filter((row: any) => row.unique === 1)
      .map((row: any) =>
        db
          .prepare(`PRAGMA index_info(${row.name})`)
          .all()
          .sort((left: any, right: any) => left.seqno - right.seqno)
          .map((column: any) => column.name)
      )
  } finally {
    db.close()
  }
}


function foreignKeyActions(tableName: string) {
  const db = openRawDb()
  try {
    return db.prepare(`PRAGMA foreign_key_list(${tableName})`).all().map((row: any) => ({
      from: row.from,
      table: row.table,
      onDelete: row.on_delete,
    }))
  } finally {
    db.close()
  }
}

describe('database migrations', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-db-migrations-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('./client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('migrates an empty database and records each migration once', async () => {
    const client = await loadClient()

    await client.runMigrations()
    await client.runMigrations()

    expect(tableNames()).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'skill_packages',
        'skill_versions',
        'skill_installations',
        'skill_runs_v2',
        'skill_run_events',
        'skill_artifacts',
        'skill_capability_grants',
        'research_runs',
        'research_questions',
        'research_search_queries',
        'research_sources',
        'research_source_snapshots',
        'research_evidence',
        'research_report_sections',
        'research_claims',
        'research_citations',
        'research_quality_assessments',
        'research_events',
        'research_artifacts',
      ])
    )
    expect(migrationVersions()).toEqual([
      '001-skill-runtime-core',
      '002-skill-runtime-events',
      '003-skill-runtime-artifacts',
      '004-skill-capability-grants',
      '005-skill-capability-grant-state',
      '006-skill-run-commands',
      '007-article-illustration-jobs',
      '008-deep-research-core',
    ])

    expect(uniqueIndexColumnSets('research_events')).toContainEqual(['run_id', 'sequence'])
    expect(uniqueIndexColumnSets('research_sources')).toContainEqual(['run_id', 'canonical_url'])

    for (const tableName of [
      'research_search_queries',
      'research_source_snapshots',
      'research_evidence',
      'research_report_sections',
      'research_claims',
      'research_artifacts',
    ]) {
      expect(uniqueIndexColumnSets(tableName)).toContainEqual(['run_id', 'idempotency_key'])
    }

    for (const tableName of [
      'research_questions',
      'research_search_queries',
      'research_sources',
      'research_source_snapshots',
      'research_evidence',
      'research_report_sections',
      'research_claims',
      'research_citations',
      'research_quality_assessments',
      'research_events',
      'research_artifacts',
    ]) {
      expect(foreignKeyActions(tableName)).toContainEqual({
        from: 'run_id',
        table: 'research_runs',
        onDelete: 'CASCADE',
      })
    }
  })

  it('upgrades a database that only has legacy skill tables', async () => {
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
          type TEXT NOT NULL, source TEXT NOT NULL, params_schema TEXT NOT NULL DEFAULT '{}',
          author TEXT, version TEXT DEFAULT '1.0.0', is_public INTEGER DEFAULT 0,
          is_installed INTEGER DEFAULT 1, install_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL
        );
        CREATE TABLE skill_runs (
          id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, input_json TEXT NOT NULL,
          output_json TEXT, status TEXT NOT NULL, duration_ms INTEGER, created_at INTEGER NOT NULL
        );
        INSERT INTO skills (id, name, description, type, source, created_at)
        VALUES ('legacy-1', 'Legacy', 'Old skill', 'js-function', 'function run(input) { return input }', 1);
      `)
    } finally {
      db.close()
    }

    const client = await loadClient()
    await client.runMigrations()
    const { skillRepo } = await import('./repositories/skill.repo')

    expect(skillRepo.get('legacy-1')?.name).toBe('Legacy')
    expect(tableNames()).toContain('skill_runs_v2')
  })

  it('rolls back a failed migration and does not record it', async () => {
    const { runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      expect(() =>
        runSqlMigrations(db, [
          {
            version: '999-fails',
            sql: `
              CREATE TABLE rollback_probe (id TEXT PRIMARY KEY);
              INSERT INTO missing_table VALUES (1);
            `,
          },
        ])
      ).toThrow()

      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: any) => row.name)
      expect(names).not.toContain('rollback_probe')
      expect(db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get()).toEqual({ c: 0 })
    } finally {
      db.close()
    }
  })
})
