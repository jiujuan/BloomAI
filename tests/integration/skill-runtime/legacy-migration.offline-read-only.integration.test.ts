import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertLegacyDropGate,
  buildLegacyMigrationPlan,
  createBackupManifest,
  evaluateLegacyMigrationGate,
  reconcileLegacyMigrationCounts,
  runLegacyMigrationPlan,
} from '../../../src/server/skills/migration/legacy-data-migration'
import type { LegacySkillSourceInput } from '../../../src/server/skills/migration/migration.types'

let dataDir: string
let originalDataDir: string | undefined

async function loadDb() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../../src/server/db/client')
  await client.runMigrations()
  const { legacyMigrationRepo } = await import('../../../src/server/db/repositories/legacy-migration.repo')
  const schema = await import('../../../src/server/db/schema')
  return { client, legacyMigrationRepo, schema }
}

describe('offline one-time read-only Legacy migration integration', () => {
  beforeEach(() => {
    originalDataDir = process.env.DATA_DIR
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p4-004-offline-migration-'))
  })

  afterEach(async () => {
    const client = await import('../../../src/server/db/client')
    client.closeDb()
    vi.restoreAllMocks()
    vi.resetModules()
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('archives every Legacy source, converts only safe templates, and keeps old-table retirement closed', async () => {
    const { client, legacyMigrationRepo, schema } = await loadDb()
    const db = client.getOrmDb()
    const sourceSkills: LegacySkillSourceInput[] = [
      { id: 'offline-template', name: 'Template', type: 'prompt-template', source: 'Hello {{name}}', version: '1.0.0' },
      { id: 'offline-http', name: 'HTTP', type: 'http-api', source: { url: 'https://example.test/items', method: 'GET', token: 'do-not-leak' }, version: '1.0.0' },
      { id: 'offline-js', name: 'JS', type: 'js-function', source: 'return process.env.SECRET', version: '1.0.0' },
      { id: 'offline-unknown', name: 'Unknown', type: 'future-executable', source: 'not executable', version: '1.0.0' },
    ]
    const sourceRuns = [{ id: 'offline-run-1', skill_id: 'offline-http', input_json: '{"token":"do-not-leak"}' }]
    const sourceCounts = { skills: sourceSkills.length, runs: sourceRuns.length }
    const targetCountsBefore = { packages: 0, versions: 0, installations: 0, runs: 0, artifacts: 0 }
    const backup = createBackupManifest({
      backupDir: path.join(dataDir, 'backups'),
      databasePath: path.join(dataDir, 'bloomai.sqlite'),
      sourceCounts,
      tables: {
        skills: sourceSkills.map((skill) => ({ ...skill })),
        skill_runs: sourceRuns,
      },
      knownSecrets: ['do-not-leak', 'process.env.SECRET'],
      now: 1723075200000,
    })
    const backupText = fs.readFileSync(backup.manifestPath, 'utf8')
    expect(backupText).not.toContain('do-not-leak')
    expect(backupText).not.toContain('process.env.SECRET')

    const plan = buildLegacyMigrationPlan({ sourceSkills, sourceRunCount: sourceCounts.runs, targetCountsBefore, now: 1723075200000 })
    expect(plan.items.map((item) => [item.legacySkillId, item.action])).toEqual([
      ['offline-template', 'convert'],
      ['offline-http', 'manual_review'],
      ['offline-js', 'manual_review'],
      ['offline-unknown', 'manual_review'],
    ])

    const convertedTargetCounts = { ...targetCountsBefore }
    const rollback = vi.fn()
    const execution = runLegacyMigrationPlan(plan, {
      archiveSkill: (item) => {
        legacyMigrationRepo.archiveSource({
          archiveKey: `skill:${item.legacySkillId}`,
          sourceType: 'skill',
          legacySkillId: item.legacySkillId,
          sourceSha256: item.sourceSha256,
          payload: { legacySkillId: item.legacySkillId, decision: item.decision },
          redaction: { redactedCount: 0 },
          archivedAt: 1723075200000,
        })
      },
      archiveRuns: () => {
        for (const run of sourceRuns) {
          legacyMigrationRepo.archiveSource({
            archiveKey: `run:${run.id}`,
            sourceType: 'run',
            sourceSha256: 'run-source-sha',
            payload: run,
            redaction: { redactedCount: 1 },
            archivedAt: 1723075200000,
          })
        }
      },
      convert: () => {
        convertedTargetCounts.packages += 1
        convertedTargetCounts.versions += 1
        convertedTargetCounts.installations += 1
      },
      rollback,
    })

    expect(execution).toMatchObject({
      status: 'manual_review_required',
      archivedSkillCount: 4,
      archivedRunCount: 1,
      convertedSkillIds: ['offline-template'],
      manualReviewCount: 3,
      rollbackPerformed: false,
    })
    expect(rollback).not.toHaveBeenCalled()
    expect(db.select().from(schema.skill_legacy_archives).all()).toHaveLength(5)
    expect(db.select().from(schema.skill_legacy_archives).all().every((row) => row.read_only === 1)).toBe(true)

    const reconciliation = reconcileLegacyMigrationCounts({
      sourceCounts,
      targetCountsBefore,
      targetCountsAfter: convertedTargetCounts,
      expectedTargetDelta: plan.expectedTargetDelta,
      archivedCounts: sourceCounts,
      manualReviewCount: execution.manualReviewCount,
      orphanedMappings: 0,
      digestMismatches: 0,
      artifactOwnershipMismatches: 0,
    })
    expect(reconciliation).toMatchObject({ ok: true, deltaMatches: true, archiveComplete: true, manualReviewCount: 3 })
    expect(evaluateLegacyMigrationGate(reconciliation)).toEqual({
      allowed: false,
      reason: '3 Legacy record(s) still require manual review',
    })
    expect(() => assertLegacyDropGate(reconciliation)).toThrow('Refusing to drop Legacy tables')

    const migrationRun = legacyMigrationRepo.createRun({
      id: 'offline-run-record',
      phase: 'offline-verification',
      status: 'manual_review_required',
      backupManifestPath: backup.manifestPath,
      backupManifestSha256: backup.sha256,
      sourceCounts,
      targetCountsBefore,
      targetCountsAfter: convertedTargetCounts,
      reconciliation,
      manualReviewCount: execution.manualReviewCount,
      gateStatus: 'blocked_manual_review',
      rollback: { retained: true, dropOldTables: false },
      createdAt: 1723075200000,
      updatedAt: 1723075200000,
    })
    expect(migrationRun).toMatchObject({ phase: 'offline-verification', status: 'manual_review_required', gateStatus: 'blocked_manual_review' })
    expect(legacyMigrationRepo.getRun('offline-run-record')).toMatchObject({ backupManifestSha256: backup.sha256, manualReviewCount: 3 })
  })

  it('executes rollback on conversion failure without contacting the network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'))
    const rollback = vi.fn()
    const plan = buildLegacyMigrationPlan({
      sourceSkills: [{ id: 'offline-failure', type: 'prompt-template', source: 'Hello' }],
      sourceRunCount: 0,
      targetCountsBefore: { packages: 0, versions: 0, installations: 0, runs: 0, artifacts: 0 },
      now: 1723075200000,
    })

    expect(() => runLegacyMigrationPlan(plan, {
      archiveSkill: () => undefined,
      archiveRuns: () => undefined,
      convert: () => { throw new Error('simulated offline conversion failure') },
      rollback,
    })).toThrow('simulated offline conversion failure')
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
