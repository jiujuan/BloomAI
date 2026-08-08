import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'node:child_process'
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

function runMigrationCli(dataDirOverride?: string) {
  const { DATA_DIR: _ignoredDataDir, ...environment } = originalEnv
  return spawnSync(process.execPath, [path.resolve(process.cwd(), 'scripts', 'db-migrate.js')], {
    cwd: process.cwd(),
    env: dataDirOverride ? { ...environment, DATA_DIR: dataDirOverride } : environment,
    encoding: 'utf8',
  })
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


function indexNames(tableName: string): string[] {
  const db = openRawDb()
  try {
    return db.prepare(`PRAGMA index_list(${tableName})`).all().map((row: any) => row.name)
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
  it('reports applied, pending, and current migration versions without executing migrations', async () => {
    const { getMigrationStatus, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const migrations = [
        { version: '001-alpha', sql: 'CREATE TABLE migration_alpha (id TEXT PRIMARY KEY);' },
        { version: '002-beta', sql: 'CREATE TABLE migration_beta (id TEXT PRIMARY KEY);' },
      ]

      expect(getMigrationStatus(db, migrations)).toEqual({
        current: null,
        applied: [],
        pending: ['001-alpha', '002-beta'],
      })

      runSqlMigrations(db, migrations.slice(0, 1))

      expect(getMigrationStatus(db, migrations)).toEqual({
        current: '001-alpha',
        applied: ['001-alpha'],
        pending: ['002-beta'],
      })
    } finally {
      db.close()
    }
  })

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

  it('runs the CLI only against an explicit data directory and is idempotent', () => {
    const withoutTarget = runMigrationCli()
    expect(withoutTarget.status).toBe(1)
    expect(withoutTarget.stderr).toContain('DATA_DIR')

    const firstRun = runMigrationCli(dataDir)
    expect(firstRun.status).toBe(0)
    expect(migrationVersions()).toHaveLength(46)

    const secondRun = runMigrationCli(dataDir)
    expect(secondRun.status).toBe(0)
    expect(secondRun.stdout).toContain('up to date')
    expect(migrationVersions()).toHaveLength(46)
  })

  it('adds security audit and supply-chain columns with safe defaults and upgrades an existing database', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const migrations = loadSqlMigrations()
      const securityMigration = migrations.find((migration) => migration.version === '043-skill-security-audit-fields')
      expect(securityMigration).toBeDefined()
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
      runSqlMigrations(db, migrations.filter((migration) => migration.version !== securityMigration!.version))

      db.exec(`
        INSERT INTO skill_packages (id, name, description, source_type, created_at, updated_at)
        VALUES ('security-package', 'Security package', '', 'local-directory', 1, 1);
        INSERT INTO skill_versions (
          id, package_id, version, runtime, manifest_json, manifest_hash, package_path,
          source_snapshot_json, is_compatible, immutable_hash, status, security_status,
          snapshot_hash, published_at, created_at
        ) VALUES (
          'security-version', 'security-package', '1.0.0', 'instruction-agent', '{}', 'manifest',
          '/packages/security', '{}', 1, 'immutable', 'runnable', 'unreviewed', 'snapshot', NULL, 1
        );
        INSERT INTO skill_import_reviews (
          id, source, source_sha, source_ref, inspection_json, status, reviewer, decision, created_at, updated_at
        ) VALUES ('security-review', 'local-directory', 'source-sha', NULL, '{}', 'pending', NULL, NULL, 1, 1);
        INSERT INTO skill_audit_events (
          id, actor, action, resource_type, resource_id, payload_json, created_at
        ) VALUES ('security-audit', 'legacy-actor', 'import', 'skill-package', 'security-package', '{}', 1);
      `)

      runSqlMigrations(db, [securityMigration!])
      runSqlMigrations(db, [securityMigration!])

      const auditColumns = db.prepare("PRAGMA table_info('skill_audit_events')").all() as any[]
      const reviewColumns = db.prepare("PRAGMA table_info('skill_import_reviews')").all() as any[]
      const versionColumns = db.prepare("PRAGMA table_info('skill_versions')").all() as any[]
      const column = (rows: any[], name: string) => rows.find((row) => row.name === name)

      expect(auditColumns.filter((row) => row.name === 'actor')).toHaveLength(1)
      expect(column(auditColumns, 'security_decision')).toMatchObject({ notnull: 1, dflt_value: "'not_evaluated'" })
      expect(column(auditColumns, 'policy_version')).toMatchObject({ notnull: 1, dflt_value: "'legacy'" })
      expect(column(auditColumns, 'source_fingerprint')).toMatchObject({ notnull: 0 })
      expect(column(reviewColumns, 'security_findings_json')).toMatchObject({ notnull: 1, dflt_value: "'{}'" })
      expect(column(versionColumns, 'security_findings_json')).toMatchObject({ notnull: 1, dflt_value: "'{}'" })
      expect(db.prepare(`
        SELECT security_decision, policy_version, source_fingerprint
        FROM skill_audit_events WHERE id = 'security-audit'
      `).get()).toEqual({ security_decision: 'not_evaluated', policy_version: 'legacy', source_fingerprint: null })
      expect(db.prepare("SELECT security_findings_json FROM skill_import_reviews WHERE id = 'security-review'").get())
        .toEqual({ security_findings_json: '{}' })
      expect(db.prepare("SELECT security_findings_json FROM skill_versions WHERE id = 'security-version'").get())
        .toEqual({ security_findings_json: '{}' })
      expect(migrationVersions()).toEqual(migrations.map((migration) => migration.version))
    } finally {
      db.close()
    }
  })

  it('adds Image Studio skill-link columns before applying the link indexes to a legacy database', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const legacy = openRawDb()
    legacy.exec(`
      CREATE TABLE image_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, default_model TEXT,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE image_generations (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT,
        prompt TEXT NOT NULL, resolved_prompt TEXT, provider_id TEXT NOT NULL, model TEXT NOT NULL,
        aspect_ratio TEXT, style TEXT, size TEXT, seed INTEGER, reference_images TEXT,
        status TEXT NOT NULL, provider_task_id TEXT, progress INTEGER, url TEXT, local_path TEXT,
        error_msg TEXT, duration_ms INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `)
    legacy.close()

    const client = await loadClient()
    await client.initDb()
    client.runLegacyMigrationPrerequisites()
    const migrations = loadSqlMigrations()
    const imageMigration = migrations.find((migration) => migration.version === '042-image-studio-skill-links')
    expect(imageMigration).toBeDefined()
    const migrationDb = openRawDb()
    try {
      runSqlMigrations(migrationDb, [imageMigration!])
    } finally {
      migrationDb.close()
    }

    const upgraded = openRawDb()
    try {
      expect(upgraded.prepare("SELECT name FROM pragma_table_info('image_sessions') WHERE name IN ('skill_run_id', 'skill_version_id', 'grant_id') ORDER BY name").all()).toEqual([
        { name: 'grant_id' }, { name: 'skill_run_id' }, { name: 'skill_version_id' },
      ])
      expect(upgraded.prepare("SELECT name FROM pragma_table_info('image_generations') WHERE name IN ('skill_run_id', 'skill_version_id', 'grant_id') ORDER BY name").all()).toEqual([
        { name: 'grant_id' }, { name: 'skill_run_id' }, { name: 'skill_version_id' },
      ])
      expect(indexNames('image_sessions')).toContain('idx_image_sessions_skill_run')
      expect(indexNames('image_generations')).toEqual(expect.arrayContaining(['idx_image_generations_skill_run', 'idx_image_generations_grant']))
      expect(upgraded.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '042-image-studio-skill-links'").get()).toEqual({ count: 1 })
    } finally {
      upgraded.close()
    }
  })

  it('adds artifact policy columns and backfills legacy artifact rows incrementally', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const migrations = loadSqlMigrations()
      const artifactMigration = migrations.find((migration) => migration.version === '041-skill-artifact-policy')
      expect(artifactMigration).toBeDefined()
      db.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, persona_id TEXT, model TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
          tool_calls TEXT, parts TEXT, tokens INTEGER, created_at INTEGER NOT NULL
        );
        CREATE TABLE tool_permissions (
          id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, granted INTEGER NOT NULL,
          scope TEXT NOT NULL, granted_at INTEGER NOT NULL
        );
      `)
      runSqlMigrations(db, migrations.filter((migration) => migration.version !== '041-skill-artifact-policy'))
      db.exec(`
        INSERT INTO skill_packages (id, name, source_type, created_at, updated_at)
        VALUES ('package-artifact-policy', 'Artifact Policy', 'local', 1, 1);
        INSERT INTO skill_versions (
          id, package_id, version, manifest_json, manifest_hash, package_path, created_at
        ) VALUES ('version-artifact-policy', 'package-artifact-policy', '1.0.0', '{}', 'hash', '/pkg', 1);
        INSERT INTO skill_runs_v2 (
          id, skill_version_id, status, input_json, context_json, updated_at, revision
        ) VALUES ('run-artifact-policy', 'version-artifact-policy', 'created', '{}', '{}', 1, 0);
        INSERT INTO skill_artifacts (
          id, run_id, kind, mime_type, path, size_bytes, sha256, metadata_json, created_at
        ) VALUES ('artifact-legacy', 'run-artifact-policy', 'markdown', 'text/markdown', 'summary.md', 2, 'hash', '{}', 2);
      `)

      runSqlMigrations(db, [artifactMigration!])
      runSqlMigrations(db, [artifactMigration!])

      expect(db.prepare("SELECT name FROM pragma_table_info('skill_artifacts') WHERE name IN ('artifact_kind', 'relative_path') ORDER BY name").all()).toEqual([
        { name: 'artifact_kind' },
        { name: 'relative_path' },
      ])
      expect(db.prepare("SELECT artifact_kind, relative_path FROM skill_artifacts WHERE id = 'artifact-legacy'").get()).toEqual({
        artifact_kind: 'markdown',
        relative_path: 'summary.md',
      })
      expect(indexNames('skill_artifacts')).toEqual(expect.arrayContaining([
        'idx_skill_artifacts_run_created',
        'idx_skill_artifacts_retention',
      ]))
      expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '041-skill-artifact-policy'").get()).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  it('adds artifact status and Run/Version lineage while upgrading existing artifact rows', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const migrations = loadSqlMigrations()
      const lifecycleMigration = migrations.find((migration) => migration.version === '045-skill-artifact-status')
      expect(lifecycleMigration).toBeDefined()
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
      runSqlMigrations(db, migrations.filter((migration) => migration.version !== lifecycleMigration!.version))
      db.exec(`
        INSERT INTO skill_packages (id, name, description, source_type, created_at, updated_at)
        VALUES ('artifact-status-package', 'Artifact status package', '', 'local-directory', 1, 1);
        INSERT INTO skill_versions (
          id, package_id, version, runtime, manifest_json, manifest_hash, package_path,
          source_snapshot_json, is_compatible, immutable_hash, status, security_status,
          snapshot_hash, published_at, created_at
        ) VALUES (
          'artifact-status-version', 'artifact-status-package', '1.0.0', 'instruction-agent', '{}', 'manifest',
          '/packages/artifact-status', '{}', 1, 'immutable', 'runnable', 'verified', 'snapshot', NULL, 1
        );
        INSERT INTO skill_runs_v2 (
          id, skill_version_id, status, input_json, context_json, updated_at, revision
        ) VALUES ('artifact-status-run', 'artifact-status-version', 'created', '{}', '{}', 1, 0);
        INSERT INTO skill_artifacts (
          id, run_id, kind, mime_type, path, size_bytes, sha256, metadata_json, created_at
        ) VALUES ('artifact-status-legacy', 'artifact-status-run', 'markdown', 'text/markdown', 'summary.md', 2, 'hash', '{}', 2);
      `)

      runSqlMigrations(db, [lifecycleMigration!])
      runSqlMigrations(db, [lifecycleMigration!])

      expect(db.prepare("SELECT name FROM pragma_table_info('skill_artifacts') WHERE name IN ('status', 'skill_version_id') ORDER BY name").all()).toEqual([
        { name: 'skill_version_id' },
        { name: 'status' },
      ])
      expect(db.prepare("SELECT status, skill_version_id FROM skill_artifacts WHERE id = 'artifact-status-legacy'").get()).toEqual({
        status: 'ready',
        skill_version_id: 'artifact-status-version',
      })
      expect(indexNames('skill_artifacts')).toContain('idx_skill_artifacts_version')
      expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '045-skill-artifact-status'").get()).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  it('orders SQL migration files by numeric prefix', async () => {
    const { loadSqlMigrations } = await import('./migrations')
    const migrationsPath = path.join(dataDir, 'migration-order')
    fs.mkdirSync(migrationsPath)
    fs.writeFileSync(path.join(migrationsPath, '10-tenth.sql'), 'SELECT 10;')
    fs.writeFileSync(path.join(migrationsPath, '2-second.sql'), 'SELECT 2;')
    fs.writeFileSync(path.join(migrationsPath, '1-first.sql'), 'SELECT 1;')
    fs.writeFileSync(path.join(migrationsPath, 'notes.txt'), 'ignore')

    expect(loadSqlMigrations(migrationsPath).map((migration) => migration.version)).toEqual([
      '1-first',
      '2-second',
      '10-tenth',
    ])
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
        'skill_run_queue',
        'skill_import_reviews',
        'skill_audit_events',
        'skill_drafts',
        'skill_version_snapshots',
        'skill_version_diffs',
        'research_runs',
        'research_questions',
        'research_search_queries',
        'research_sources',
        'research_source_assessments',
        'research_source_snapshots',
        'research_evidence',
        'research_report_sections',
        'research_report_section_questions',
        'research_claims',
        'research_citations',
        'research_quality_assessments',
        'research_events',
        'research_recovery_commands',
        'research_reconciliations',
        'research_artifacts',
        'research_run_attempts',
        'research_run_checkpoints',
        'research_iterations',
        'research_coverage_assessments',
        'scheduled_task_runs',
        'projects',
        'skill_legacy_migrations',
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
      '009-deep-research-recovery-commands',
      '010-deep-research-resilience',
      '011-deep-research-coverage-assessments',
      '012-deep-research-iteration-idempotency',
      '013-deep-research-attempt-lease-ownership',
      '014-deep-research-reconciliation',
      '015-deep-research-model-selection-snapshot',
      '016-deep-research-llm-runtime-usage',
      '017-deep-research-structured-model-traces',
      '018-deep-research-brief-question-section-mapping',
      '019-deep-research-query-intents-deduplication',
      '020-deep-research-source-quality-assessments',
      '021-deep-research-structured-evidence',
      '022-deep-research-section-drafts',
      '023-deep-research-semantic-citation-quality-gates',
      '024-scheduled-task-runs',
      '025-project-chat-workspaces',
      '026-disable-placeholder-tools',
      '027-tool-permissions-permanent-only',
      '028-tools-platform-b1',
      '029-tools-platform-b1-patch',
      '030-skill-runtime-queue-and-control-plane',
      '031-skill-version-drafts-and-snapshots',
      '032-skill-run-state-machine',
      '033-skill-run-event-protocol',
      '034-skill-run-execution-metrics',
      '035-skill-run-recovery',
      '036-skill-capability-grant-lifecycle',
      '037-skill-run-waiting-actions',
      '038-skill-artifact-retention-export',
      '039-skill-version-lifecycle',
      '040-skill-lifecycle-delete',
      '041-skill-artifact-policy',
      '042-image-studio-skill-links',
      '043-skill-security-audit-fields',
      '044-legacy-skill-migration-records',
      '045-skill-artifact-status',
      '046-skill-draft-publish-idempotency',
    ])
    const emptyDb = openRawDb()
    try {
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('skill_legacy_migrations') ORDER BY cid").all()).toEqual([
        { name: 'id' },
        { name: 'legacy_skill_id' },
        { name: 'legacy_type' },
        { name: 'source_sha256' },
        { name: 'decision' },
        { name: 'status' },
        { name: 'package_id' },
        { name: 'package_version_id' },
        { name: 'report_artifact_id' },
        { name: 'owner_id' },
        { name: 'created_by' },
        { name: 'preview_json' },
        { name: 'warnings_json' },
        { name: 'side_effects_json' },
        { name: 'last_error' },
        { name: 'revision' },
        { name: 'created_at' },
        { name: 'updated_at' },
        { name: 'published_at' },
      ])
      expect(uniqueIndexColumnSets('skill_legacy_migrations')).toContainEqual(['legacy_skill_id', 'source_sha256'])
      expect(indexNames('skill_legacy_migrations')).toEqual(expect.arrayContaining([
        'idx_skill_legacy_migrations_source',
        'idx_skill_legacy_migrations_legacy_status',
        'idx_skill_legacy_migrations_package',
      ]))
      expect(foreignKeyActions('skill_legacy_migrations')).toEqual(expect.arrayContaining([
        { from: 'package_id', table: 'skill_packages', onDelete: 'NO ACTION' },
        { from: 'package_version_id', table: 'skill_versions', onDelete: 'NO ACTION' },
        { from: 'report_artifact_id', table: 'skill_artifacts', onDelete: 'NO ACTION' },
      ]))
      emptyDb.prepare(`
        INSERT INTO skill_legacy_migrations (
          id, legacy_skill_id, legacy_type, source_sha256, decision, status,
          owner_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('legacy-migration-1', 'legacy-1', 'prompt-template', 'hash-1', 'auto_convertible', 'migration_previewed', 'owner-1', 'actor-1', 1, 1)
      expect(() => emptyDb.prepare(`
        INSERT INTO skill_legacy_migrations (
          id, legacy_skill_id, legacy_type, source_sha256, decision, status,
          owner_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('legacy-migration-2', 'legacy-1', 'prompt-template', 'hash-1', 'auto_convertible', 'migration_previewed', 'owner-1', 'actor-1', 2, 2)).toThrow()
      expect(emptyDb.prepare(`
        SELECT
          (SELECT COUNT(*) FROM research_runs) AS runs,
          (SELECT COUNT(*) FROM research_run_attempts) AS attempts,
          (SELECT COUNT(*) FROM research_run_checkpoints) AS checkpoints
      `).get()).toEqual({ runs: 0, attempts: 0, checkpoints: 0 })
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_runs') WHERE name = 'model_selection_snapshot_json'").all()).toEqual([
        { name: 'model_selection_snapshot_json' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_run_attempts') WHERE name = 'model_usage_json'").all()).toEqual([
        { name: 'model_usage_json' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_questions') WHERE name IN ('section_key', 'question_type', 'need_primary_source', 'need_recent_source', 'need_quantitative_evidence', 'source_targets_json') ORDER BY name").all()).toEqual([
        { name: 'need_primary_source' },
        { name: 'need_quantitative_evidence' },
        { name: 'need_recent_source' },
        { name: 'question_type' },
        { name: 'section_key' },
        { name: 'source_targets_json' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_report_sections') WHERE name IN ('section_key', 'draft_payload_json') ORDER BY name").all()).toEqual([
        { name: 'draft_payload_json' },
        { name: 'section_key' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_citations') WHERE name IN ('verification_method', 'semantic_checks_json') ORDER BY name").all()).toEqual([
        { name: 'semantic_checks_json' },
        { name: 'verification_method' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_quality_assessments') WHERE name IN ('policy_version', 'gate_results_json', 'remedial_actions_json') ORDER BY name").all()).toEqual([
        { name: 'gate_results_json' },
        { name: 'policy_version' },
        { name: 'remedial_actions_json' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_search_queries') WHERE name IN ('query_intent', 'source_targets_json', 'dedupe_key') ORDER BY name").all()).toEqual([
        { name: 'dedupe_key' },
        { name: 'query_intent' },
        { name: 'source_targets_json' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_source_assessments') WHERE name IN ('source_category', 'scoring_method', 'score_breakdown_json', 'assessment_reasons_json', 'rejection_reasons_json') ORDER BY name").all()).toEqual([
        { name: 'assessment_reasons_json' },
        { name: 'rejection_reasons_json' },
        { name: 'score_breakdown_json' },
        { name: 'scoring_method' },
        { name: 'source_category' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_evidence') WHERE name IN ('source_id', 'claim', 'evidence_type', 'entities_json', 'numbers_json', 'timeframe', 'relevance') ORDER BY name").all()).toEqual([
        { name: 'claim' },
        { name: 'entities_json' },
        { name: 'evidence_type' },
        { name: 'numbers_json' },
        { name: 'relevance' },
        { name: 'source_id' },
        { name: 'timeframe' },
      ])
    } finally {
      emptyDb.close()
    }

    expect(uniqueIndexColumnSets('research_events')).toContainEqual(['run_id', 'sequence'])
    expect(uniqueIndexColumnSets('research_sources')).toContainEqual(['run_id', 'canonical_url'])
    expect(uniqueIndexColumnSets('research_source_assessments')).toContainEqual(['run_id', 'candidate_key'])
    expect(uniqueIndexColumnSets('research_recovery_commands')).toContainEqual(['run_id', 'command_key'])
    expect(uniqueIndexColumnSets('research_reconciliations')).toContainEqual(['run_id', 'reconciliation_key'])
    expect(uniqueIndexColumnSets('research_run_attempts')).toContainEqual(['run_id', 'ordinal'])
    expect(uniqueIndexColumnSets('research_run_checkpoints')).toContainEqual(['attempt_id', 'sequence'])
    expect(uniqueIndexColumnSets('research_run_checkpoints')).toContainEqual(['run_id', 'checkpoint_key', 'input_fingerprint'])
    expect(uniqueIndexColumnSets('research_iterations')).toContainEqual(['run_id', 'ordinal'])
    expect(uniqueIndexColumnSets('research_coverage_assessments')).toContainEqual(['run_id', 'iteration_ordinal', 'policy_version', 'input_fingerprint'])
    expect(uniqueIndexColumnSets('scheduled_task_runs')).toContainEqual(['schedule_id', 'trigger_fired_at'])
    expect(uniqueIndexColumnSets('projects')).toContainEqual(['root_path'])

    expect(indexNames('research_runs')).toContain('idx_research_runs_current_attempt')
    expect(indexNames('research_runs')).toContain('idx_research_runs_cancellation')
    expect(indexNames('research_run_attempts')).toContain('idx_research_run_attempts_run_status')
    expect(indexNames('research_run_attempts')).toContain('idx_research_run_attempts_lease')
    expect(indexNames('research_run_attempts')).toContain('idx_research_run_attempts_ownership_token')
    expect(indexNames('research_run_checkpoints')).toContain('idx_research_run_checkpoints_run_sequence')
    expect(indexNames('research_run_checkpoints')).toContain('idx_research_run_checkpoints_attempt_status')
    expect(indexNames('research_iterations')).toContain('idx_research_iterations_run_status')
    expect(indexNames('research_coverage_assessments')).toContain('idx_research_coverage_assessments_run_iteration')
    expect(indexNames('research_search_queries')).toContain('idx_research_search_queries_run_question_dedupe')
    expect(indexNames('research_source_assessments')).toContain('idx_research_source_assessments_run_question')
    expect(indexNames('research_evidence')).toContain('idx_research_evidence_run_source')
    expect(indexNames('research_source_assessments')).toContain('idx_research_source_assessments_run_query')
    expect(indexNames('projects')).toEqual(expect.arrayContaining([
      'idx_projects_root_path_unique',
      'idx_projects_updated',
    ]))
    expect(indexNames('sessions')).toContain('idx_sessions_project_updated')
    expect(indexNames('scheduled_task_runs')).toEqual(expect.arrayContaining([
      'idx_scheduled_task_runs_schedule_trigger',
      'idx_scheduled_task_runs_status_created',
      'idx_scheduled_task_runs_schedule_trigger_unique',
    ]))

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
      'research_recovery_commands',
      'research_artifacts',
      'research_run_attempts',
      'research_run_checkpoints',
      'research_iterations',
      'research_coverage_assessments',
    ]) {
      expect(foreignKeyActions(tableName)).toContainEqual({
        from: 'run_id',
        table: 'research_runs',
        onDelete: 'CASCADE',
      })
    }
    expect(foreignKeyActions('research_run_checkpoints')).toContainEqual({
      from: 'attempt_id',
      table: 'research_run_attempts',
      onDelete: 'CASCADE',
    })
    expect(foreignKeyActions('research_coverage_assessments')).toContainEqual({
      from: 'iteration_id',
      table: 'research_iterations',
      onDelete: 'SET NULL',
    })
  })


  it('enforces Skills Runtime uniqueness, foreign-key, and active-lease invariants', async () => {
    const { runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      db.exec('PRAGMA foreign_keys = ON')
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Chat',
          persona_id TEXT, model TEXT NOT NULL DEFAULT 'model',
          status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE tool_permissions (
          id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, granted INTEGER DEFAULT 0,
          granted_at INTEGER, scope TEXT DEFAULT 'session'
        );
      `)
      runSqlMigrations(db)
      db.exec(`
        INSERT INTO skill_packages (id, name, description, source_type, created_at, updated_at)
        VALUES ('package-invariants', 'Invariant package', '', 'local', 1, 1);
        INSERT INTO skill_versions (
          id, package_id, version, manifest_json, manifest_hash, package_path, created_at
        ) VALUES ('version-invariants', 'package-invariants', '1.0.0', '{}', 'manifest-hash', '/tmp/package-invariants', 1);
        INSERT INTO skill_runs_v2 (id, skill_version_id, status, input_json, context_json, updated_at)
        VALUES ('run-invariants', 'version-invariants', 'created', '{}', '{}', 1);
      `)

      expect(() => db.prepare(`
        INSERT INTO skill_versions (
          id, package_id, version, manifest_json, manifest_hash, package_path, created_at
        ) VALUES ('version-duplicate', 'package-invariants', '1.0.0', '{}', 'manifest-hash', '/tmp/duplicate', 2)
      `).run()).toThrow()

      db.prepare(`
        INSERT INTO skill_run_events (id, run_id, seq, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, '{}', ?)
      `).run('event-invariants-1', 'run-invariants', 1, 'run.started', 1)
      expect(() => db.prepare(`
        INSERT INTO skill_run_events (id, run_id, seq, type, payload_json, created_at)
        VALUES ('event-invariants-duplicate', 'run-invariants', 1, 'run.started', '{}', 2)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO skill_run_events (id, run_id, seq, type, payload_json, created_at)
        VALUES ('event-invariants-invalid-run', 'missing-run', 2, 'run.started', '{}', 2)
      `).run()).toThrow()

      expect(() => db.prepare(`
        INSERT INTO skill_run_commands (id, run_id, idempotency_key, result_json, created_at)
        VALUES ('command-invariants-1', 'run-invariants', 'same-command', '{}', 1)
      `).run()).not.toThrow()
      expect(() => db.prepare(`
        INSERT INTO skill_run_commands (id, run_id, idempotency_key, result_json, created_at)
        VALUES ('command-invariants-duplicate', 'run-invariants', 'same-command', '{}', 2)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO skill_artifacts (id, run_id, kind, path, size_bytes, sha256, metadata_json, created_at)
        VALUES ('artifact-invariants-invalid-run', 'missing-run', 'text', '/tmp/missing', 0, 'hash', '{}', 1)
      `).run()).toThrow()

      db.prepare(`
        INSERT INTO skill_run_queue (id, run_id, status, available_at, attempt, created_at, updated_at)
        VALUES ('queue-invariants-1', 'run-invariants', 'queued', 1, 0, 1, 1)
      `).run()
      expect(() => db.prepare(`
        INSERT INTO skill_run_queue (id, run_id, status, available_at, attempt, created_at, updated_at)
        VALUES ('queue-invariants-duplicate-active', 'run-invariants', 'retry_wait', 2, 1, 2, 2)
      `).run()).toThrow()
      db.prepare(`UPDATE skill_run_queue SET status = 'done', updated_at = 3 WHERE id = 'queue-invariants-1'`).run()
      expect(() => db.prepare(`
        INSERT INTO skill_run_queue (id, run_id, status, available_at, attempt, created_at, updated_at)
        VALUES ('queue-invariants-2', 'run-invariants', 'queued', 4, 0, 4, 4)
      `).run()).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('upgrades a pre-scheduled-task database without changing Chat tables and enforces task-run uniqueness', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const migrations = loadSqlMigrations()
      const legacyMigrations = migrations.filter((migration) => !['024-scheduled-task-runs', '025-project-chat-workspaces', '027-tool-permissions-permanent-only'].includes(migration.version))
      const scheduledTaskMigration = migrations.filter((migration) => migration.version === '024-scheduled-task-runs')
      const projectWorkspaceMigration = migrations.filter((migration) => migration.version === '025-project-chat-workspaces')
      db.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
      `)
      runSqlMigrations(db, legacyMigrations)
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, persona_id TEXT, model TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
          tool_calls TEXT, parts TEXT, tokens INTEGER, created_at INTEGER NOT NULL
        );
        INSERT INTO sessions (id, title, model, status, created_at, updated_at)
        VALUES ('chat-legacy', 'Existing chat', 'model', 'active', 1, 1);
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES ('message-legacy', 'chat-legacy', 'user', 'Existing chat message', 1);
      `)
      const chatSchemasBefore = db.prepare(`
        SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'messages') ORDER BY name
      `).all()

      runSqlMigrations(db, scheduledTaskMigration)
      runSqlMigrations(db, projectWorkspaceMigration)

      expect(db.prepare('SELECT title FROM sessions WHERE id = ?').get('chat-legacy')).toEqual({ title: 'Existing chat' })
      expect(db.prepare('SELECT content FROM messages WHERE id = ?').get('message-legacy')).toEqual({ content: 'Existing chat message' })
      expect(db.prepare(`
        SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'
      `).all()).toEqual(chatSchemasBefore.filter((row: any) => row.name === 'messages'))
      expect(db.prepare("SELECT name FROM pragma_table_info('sessions') WHERE name = 'project_id'").all()).toEqual([{ name: 'project_id' }])
      expect(db.prepare('SELECT project_id FROM sessions WHERE id = ?').get('chat-legacy')).toEqual({ project_id: null })
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_projects_root_path_unique'").get()).toEqual(expect.objectContaining({ sql: expect.stringContaining('COLLATE NOCASE') }))
      expect(db.prepare("SELECT name FROM pragma_table_info('scheduled_task_runs') ORDER BY cid").all().map((row: any) => row.name)).toEqual([
        'id', 'schedule_id', 'trigger_fired_at', 'mastra_run_id', 'trigger_kind', 'status', 'output_text',
        'error_message', 'usage_json', 'started_at', 'finished_at', 'created_at',
      ])
      expect(db.prepare("SELECT name FROM pragma_table_info('scheduled_task_runs') WHERE name IN ('session_id', 'message_id', 'thread_id')").all()).toEqual([])
      db.prepare(`
        INSERT INTO scheduled_task_runs (
          id, schedule_id, trigger_fired_at, trigger_kind, status, started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('run-1', 'schedule-1', 100, 'manual', 'succeeded', 100, 100)
      expect(() => db.prepare(`
        INSERT INTO scheduled_task_runs (
          id, schedule_id, trigger_fired_at, trigger_kind, status, started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('run-2', 'schedule-1', 100, 'manual', 'succeeded', 100, 100)).toThrow(/unique|constraint/i)
    } finally {
      db.close()
    }
  })

  it('disables already-enabled placeholder tools during the A0 upgrade', async () => {
    const { runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      db.exec(`
        CREATE TABLE tools (
          id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL,
          description TEXT NOT NULL, params_schema TEXT NOT NULL DEFAULT '{}',
          result_schema TEXT NOT NULL DEFAULT '{}', is_builtin INTEGER DEFAULT 1,
          is_enabled INTEGER DEFAULT 1, requires_permission TEXT, created_at INTEGER NOT NULL
        );
        INSERT INTO tools (id, category, name, description, created_at)
        VALUES
          ('web_screenshot', 'web', 'Screenshot', 'legacy placeholder', 1),
          ('ocr', 'multimodal', 'OCR', 'legacy placeholder', 1),
          ('image_edit', 'multimodal', 'Image edit', 'legacy placeholder', 1),
          ('web_search', 'web', 'Search', 'real tool', 1);
      `)

      const migration = (await import('./migrations')).loadSqlMigrations().find((item) => item.version === '026-disable-placeholder-tools')
      expect(migration).toBeDefined()
      runSqlMigrations(db, [migration!])

      expect(db.prepare(`
        SELECT id, is_enabled FROM tools
        ORDER BY id
      `).all()).toEqual([
        { id: 'image_edit', is_enabled: 0 },
        { id: 'ocr', is_enabled: 0 },
        { id: 'web_screenshot', is_enabled: 0 },
        { id: 'web_search', is_enabled: 1 },
      ])
    } finally {
      db.close()
    }
  })

  it('makes tool permissions permanent-only, revokes legacy session scopes, and deduplicates grants', async () => {
    const { runSqlMigrations, loadSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      db.exec(`
        CREATE TABLE tool_permissions (
          id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, granted INTEGER DEFAULT 0,
          granted_at INTEGER, scope TEXT DEFAULT 'session'
        );
        INSERT INTO tool_permissions (id, tool_id, granted, granted_at, scope)
        VALUES
          ('old-session', 'fs_write', 1, 100, 'session'),
          ('old-persistent', 'fs_write', 1, 200, 'persistent'),
          ('permanent', 'fs_read', 1, 300, 'permanent');
      `)

      const migration = loadSqlMigrations().find((item) => item.version === '027-tool-permissions-permanent-only')
      expect(migration).toBeDefined()
      runSqlMigrations(db, [migration!])

      expect(db.prepare('SELECT tool_id, granted, scope FROM tool_permissions ORDER BY tool_id').all()).toEqual([
        { tool_id: 'fs_read', granted: 1, scope: 'permanent' },
        { tool_id: 'fs_write', granted: 0, scope: 'permanent' },
      ])
      expect(uniqueIndexColumnSets('tool_permissions')).toContainEqual(['tool_id'])
    } finally {
      db.close()
    }
  })

  it('enforces resilience defaults, foreign keys, and checkpoint uniqueness', async () => {
    const client = await loadClient()
    await client.runMigrations()

    const db = openRawDb()
    try {
      db.exec('PRAGMA foreign_keys = ON')
      db.exec(`
        INSERT INTO research_runs (
          id, topic, profile, depth, status, phase, input_json, budget_json, created_at, updated_at
        ) VALUES ('run-resilience', 'Resilience', 'general', 'standard', 'interrupted', 'researching', '{}', '{}', 1, 1);
      `)

      expect(db.prepare(`
        SELECT state_version, current_attempt_id, cancel_requested_at, cancel_reason, stop_reason_json,
          limitations_json, workflow_version, coverage_policy_version, parser_version,
          model_contract_version, last_checkpoint_sequence
        FROM research_runs WHERE id = 'run-resilience'
      `).get()).toEqual({
        state_version: 0,
        current_attempt_id: null,
        cancel_requested_at: null,
        cancel_reason: null,
        stop_reason_json: null,
        limitations_json: '[]',
        workflow_version: null,
        coverage_policy_version: null,
        parser_version: null,
        model_contract_version: null,
        last_checkpoint_sequence: null,
      })

      db.exec(`
        INSERT INTO research_run_attempts (id, run_id, ordinal, trigger, created_at)
        VALUES ('attempt-1', 'run-resilience', 1, 'manual_resume', 2);
        INSERT INTO research_iterations (id, run_id, ordinal, created_at)
        VALUES ('iteration-1', 'run-resilience', 1, 3);
        INSERT INTO research_coverage_assessments (
          id, run_id, iteration_id, iteration_ordinal, policy_version, input_fingerprint, created_at
        ) VALUES ('assessment-1', 'run-resilience', 'iteration-1', 1, 'v2', 'assessment-input', 4);
        INSERT INTO research_run_checkpoints (
          id, run_id, attempt_id, sequence, checkpoint_key, phase, input_fingerprint, created_at
        ) VALUES ('checkpoint-1', 'run-resilience', 'attempt-1', 1, 'planning_completed', 'planning', 'planning-input', 5);
      `)

      expect(db.prepare(`
        SELECT status, workflow_run_id, error_category, error_retryable
        FROM research_run_attempts WHERE id = 'attempt-1'
      `).get()).toEqual({ status: 'queued', workflow_run_id: null, error_category: null, error_retryable: null })
      expect(db.prepare(`
        SELECT status, resume_cursor_json, replay_policy FROM research_run_checkpoints WHERE id = 'checkpoint-1'
      `).get()).toEqual({ status: 'started', resume_cursor_json: '{}', replay_policy: 'reuse' })
      expect(db.prepare(`
        SELECT status, target_question_ids_json, budget_before_json, limitations_json
        FROM research_iterations WHERE id = 'iteration-1'
      `).get()).toEqual({ status: 'planned', target_question_ids_json: '[]', budget_before_json: '{}', limitations_json: '[]' })
      expect(db.prepare(`
        SELECT aggregate_score, question_verdicts_json, limitations_json
        FROM research_coverage_assessments WHERE id = 'assessment-1'
      `).get()).toEqual({ aggregate_score: 0, question_verdicts_json: '[]', limitations_json: '[]' })

      expect(() => db.prepare(`
        INSERT INTO research_run_attempts (id, run_id, ordinal, trigger, created_at)
        VALUES ('attempt-duplicate', 'run-resilience', 1, 'retry', 6)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO research_run_checkpoints (
          id, run_id, attempt_id, sequence, checkpoint_key, phase, input_fingerprint, created_at
        ) VALUES ('checkpoint-duplicate-sequence', 'run-resilience', 'attempt-1', 1, 'different_key', 'planning', 'different-input', 6)
      `).run()).toThrow()
      db.prepare(`
        INSERT INTO research_run_attempts (id, run_id, ordinal, trigger, created_at)
        VALUES ('attempt-2', 'run-resilience', 2, 'retry', 6)
      `).run()
      expect(() => db.prepare(`
        INSERT INTO research_run_checkpoints (
          id, run_id, attempt_id, sequence, checkpoint_key, phase, input_fingerprint, created_at
        ) VALUES ('checkpoint-duplicate-fingerprint', 'run-resilience', 'attempt-2', 1, 'planning_completed', 'planning', 'planning-input', 6)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO research_run_attempts (id, run_id, ordinal, trigger, created_at)
        VALUES ('attempt-missing-run', 'missing-run', 1, 'initial', 7)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO research_run_checkpoints (
          id, run_id, attempt_id, sequence, checkpoint_key, phase, input_fingerprint, created_at
        ) VALUES ('checkpoint-missing-attempt', 'run-resilience', 'missing-attempt', 2, 'researching_started', 'researching', 'research-input', 7)
      `).run()).toThrow()
      expect(() => db.prepare(`
        INSERT INTO research_coverage_assessments (
          id, run_id, iteration_id, policy_version, input_fingerprint, created_at
        ) VALUES ('assessment-missing-iteration', 'run-resilience', 'missing-iteration', 'v2', 'missing-iteration', 7)
      `).run()).toThrow()
    } finally {
      db.close()
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
    const { legacySkillRepo } = await import('./repositories/skill.repo')

    expect(legacySkillRepo.get('legacy-1')?.name).toBe('Legacy')
    expect(tableNames()).toContain('skill_runs_v2')
  })

  it('keeps first-phase research fixture records readable after a migration upgrade', async () => {
    const { loadSqlMigrations, runSqlMigrations } = await import('./migrations')
    fs.mkdirSync(dataDir, { recursive: true })
    const db = openRawDb()
    try {
      const firstPhaseMigrations = loadSqlMigrations().filter((migration) =>
        ['008-deep-research-core', '009-deep-research-recovery-commands'].includes(migration.version)
      )
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, persona_id TEXT, model TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
      `)
      runSqlMigrations(db, firstPhaseMigrations)
      db.exec(`
        INSERT INTO research_runs (
          id, topic, profile, depth, status, phase, input_json, budget_json, created_at, updated_at
        ) VALUES ('run-legacy', 'Legacy topic', 'standard', 'standard', 'completed', 'completed', '{}', '{}', 1, 1);
        INSERT INTO research_runs (
          id, topic, profile, depth, status, phase, input_json, budget_json, resume_phase, created_at, updated_at
        ) VALUES ('run-legacy-interrupted', 'Interrupted legacy topic', 'standard', 'standard', 'interrupted', 'researching', '{}', '{}', 'researching', 1, 1);
        INSERT INTO research_runs (
          id, topic, profile, depth, status, phase, input_json, budget_json, created_at, updated_at
        ) VALUES ('run-legacy-cancelled', 'Cancelled legacy topic', 'standard', 'standard', 'cancelled', 'cancelled', '{}', '{}', 1, 1);
        INSERT INTO research_questions (
          id, run_id, ordinal, question, intent, priority, status, created_at, updated_at
        ) VALUES ('question-legacy', 'run-legacy', 1, 'What happened?', 'fact', 'high', 'covered', 1, 1);
        INSERT INTO research_sources (
          id, run_id, canonical_url, domain, source_type, selection_status, created_at, updated_at
        ) VALUES ('source-legacy', 'run-legacy', 'https://example.com/legacy', 'example.com', 'web', 'selected', 1, 1);
        INSERT INTO research_source_snapshots (
          id, run_id, source_id, content_hash, content, fetched_at, parser_version, final_url, idempotency_key, created_at
        ) VALUES ('snapshot-legacy', 'run-legacy', 'source-legacy', 'hash', 'legacy source content', 1, 'v1', 'https://example.com/legacy', 'snapshot-legacy', 1);
        INSERT INTO research_evidence (
          id, run_id, question_id, snapshot_id, passage, summary, stance, confidence, start_offset, end_offset, idempotency_key, created_at
        ) VALUES ('evidence-legacy', 'run-legacy', 'question-legacy', 'snapshot-legacy', 'legacy passage', 'legacy summary', 'supports', 0.9, 0, 14, 'evidence-legacy', 1);
      `)
    } finally {
      db.close()
    }

    const client = await loadClient()
    await client.runMigrations()

    const upgraded = openRawDb()
    try {
      expect(upgraded.prepare('SELECT topic FROM research_runs WHERE id = ?').get('run-legacy')).toEqual({ topic: 'Legacy topic' })
      expect(upgraded.prepare('SELECT canonical_url FROM research_sources WHERE id = ?').get('source-legacy')).toEqual({ canonical_url: 'https://example.com/legacy' })
      expect(upgraded.prepare(`
        SELECT passage, source_id, claim, evidence_type, entities_json, numbers_json, timeframe, relevance
        FROM research_evidence WHERE id = ?
      `).get('evidence-legacy')).toEqual({
        passage: 'legacy passage',
        source_id: '',
        claim: '',
        evidence_type: 'uncertain',
        entities_json: '[]',
        numbers_json: '[]',
        timeframe: null,
        relevance: 0,
      })
      expect(upgraded.prepare(`
        SELECT state_version, current_attempt_id, last_checkpoint_sequence, limitations_json
        FROM research_runs WHERE id = 'run-legacy-interrupted'
      `).get()).toEqual({
        state_version: 0,
        current_attempt_id: 'legacy:attempt:run-legacy-interrupted',
        last_checkpoint_sequence: 1,
        limitations_json: '[]',
      })
      expect(upgraded.prepare(`
        SELECT run_id, ordinal, trigger, status, workflow_run_id, start_checkpoint_key, end_checkpoint_key
        FROM research_run_attempts WHERE id = 'legacy:attempt:run-legacy-interrupted'
      `).get()).toEqual({
        run_id: 'run-legacy-interrupted',
        ordinal: 1,
        trigger: 'initial',
        status: 'interrupted',
        workflow_run_id: null,
        start_checkpoint_key: 'legacy:resume_from_planning',
        end_checkpoint_key: null,
      })
      expect(upgraded.prepare(`
        SELECT run_id, attempt_id, sequence, checkpoint_key, phase, status,
          resume_cursor_json, input_fingerprint, output_fingerprint, replay_policy
        FROM research_run_checkpoints WHERE id = 'legacy:checkpoint:run-legacy-interrupted'
      `).get()).toEqual({
        run_id: 'run-legacy-interrupted',
        attempt_id: 'legacy:attempt:run-legacy-interrupted',
        sequence: 1,
        checkpoint_key: 'legacy:resume_from_planning',
        phase: 'planning',
        status: 'completed',
        resume_cursor_json: '{"version":1,"nextPhase":"planning","iteration":0}',
        input_fingerprint: 'legacy:unknown',
        output_fingerprint: null,
        replay_policy: 'retry_incomplete',
      })
      expect(upgraded.prepare(`
        SELECT status FROM research_run_attempts
        WHERE run_id IN ('run-legacy', 'run-legacy-cancelled') ORDER BY run_id
      `).all()).toEqual([{ status: 'succeeded' }, { status: 'cancelled' }])
      expect(upgraded.prepare(`
        SELECT COUNT(*) AS count FROM research_run_checkpoints
        WHERE checkpoint_key = 'legacy:resume_from_planning'
      `).get()).toEqual({ count: 3 })

      expect(migrationVersions()).toEqual(loadSqlMigrations().map((migration) => migration.version))
    } finally {
      upgraded.close()
    }
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
      ).toThrow('[db:migrate] Failed to apply 999-fails:')

      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: any) => row.name)
      expect(names).not.toContain('rollback_probe')
      expect(db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get()).toEqual({ c: 0 })
      expect(() => runSqlMigrations(db, [{ version: '100-identifiable-failure', sql: 'INSERT INTO missing_table VALUES (1);' }]))
        .toThrow('[db:migrate] Failed to apply 100-identifiable-failure:')
    } finally {
      db.close()
    }
  })
})
