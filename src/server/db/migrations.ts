import fs from 'fs'
import path from 'path'
export { assertSchemaContract, getExpectedSchemaContract } from './schema-contract'

export interface SqlMigration {
  version: string
  sql: string
}

export type RawSqliteDb = {
  exec(sql: string): void
  prepare(sql: string): {
    all(): unknown[]
    run(...params: unknown[]): unknown
  }
}

const migrationDirCandidates = [
  path.resolve(process.cwd(), 'scripts', 'migrations'),
  path.resolve(__dirname, '../../scripts', 'migrations'),
  path.resolve(__dirname, '../../../scripts', 'migrations'),
]
const migrationsDir = migrationDirCandidates.find((candidate) => fs.existsSync(candidate)) ?? migrationDirCandidates[0]

export function loadSqlMigrations(dir = migrationsDir): SqlMigration[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => {
      const leftPrefix = Number(/^\d+/.exec(left)?.[0] ?? Number.MAX_SAFE_INTEGER)
      const rightPrefix = Number(/^\d+/.exec(right)?.[0] ?? Number.MAX_SAFE_INTEGER)
      return leftPrefix - rightPrefix || left.localeCompare(right)
    })
    .map((file) => ({
      version: path.basename(file, '.sql'),
      sql: fs.readFileSync(path.join(dir, file), 'utf8'),
    }))
}

export function getAppliedMigrationVersions(db: RawSqliteDb): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
  return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row: any) => String(row.version))
}

export function getMigrationStatus(db: RawSqliteDb, migrations = loadSqlMigrations()): { current: string | null; applied: string[]; pending: string[] } {
  const recorded = getAppliedMigrationVersions(db)
  const recordedSet = new Set(recorded)
  const orderedVersions = migrations.map((migration) => migration.version)
  const knownApplied = orderedVersions.filter((version) => recordedSet.has(version))
  const unknownApplied = recorded.filter((version) => !orderedVersions.includes(version))
  const applied = [...knownApplied, ...unknownApplied]
  const pending = orderedVersions.filter((version) => !recordedSet.has(version))
  return {
    current: applied.length > 0 ? applied[applied.length - 1] : null,
    applied,
    pending,
  }
}

export function runSqlMigrations(db: RawSqliteDb, migrations = loadSqlMigrations()): void {
  const applied = new Set(getAppliedMigrationVersions(db))
  let appliedCount = 0

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    console.info(`[db:migrate] Applying ${migration.version}`)
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now())
      db.exec('COMMIT')
      applied.add(migration.version)
      appliedCount += 1
      console.info(`[db:migrate] Applied ${migration.version}`)
    } catch (err) {
      db.exec('ROLLBACK')
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`[db:migrate] Failed to apply ${migration.version}: ${message}`, { cause: err })
    }
  }

  if (appliedCount === 0) console.info('[db:migrate] Database migrations are up to date')
}
