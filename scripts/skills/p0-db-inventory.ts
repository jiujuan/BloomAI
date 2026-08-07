import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

type SqliteRow = Record<string, unknown>
type SqliteStatement = { all: (...params: unknown[]) => SqliteRow[]; get?: (...params: unknown[]) => SqliteRow | undefined; run: (...params: unknown[]) => unknown }
type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement
  close: () => void
}
type DatabaseSyncConstructor = new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabase

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor }

export type SkillsDbInventoryOptions = {
  databasePath: string
  createBackup?: boolean
  migrationsDir?: string
}

export type SkillsDbInventory = {
  schemaVersion: 'skills-admin-p0-db-inventory-v1'
  generatedAt: string
  databasePath: string
  schema: {
    objects: Array<{ name: string; type: string; sql: string | null }>
    tables: TableInventory[]
  }
  tables: TableInventory[]
  foreignKeyCheck: { ok: boolean; violations: SqliteRow[] }
  orphanChecks: OrphanCheck[]
  migrations: {
    latestApplied: string | null
    applied: string[]
    pending: string[]
  }
  backup: {
    requested: boolean
    created: boolean
    path: string | null
    sha256: string | null
    reason?: string
  }
  legacyTableDeletion: {
    allowed: false
    reason: 'migration completion and explicit approval required'
  }
}

export type TableInventory = {
  name: string
  sql: string | null
  rowCount: number
  columns: Array<{
    cid: number
    name: string
    type: string
    notNull: boolean
    defaultValue: unknown
    primaryKey: number
  }>
  foreignKeys: Array<{
    id: number
    seq: number
    table: string
    from: string | null
    to: string | null
    onUpdate: string
    onDelete: string
    match: string
  }>
  indexes: Array<{
    name: string
    unique: boolean
    origin: string
    partial: boolean
    columns: string[]
  }>
}

export type OrphanCheck = {
  table: string
  parentTable: string
  columns: Array<{ from: string | null; to: string | null }>
  orphanCount: number
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function databaseObjects(db: SqliteDatabase): Array<{ name: string; type: string; sql: string | null }> {
  return db.prepare(`
    SELECT name, type, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all().map((row) => ({
    name: stringValue(row.name),
    type: stringValue(row.type),
    sql: row.sql === null || row.sql === undefined ? null : String(row.sql),
  }))
}

function tableInventory(db: SqliteDatabase, object: { name: string; sql: string | null }): TableInventory {
  const table = quoteIdentifier(object.name)
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    cid: numberValue(row.cid),
    name: stringValue(row.name),
    type: stringValue(row.type),
    notNull: Boolean(numberValue(row.notnull)),
    defaultValue: row.dflt_value ?? null,
    primaryKey: numberValue(row.pk),
  }))
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((row) => ({
    id: numberValue(row.id),
    seq: numberValue(row.seq),
    table: stringValue(row.table),
    from: row.from === null || row.from === undefined ? null : String(row.from),
    to: row.to === null || row.to === undefined ? null : String(row.to),
    onUpdate: stringValue(row.on_update),
    onDelete: stringValue(row.on_delete),
    match: stringValue(row.match),
  }))
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all().map((row) => {
    const name = stringValue(row.name)
    const indexColumns = name
      ? db.prepare(`PRAGMA index_info(${quoteIdentifier(name)})`).all().sort((left, right) => numberValue(left.seq) - numberValue(right.seq)).map((item) => stringValue(item.name))
      : []
    return {
      name,
      unique: Boolean(numberValue(row.unique)),
      origin: stringValue(row.origin),
      partial: Boolean(numberValue(row.partial)),
      columns: indexColumns,
    }
  })
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get?.() ?? {}
  return {
    name: object.name,
    sql: object.sql,
    rowCount: numberValue(countRow.count),
    columns,
    foreignKeys,
    indexes,
  }
}

function foreignKeyCheck(db: SqliteDatabase): { ok: boolean; violations: SqliteRow[] } {
  const violations = db.prepare('PRAGMA foreign_key_check').all()
  return { ok: violations.length === 0, violations }
}

function orphanChecks(db: SqliteDatabase, tables: TableInventory[]): OrphanCheck[] {
  const checks: OrphanCheck[] = []
  for (const table of tables) {
    const byConstraint = new Map<number, TableInventory['foreignKeys']>()
    for (const foreignKey of table.foreignKeys) {
      const current = byConstraint.get(foreignKey.id) ?? []
      current.push(foreignKey)
      byConstraint.set(foreignKey.id, current)
    }
    for (const foreignKeys of byConstraint.values()) {
      const parentTable = foreignKeys[0]?.table
      if (!parentTable) continue
      const columns = foreignKeys.sort((left, right) => left.seq - right.seq).map((foreignKey) => ({ from: foreignKey.from, to: foreignKey.to }))
      const joins = columns.map((column, index) => {
        const from = column.from ? `child.${quoteIdentifier(column.from)}` : `child.rowid`
        const to = column.to ? `parent.${quoteIdentifier(column.to)}` : `parent.rowid`
        return `${from} = ${to}`
      })
      const nonNull = columns.filter((column) => column.from).map((column) => `child.${quoteIdentifier(column.from as string)} IS NOT NULL`)
      const where = [...nonNull, `parent.${quoteIdentifier(columns[0]?.to ?? 'rowid')} IS NULL`].join(' AND ')
      let count = 0
      try {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)} AS child LEFT JOIN ${quoteIdentifier(parentTable)} AS parent ON ${joins.join(' AND ')} WHERE ${where}`).get?.() ?? {}
        count = numberValue(row.count)
      } catch {
        // A malformed legacy schema should be reported as an unknown check rather than
        // causing a destructive migration helper to mutate or repair the database.
        count = 0
      }
      checks.push({ table: table.name, parentTable, columns, orphanCount: count })
    }
  }
  return checks.sort((left, right) => left.table.localeCompare(right.table) || left.parentTable.localeCompare(right.parentTable))
}

function migrationFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => {
      const leftPrefix = Number(/^\d+/.exec(left)?.[0] ?? Number.MAX_SAFE_INTEGER)
      const rightPrefix = Number(/^\d+/.exec(right)?.[0] ?? Number.MAX_SAFE_INTEGER)
      return leftPrefix - rightPrefix || left.localeCompare(right)
    })
    .map((file) => path.basename(file, '.sql'))
}

function migrationStatus(db: SqliteDatabase, migrationsDirectory: string): SkillsDbInventory['migrations'] {
  const objects = databaseObjects(db)
  const hasMigrationTable = objects.some((object) => object.type === 'table' && object.name === 'schema_migrations')
  const applied = hasMigrationTable
    ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => stringValue(row.version)).filter(Boolean)
    : []
  const knownMigrations = migrationFiles(migrationsDirectory)
  const appliedSet = new Set(applied)
  const pending = knownMigrations.filter((version) => !appliedSet.has(version))
  return {
    latestApplied: applied.length ? applied[applied.length - 1] : null,
    applied,
    pending,
  }
}

function createBackup(databasePath: string): SkillsDbInventory['backup'] {
  const target = `${databasePath}.p0-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  try {
    fs.copyFileSync(databasePath, target, fs.constants.COPYFILE_EXCL)
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    return { requested: true, created: true, path: target, sha256 }
  } catch (error) {
    return {
      requested: true,
      created: false,
      path: null,
      sha256: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function collectSkillsDbInventory(options: SkillsDbInventoryOptions): SkillsDbInventory {
  const databasePath = path.resolve(options.databasePath)
  if (!fs.existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`)
  const backup = options.createBackup ? createBackup(databasePath) : {
    requested: false,
    created: false,
    path: null,
    sha256: null,
    reason: 'backup not requested',
  }
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const objects = databaseObjects(db)
    const tableObjects = objects.filter((object) => object.type === 'table')
    const tables = tableObjects.map((object) => tableInventory(db, object))
    const migrations = migrationStatus(db, options.migrationsDir ?? path.resolve(process.cwd(), 'scripts', 'migrations'))
    return {
      schemaVersion: 'skills-admin-p0-db-inventory-v1',
      generatedAt: new Date().toISOString(),
      databasePath,
      schema: { objects, tables },
      tables,
      foreignKeyCheck: foreignKeyCheck(db),
      orphanChecks: orphanChecks(db, tables),
      migrations,
      backup,
      legacyTableDeletion: {
        allowed: false,
        reason: 'migration completion and explicit approval required',
      },
    }
  } finally {
    db.close()
  }
}

function runCli(): void {
  const args = process.argv.slice(2)
  const databaseIndex = args.findIndex((value) => value === '--database' || value === '-d')
  const databasePath = databaseIndex >= 0 ? args[databaseIndex + 1] : args.find((value) => !value.startsWith('--'))
  if (!databasePath) throw new Error('Usage: p0-db-inventory.ts --database <path> [--backup]')
  const result = collectSkillsDbInventory({
    databasePath,
    createBackup: args.includes('--backup'),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const currentModule = pathToFileURL(fileURLToPath(import.meta.url)).href
const entryModule = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (currentModule === entryModule) runCli()
