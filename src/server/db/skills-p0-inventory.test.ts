import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
import { collectSkillsDbInventory } from '../../../scripts/skills/p0-db-inventory'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Skills Admin P0 database inventory', () => {
  it('reports schema, counts, foreign-key/orphan checks and blocks Legacy table deletion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p0-db-'))
    temporaryRoots.push(root)
    const databasePath = path.join(root, 'bloomai.db')
    const db = new DatabaseSync(databasePath)
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE skills (id TEXT PRIMARY KEY);
      CREATE TABLE skill_runs (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, FOREIGN KEY(skill_id) REFERENCES skills(id));
      CREATE TABLE skill_packages (id TEXT PRIMARY KEY);
      CREATE TABLE skill_versions (id TEXT PRIMARY KEY, package_id TEXT NOT NULL, FOREIGN KEY(package_id) REFERENCES skill_packages(id));
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO skills VALUES ('legacy-1');
      INSERT INTO skill_runs VALUES ('run-1', 'legacy-1');
      INSERT INTO schema_migrations VALUES ('044-legacy-skill-migration-records.sql', 1);
    `)
    db.close()

    const result = collectSkillsDbInventory({ databasePath, createBackup: false })
    expect(result.databasePath).toBe(databasePath)
    expect(result.tables.find((table) => table.name === 'skills')?.rowCount).toBe(1)
    expect(result.migrations.latestApplied).toBe('044-legacy-skill-migration-records.sql')
    expect(result.foreignKeyCheck.ok).toBe(true)
    expect(result.orphanChecks.every((check) => check.orphanCount === 0)).toBe(true)
    expect(result.legacyTableDeletion.allowed).toBe(false)
    expect(result.legacyTableDeletion.reason).toMatch(/migration|approval/i)
  })
})
