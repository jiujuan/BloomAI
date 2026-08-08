import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalDataDir: string | undefined

async function loadDb() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('./client')
  await client.runMigrations()
  return { client, schema: await import('./schema'), repo: await import('./repositories/legacy-migration.repo') }
}

describe('SKL12-P4-003 durable archive and migration run records', () => {
  beforeEach(() => {
    originalDataDir = process.env.DATA_DIR
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p4-003-db-'))
  })

  afterEach(async () => {
    const client = await import('./client')
    client.closeDb()
    vi.resetModules()
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('persists read-only source archives and resumable gate snapshots', async () => {
    const { client, repo } = await loadDb()
    const db = client.getOrmDb()
    db.insert((await import('./schema')).skills).values({
      id: 'legacy-archive-1', name: 'Archived', description: 'old', type: 'prompt-template', source: 'Hello',
      params_schema: '{}', author: 'legacy', version: '1.0.0', is_public: 0, is_installed: 1, install_count: 0, created_at: 1723075200000,
    }).run()

    const archive = repo.legacyMigrationRepo.archiveSource({
      archiveKey: 'skill:legacy-archive-1',
      sourceType: 'skill',
      legacySkillId: 'legacy-archive-1',
      sourceSha256: 'source-sha',
      payload: { id: 'legacy-archive-1', source: 'Hello' },
      redaction: { redactedCount: 0, keyRedactions: 0, valueRedactions: 0 },
    })
    expect(archive).toMatchObject({ archiveKey: 'skill:legacy-archive-1', sourceType: 'skill', readOnly: true })
    expect(repo.legacyMigrationRepo.archiveSource({
      archiveKey: 'skill:legacy-archive-1', sourceType: 'skill', legacySkillId: 'legacy-archive-1', sourceSha256: 'source-sha', payload: { id: 'legacy-archive-1', source: 'Hello' }, redaction: { redactedCount: 0, keyRedactions: 0, valueRedactions: 0 },
    }).id).toBe(archive.id)

    const run = repo.legacyMigrationRepo.createRun({
      id: 'migration-run-1', phase: 'M4', status: 'manual_review_required',
      backupManifestPath: 'backup/backup-manifest.json', backupManifestSha256: 'backup-sha',
      sourceCounts: { skills: 1, runs: 0 },
      targetCountsBefore: { packages: 0, versions: 0, installations: 0, runs: 0, artifacts: 0 },
      targetCountsAfter: { packages: 1, versions: 1, installations: 1, runs: 0, artifacts: 0 },
      reconciliation: { ok: true, manualReviewCount: 1 },
      manualReviewCount: 1, gateStatus: 'blocked_manual_review',
      rollback: { backupRetained: true, restoreCommand: 'offline' },
    })
    expect(run).toMatchObject({ id: 'migration-run-1', phase: 'M4', status: 'manual_review_required', manualReviewCount: 1, gateStatus: 'blocked_manual_review' })
    expect(repo.legacyMigrationRepo.getRun(run.id)).toMatchObject({ backupManifestSha256: 'backup-sha', reconciliation: { ok: true, manualReviewCount: 1 } })
    expect(repo.legacyMigrationRepo.listRuns()).toHaveLength(1)

    const resumed = repo.legacyMigrationRepo.updateRun({
      id: run.id,
      expectedUpdatedAt: run.updatedAt,
      status: 'running',
      gateStatus: 'in_progress',
      lastError: null,
    })
    expect(resumed).toMatchObject({ status: 'running', gateStatus: 'in_progress', lastError: null })
    expect(repo.legacyMigrationRepo.updateRun({ id: run.id, expectedUpdatedAt: run.updatedAt, status: 'stale' })).toBeUndefined()

    const failed = repo.legacyMigrationRepo.markRunFailed({
      id: run.id,
      expectedUpdatedAt: resumed!.updatedAt,
      error: 'simulated conversion failure',
      rollback: { backupRetained: true },
    })
    expect(failed).toMatchObject({ status: 'failed', gateStatus: 'blocked_failure', lastError: 'simulated conversion failure', rollback: { backupRetained: true } })
  })
})
