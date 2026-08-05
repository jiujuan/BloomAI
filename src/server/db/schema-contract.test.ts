import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSchemaContract, getExpectedSchemaContract } from './schema-contract'
import { getAppliedMigrationVersions, loadSqlMigrations, runSqlMigrations } from './migrations'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

describe('skill runtime schema contract', () => {
  let db: InstanceType<typeof DatabaseSync>

  afterEach(() => db?.close())

  function createLegacyMigrationPrerequisites() {
    db.exec(`
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

  it('matches the numbered migrations on a clean database', () => {
    db = new DatabaseSync(':memory:')
    createLegacyMigrationPrerequisites()
    runSqlMigrations(db)

    expect(getAppliedMigrationVersions(db)).toEqual(loadSqlMigrations().map((migration) => migration.version))
    expect(Object.keys(getExpectedSchemaContract().tables)).toContain('skill_run_queue')
    expect(Object.keys(getExpectedSchemaContract().tables)).toContain('skill_drafts')
    expect(() => assertSchemaContract(db)).not.toThrow()
  })

  it('fails when a required column is removed', () => {
    db = new DatabaseSync(':memory:')
    createLegacyMigrationPrerequisites()
    runSqlMigrations(db)
    db.exec('ALTER TABLE skill_drafts DROP COLUMN validation_json')

    expect(() => assertSchemaContract(db)).toThrow(/missing column skill_drafts\.validation_json/)
  })

  it('fails when a required index is removed', () => {
    db = new DatabaseSync(':memory:')
    createLegacyMigrationPrerequisites()
    runSqlMigrations(db)
    db.exec('DROP INDEX idx_skill_run_queue_claim')

    expect(() => assertSchemaContract(db)).toThrow(/missing index idx_skill_run_queue_claim on skill_run_queue/)
  })
})