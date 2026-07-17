import fs from 'fs'
import path from 'path'

export interface SqlMigration {
  version: string
  sql: string
}

type RawSqliteDb = {
  exec(sql: string): void
  prepare(sql: string): {
    all(): unknown[]
    run(...params: unknown[]): unknown
  }
}

const migrationsDir = path.resolve(process.cwd(), 'scripts', 'migrations')

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

export function runSqlMigrations(db: RawSqliteDb, migrations = loadSqlMigrations()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row: any) => row.version as string)
  )
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
