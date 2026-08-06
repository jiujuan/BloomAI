import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSqlMigrations, runSqlMigrations } from './migrations'
import { assertSkillRuntimeDataInvariants } from './skill-runtime-invariants'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type RawDb = InstanceType<typeof DatabaseSync>

function createDb(): RawDb {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
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
  runSqlMigrations(db, loadSqlMigrations())
  return db
}

function seedRuntime(db: RawDb, options: { immutableHash?: string; versionStatus?: string; packageDeletedAt?: number | null } = {}) {
  const now = 1_760_000_000_000
  db.prepare(`INSERT INTO skill_packages (id, name, description, source_type, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('package-1', 'Fixture', '', 'local-directory', now, now, options.packageDeletedAt ?? null)
  db.prepare(`INSERT INTO skill_versions
    (id, package_id, version, runtime, manifest_json, manifest_hash, package_path, source_snapshot_json,
     is_compatible, immutable_hash, status, security_status, snapshot_hash, security_findings_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'version-1', 'package-1', '1.0.0', 'instruction-agent', '{}', 'manifest-1', 'package-1', '{}',
    1, options.immutableHash ?? 'immutable-1', options.versionStatus ?? 'runnable', 'reviewed', 'snapshot-1', '{}', now,
  )
  db.prepare(`INSERT INTO skill_runs_v2
    (id, skill_version_id, status, revision, input_json, context_json, updated_at, execution_mode, step_count, token_usage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('run-1', 'version-1', 'succeeded', 2, '{}', '{}', now, 'instruction-agent', 1, 10)
  db.prepare(`INSERT INTO skill_run_events
    (id, run_id, seq, schema_version, producer, occurred_at, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('event-1', 'run-1', 1, 1, 'test', now, 'run.started', '{}', now)
  return { now }
}

describe('skill runtime database invariants', () => {
  let db: RawDb | undefined
  let tempRoot: string | undefined

  afterEach(() => {
    db?.close()
    db = undefined
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  })

  it('accepts an immutable runnable version, linked run, event, queue and artifact', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-invariants-'))
    const artifactPath = path.join(tempRoot, 'result.md')
    const content = Buffer.from('# result\n', 'utf8')
    fs.writeFileSync(artifactPath, content)
    db.prepare(`INSERT INTO skill_run_queue
      (id, run_id, status, available_at, lease_owner, lease_until, attempt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('queue-1', 'run-1', 'done', now, null, null, 1, now, now)
    db.prepare(`INSERT INTO skill_artifacts
      (id, run_id, kind, artifact_kind, mime_type, path, relative_path, size_bytes, sha256, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'artifact-1', 'run-1', 'markdown', 'markdown', 'text/markdown', artifactPath, 'result.md', content.byteLength,
      crypto.createHash('sha256').update(content).digest('hex'), '{}', now,
    )

    expect(() => assertSkillRuntimeDataInvariants(db!)).not.toThrow()
  })

  it.each([
    ['missing immutable hash', { immutableHash: '' }],
    ['non-runnable version', { versionStatus: 'disabled' }],
  ])('rejects a run linked to an invalid version: %s', (_label, options) => {
    db = createDb()
    seedRuntime(db, options)
    expect(() => assertSkillRuntimeDataInvariants(db!)).toThrow(/immutable runnable SkillVersion/)
  })

  it('rejects an active installation whose current version belongs to another package or is not runnable', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    db.prepare(`INSERT INTO skill_packages (id, name, description, source_type, created_at, updated_at)
      VALUES ('package-2', 'Other', '', 'local-directory', ?, ?)`).run(now, now)
    db.prepare(`INSERT INTO skill_versions
      (id, package_id, version, runtime, manifest_json, manifest_hash, package_path, source_snapshot_json,
       is_compatible, immutable_hash, status, security_status, snapshot_hash, security_findings_json, created_at)
      VALUES ('version-2', 'package-2', '1.0.0', 'instruction-agent', '{}', 'manifest-2', 'package-2', '{}', 1, 'immutable-2', 'runnable', 'reviewed', 'snapshot-2', '{}', ?)`).run(now)
    db.prepare(`INSERT INTO skill_installations
      (id, package_id, current_version_id, status, enabled, installed_at, updated_at)
      VALUES ('installation-1', 'package-1', 'version-2', 'active', 1, ?, ?)`).run(now, now)

    expect(() => assertSkillRuntimeDataInvariants(db!)).toThrow(/active Installation current_version_id must point to the same package/)
  })

  it('enforces event and command idempotency plus one active queue lease at the database boundary', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    expect(() => db!.prepare(`INSERT INTO skill_run_events
      (id, run_id, seq, schema_version, producer, occurred_at, type, payload_json, created_at)
      VALUES ('event-duplicate', 'run-1', 1, 1, 'test', ?, 'run.progress', '{}', ?)`).run(now, now)).toThrow()
    expect(() => db!.prepare(`INSERT INTO skill_run_commands
      (id, run_id, idempotency_key, result_json, created_at)
      VALUES ('command-1', 'run-1', 'same-key', '{}', ?),
             ('command-2', 'run-1', 'same-key', '{}', ?)`).run(now, now)).toThrow()

    db!.prepare(`INSERT INTO skill_run_queue
      (id, run_id, status, available_at, lease_owner, lease_until, attempt, created_at, updated_at)
      VALUES ('queue-active-1', 'run-1', 'leased', ?, 'worker-a', ?, 1, ?, ?)`).run(now, now + 10_000, now, now)
    expect(() => db!.prepare(`INSERT INTO skill_run_queue
      (id, run_id, status, available_at, lease_owner, lease_until, attempt, created_at, updated_at)
      VALUES ('queue-active-2', 'run-1', 'retry_wait', ?, 'worker-b', ?, 2, ?, ?)`).run(now, now + 20_000, now, now)).toThrow()
  })

  it('rejects grants whose granted scope is broader than requested or whose usage exceeds budget', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    db.prepare(`INSERT INTO skill_capability_grants
      (id, skill_version_id, capability, grant_mode, scope_json, requested_scope_json, granted_scope_json,
       status, granted_at, max_calls, calls_used)
      VALUES ('grant-1', 'version-1', 'web.search', 'once', ?, ?, ?, 'approved', ?, 2, 3)`).run(
      JSON.stringify({ allowedDomains: ['example.com', 'evil.example'] }),
      JSON.stringify({ allowedDomains: ['example.com'] }),
      JSON.stringify({ allowedDomains: ['example.com', 'evil.example'] }),
      now,
    )

    expect(() => assertSkillRuntimeDataInvariants(db!)).toThrow(/grant granted scope must be a subset/)
  })

  it('rejects artifact metadata drift and preserves soft-deleted traceability', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-invariants-'))
    const artifactPath = path.join(tempRoot, 'result.md')
    fs.writeFileSync(artifactPath, '# result\n', 'utf8')
    db.prepare(`INSERT INTO skill_artifacts
      (id, run_id, kind, artifact_kind, mime_type, path, relative_path, size_bytes, sha256, metadata_json, created_at)
      VALUES ('artifact-1', 'run-1', 'markdown', 'markdown', 'text/markdown', ?, 'result.md', 99, 'wrong', '{}', ?)`).run(artifactPath, now)
    db.prepare(`UPDATE skill_packages SET deleted_at = ?, delete_reason = 'test' WHERE id = 'package-1'`).run(now + 1)

    expect(() => assertSkillRuntimeDataInvariants(db!)).toThrow(/Artifact metadata does not match file contents/)
    expect(db.prepare('SELECT COUNT(*) AS count FROM skill_runs_v2 WHERE id = ?').get('run-1')).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM skill_run_events WHERE run_id = ?').get('run-1')).toEqual({ count: 1 })
    expect(db.prepare('SELECT deleted_at, delete_reason FROM skill_packages WHERE id = ?').get('package-1')).toEqual({ deleted_at: now + 1, delete_reason: 'test' })
  })

  it('requires UTC epoch-millisecond timestamps and non-negative revisions/usage counters', () => {
    db = createDb()
    const { now } = seedRuntime(db)
    db.prepare(`UPDATE skill_runs_v2 SET revision = -1, updated_at = '2026-08-06T00:00:00Z' WHERE id = 'run-1'`)
      .run()
    db.prepare(`INSERT INTO skill_run_events
      (id, run_id, seq, schema_version, producer, occurred_at, type, payload_json, created_at)
      VALUES ('event-2', 'run-1', 2, 1, 'test', ?, 'run.finished', '{}', ?)`).run('2026-08-06T00:00:00Z', now)

    expect(() => assertSkillRuntimeDataInvariants(db!)).toThrow(/UTC epoch-millisecond/)
  })
})