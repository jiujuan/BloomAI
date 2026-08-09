import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertLegacyDropGate,
  buildLegacyMigrationPlan,
  createBackupManifest,
  evaluateLegacyMigrationGate,
  reconcileLegacyMigrationCounts,
  runLegacyMigrationPlan,
  type LegacyMigrationTargetCounts,
} from './legacy-data-migration'

type MutableTarget = {
  archived: string[]
  converted: string[]
  failOn?: string
}

const targetCounts: LegacyMigrationTargetCounts = {
  packages: 2,
  versions: 2,
  installations: 2,
  runs: 3,
  artifacts: 2,
}

const sources = [
  {
    id: 'legacy-prompt', name: 'Prompt', description: 'safe', type: 'prompt-template', source: 'Hello {{name}}', version: '1.0.0',
  },
  {
    id: 'legacy-http', name: 'HTTP', description: 'review', type: 'http-api', source: JSON.stringify({ url: 'https://example.test?token=do-not-leak' }), version: '1.0.0',
  },
  {
    id: 'legacy-js', name: 'JS', description: 'blocked', type: 'js-function', source: 'process.env.SECRET', version: '1.0.0',
  },
]

let tempRoot: string | undefined

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('SKL12-P4-003 offline Legacy migration gates', () => {
  it('creates a hashed backup manifest without exposing source secrets', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p4-003-backup-'))
    const backup = createBackupManifest({
      backupDir: tempRoot,
      databasePath: 'bloomai.db',
      sourceCounts: { skills: 3, runs: 4 },
      tables: {
        skills: [{ id: 'legacy-http', source: 'Bearer do-not-leak', type: 'http-api' }],
        skill_runs: [{ id: 'legacy-run-1', input_json: '{"token":"do-not-leak"}' }],
      },
      knownSecrets: ['do-not-leak'],
      now: 1723075200000,
    })

    expect(backup.manifestPath).toContain('backup-manifest.json')
    expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(backup.sourceCounts).toEqual({ skills: 3, runs: 4 })
    const manifestText = fs.readFileSync(backup.manifestPath, 'utf8')
    expect(manifestText).not.toContain('do-not-leak')
    expect(createHash('sha256').update(manifestText).digest('hex')).toBe(backup.sha256)
  })

  it('plans conversion, read-only archive, and manual review without creating target rows for blocked sources', () => {
    const plan = buildLegacyMigrationPlan({
      sourceSkills: sources,
      sourceRunCount: 4,
      targetCountsBefore: { packages: 0, versions: 0, installations: 0, runs: 0, artifacts: 0 },
    })

    expect(plan.items.map((item) => [item.legacySkillId, item.action, item.decision])).toEqual([
      ['legacy-prompt', 'convert', 'auto_convertible'],
      ['legacy-http', 'manual_review', 'manual_review'],
      ['legacy-js', 'manual_review', 'critical_blocked'],
    ])
    expect(plan.sourceCounts).toEqual({ skills: 3, runs: 4 })
    expect(plan.expectedTargetDelta).toEqual({ packages: 1, versions: 1, installations: 1, runs: 0, artifacts: 0 })
    expect(plan.dropPlan).toMatchObject({
      allowed: false,
      tables: ['skills', 'skill_runs'],
      reason: expect.stringContaining('manual review'),
    })
  })

  it('archives every source, converts only approved candidates, and restores on failure', () => {
    const plan = buildLegacyMigrationPlan({
      sourceSkills: sources,
      sourceRunCount: 4,
      targetCountsBefore: { packages: 0, versions: 0, installations: 0, runs: 0, artifacts: 0 },
    })
    const target: MutableTarget = { archived: [], converted: [], failOn: 'legacy-prompt' }
    const archive = { skills: new Set<string>(), runs: false }

    expect(() => runLegacyMigrationPlan(plan, {
      archiveSkill: (item) => { archive.skills.add(item.legacySkillId); target.archived.push(item.legacySkillId) },
      archiveRuns: () => { archive.runs = true; target.archived.push('skill_runs') },
      convert: (item) => {
        if (item.legacySkillId === target.failOn) throw new Error('simulated conversion failure')
        target.converted.push(item.legacySkillId)
      },
      rollback: () => { target.archived = []; target.converted = []; archive.skills.clear(); archive.runs = false },
    })).toThrow('simulated conversion failure')
    expect(target).toEqual({ archived: [], converted: [], failOn: 'legacy-prompt' })
    expect(archive).toEqual({ skills: new Set(), runs: false })

    target.failOn = undefined
    const result = runLegacyMigrationPlan(plan, {
      archiveSkill: (item) => { archive.skills.add(item.legacySkillId); target.archived.push(item.legacySkillId) },
      archiveRuns: () => { archive.runs = true; target.archived.push('skill_runs') },
      convert: (item) => { target.converted.push(item.legacySkillId) },
      rollback: () => { target.archived = []; target.converted = []; archive.skills.clear(); archive.runs = false },
    })
    expect(result.status).toBe('manual_review_required')
    expect(target.archived).toEqual(['legacy-prompt', 'legacy-http', 'legacy-js', 'skill_runs'])
    expect(target.converted).toEqual(['legacy-prompt'])
    expect(result.manualReviewCount).toBe(2)
  })

  it('reconciles Package Runtime counts and refuses old-table drop until every gate is satisfied', () => {
    const before = { packages: 1, versions: 1, installations: 1, runs: 2, artifacts: 1 }
    const after = { packages: 2, versions: 2, installations: 2, runs: 2, artifacts: 1 }
    const reconciliation = reconcileLegacyMigrationCounts({
      sourceCounts: { skills: 3, runs: 4 },
      targetCountsBefore: before,
      targetCountsAfter: after,
      expectedTargetDelta: { packages: 1, versions: 1, installations: 1, runs: 0, artifacts: 0 },
      archivedCounts: { skills: 3, runs: 4 },
      manualReviewCount: 2,
      orphanedMappings: 0,
      digestMismatches: 0,
      artifactOwnershipMismatches: 0,
    })
    expect(reconciliation.ok).toBe(true)
    expect(reconciliation.deltas).toEqual({ packages: 1, versions: 1, installations: 1, runs: 0, artifacts: 0 })
    expect(evaluateLegacyMigrationGate(reconciliation)).toMatchObject({ allowed: false, reason: expect.stringContaining('manual review') })
    expect(evaluateLegacyMigrationGate({ ...reconciliation, manualReviewCount: 0 })).toEqual({ allowed: true, reason: 'all migration gates satisfied' })
    expect(() => assertLegacyDropGate(reconciliation)).toThrow(/manual review/)
    expect(() => assertLegacyDropGate({ ...reconciliation, manualReviewCount: 0 })).not.toThrow()
  })
})
