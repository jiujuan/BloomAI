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
    expect(migrationVersions()).toHaveLength(19)

    const secondRun = runMigrationCli(dataDir)
    expect(secondRun.status).toBe(0)
    expect(secondRun.stdout).toContain('up to date')
    expect(migrationVersions()).toHaveLength(19)
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
        'research_runs',
        'research_questions',
        'research_search_queries',
        'research_sources',
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
    ])
    const emptyDb = openRawDb()
    try {
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
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_report_sections') WHERE name = 'section_key'").all()).toEqual([
        { name: 'section_key' },
      ])
      expect(emptyDb.prepare("SELECT name FROM pragma_table_info('research_search_queries') WHERE name IN ('query_intent', 'source_targets_json', 'dedupe_key') ORDER BY name").all()).toEqual([
        { name: 'dedupe_key' },
        { name: 'query_intent' },
        { name: 'source_targets_json' },
      ])
    } finally {
      emptyDb.close()
    }

    expect(uniqueIndexColumnSets('research_events')).toContainEqual(['run_id', 'sequence'])
    expect(uniqueIndexColumnSets('research_sources')).toContainEqual(['run_id', 'canonical_url'])
    expect(uniqueIndexColumnSets('research_recovery_commands')).toContainEqual(['run_id', 'command_key'])
    expect(uniqueIndexColumnSets('research_reconciliations')).toContainEqual(['run_id', 'reconciliation_key'])
    expect(uniqueIndexColumnSets('research_run_attempts')).toContainEqual(['run_id', 'ordinal'])
    expect(uniqueIndexColumnSets('research_run_checkpoints')).toContainEqual(['attempt_id', 'sequence'])
    expect(uniqueIndexColumnSets('research_run_checkpoints')).toContainEqual(['run_id', 'checkpoint_key', 'input_fingerprint'])
    expect(uniqueIndexColumnSets('research_iterations')).toContainEqual(['run_id', 'ordinal'])
    expect(uniqueIndexColumnSets('research_coverage_assessments')).toContainEqual(['run_id', 'iteration_ordinal', 'policy_version', 'input_fingerprint'])

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
    const { skillRepo } = await import('./repositories/skill.repo')

    expect(skillRepo.get('legacy-1')?.name).toBe('Legacy')
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
      expect(upgraded.prepare('SELECT passage FROM research_evidence WHERE id = ?').get('evidence-legacy')).toEqual({ passage: 'legacy passage' })
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
    } finally {
      db.close()
    }
  })
})
