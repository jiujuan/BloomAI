import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSqlMigrations, runSqlMigrations } from '../../src/server/db/migrations'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type Db = InstanceType<typeof DatabaseSync>

function createSkillPackagesTable(db: Db) {
  db.exec(`
    CREATE TABLE skill_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL,
      source_uri TEXT,
      source_ref TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      delete_reason TEXT
    );
  `)
}

describe('Skill package deduplication migration 049', () => {
  let db: Db | undefined

  afterEach(() => db?.close())

  it('retains the latest active logical package and archives only its older duplicates', () => {
    db = new DatabaseSync(':memory:')
    createSkillPackagesTable(db)
    const insert = db.prepare(`
      INSERT INTO skill_packages (
        id, name, description, source_type, source_uri, source_ref, created_at, updated_at, deleted_at, delete_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run('article-old', 'article', '', 'github-archive', 'https://github.com/example/skills', 'commit-a', 100, 100, null, null)
    insert.run('article-new', 'article', '', 'github-archive', 'https://github.com/example/skills', 'commit-a', 200, 200, null, null)
    insert.run('article-other-ref', 'article', '', 'github-archive', 'https://github.com/example/skills', 'commit-b', 300, 300, null, null)
    insert.run('research', 'research', '', 'github-archive', 'https://github.com/example/skills', 'commit-a', 400, 400, null, null)

    const migration = loadSqlMigrations().find((entry) => entry.version === '049-deduplicate-active-skill-packages')
    expect(migration).toBeDefined()
    runSqlMigrations(db, [migration!])

    const packages = db.prepare(`
      SELECT id, deleted_at, delete_reason
      FROM skill_packages
      ORDER BY id
    `).all() as Array<{ id: string; deleted_at: number | null; delete_reason: string | null }>
    expect(packages).toEqual([
      { id: 'article-new', deleted_at: null, delete_reason: null },
      { id: 'article-old', deleted_at: expect.any(Number), delete_reason: 'Superseded by newer duplicate import' },
      { id: 'article-other-ref', deleted_at: null, delete_reason: null },
      { id: 'research', deleted_at: null, delete_reason: null },
    ])
  })
})