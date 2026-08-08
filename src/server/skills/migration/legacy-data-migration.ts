import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { inspectLegacyMigration } from './migration-preview.service'
import { canonicalJsonString } from './source-normalizer'
import { redactSecrets } from './secret-redactor'
import type { MigrationPreview, LegacySkillSourceInput } from './migration.types'

export type LegacyMigrationTargetCounts = {
  packages: number
  versions: number
  installations: number
  runs: number
  artifacts: number
}

export type LegacyMigrationSourceCounts = {
  skills: number
  runs: number
}

export type LegacyMigrationItem = {
  legacySkillId: string
  sourceSha256: string
  decision: MigrationPreview['result']['decision']
  lifecycle: MigrationPreview['lifecycle']
  action: 'convert' | 'manual_review'
  preview: MigrationPreview
}

export type LegacyMigrationPlan = {
  createdAt: number
  items: LegacyMigrationItem[]
  sourceCounts: LegacyMigrationSourceCounts
  targetCountsBefore: LegacyMigrationTargetCounts
  expectedTargetDelta: LegacyMigrationTargetCounts
  dropPlan: {
    allowed: false
    tables: ['skills', 'skill_runs']
    reason: string
  }
}

export type LegacyMigrationExecutionResult = {
  status: 'migration_ready' | 'manual_review_required'
  archivedSkillCount: number
  archivedRunCount: number
  convertedSkillIds: string[]
  manualReviewCount: number
  rollbackPerformed: boolean
}

export type LegacyMigrationExecutor = {
  archiveSkill(item: LegacyMigrationItem): void
  archiveRuns(): void
  convert(item: LegacyMigrationItem): void
  rollback(): void
}

export type LegacyMigrationReconciliation = {
  sourceCounts: LegacyMigrationSourceCounts
  targetCountsBefore: LegacyMigrationTargetCounts
  targetCountsAfter: LegacyMigrationTargetCounts
  expectedTargetDelta: LegacyMigrationTargetCounts
  deltas: LegacyMigrationTargetCounts
  archivedCounts: LegacyMigrationSourceCounts
  manualReviewCount: number
  orphanedMappings: number
  digestMismatches: number
  artifactOwnershipMismatches: number
  deltaMatches: boolean
  archiveComplete: boolean
  ok: boolean
}

export type LegacyMigrationGate = {
  allowed: boolean
  reason: string
}

export type BackupManifestInput = {
  backupDir: string
  databasePath: string
  sourceCounts: LegacyMigrationSourceCounts
  tables: Record<string, readonly Record<string, unknown>[]>
  knownSecrets?: readonly string[]
  now?: number
}

export type BackupManifest = {
  manifestPath: string
  sha256: string
  databasePath: string
  createdAt: number
  sourceCounts: LegacyMigrationSourceCounts
  tableDigests: Record<string, string>
}

const TARGET_COUNT_KEYS: readonly (keyof LegacyMigrationTargetCounts)[] = ['packages', 'versions', 'installations', 'runs', 'artifacts']

export function buildLegacyMigrationPlan(input: {
  sourceSkills: readonly LegacySkillSourceInput[]
  sourceRunCount: number
  targetCountsBefore: LegacyMigrationTargetCounts
  now?: number
}): LegacyMigrationPlan {
  const items = input.sourceSkills.map((source) => {
    const preview = inspectLegacyMigration({ ...source, legacySkillId: source.legacySkillId ?? source.id })
    const action: LegacyMigrationItem['action'] = preview.result.decision === 'auto_convertible' && preview.lifecycle === 'migration_previewed' ? 'convert' : 'manual_review'
    return {
      legacySkillId: preview.legacySkillId,
      sourceSha256: preview.sourceSha256,
      decision: preview.result.decision,
      lifecycle: preview.lifecycle,
      action,
      preview,
    }
  })
  const convertibleCount = items.filter((item) => item.action === 'convert').length
  const expectedTargetDelta: LegacyMigrationTargetCounts = {
    packages: convertibleCount,
    versions: convertibleCount,
    installations: convertibleCount,
    runs: 0,
    artifacts: 0,
  }
  const manualReviewCount = items.length - convertibleCount
  return {
    createdAt: input.now ?? Date.now(),
    items,
    sourceCounts: { skills: input.sourceSkills.length, runs: input.sourceRunCount },
    targetCountsBefore: { ...input.targetCountsBefore },
    expectedTargetDelta,
    dropPlan: {
      allowed: false,
      tables: ['skills', 'skill_runs'],
      reason: manualReviewCount > 0
        ? `${manualReviewCount} Legacy source(s) require manual review before old-table retirement`
        : 'old-table retirement requires a post-run reconciliation and an explicit release gate',
    },
  }
}

export function runLegacyMigrationPlan(plan: LegacyMigrationPlan, executor: LegacyMigrationExecutor): LegacyMigrationExecutionResult {
  let archivedSkillCount = 0
  let archiveRunsCompleted = false
  const convertedSkillIds: string[] = []
  let rollbackPerformed = false
  try {
    for (const item of plan.items) {
      executor.archiveSkill(item)
      archivedSkillCount += 1
    }
    executor.archiveRuns()
    archiveRunsCompleted = true
    for (const item of plan.items.filter((candidate) => candidate.action === 'convert')) {
      executor.convert(item)
      convertedSkillIds.push(item.legacySkillId)
    }
    const manualReviewCount = plan.items.length - convertedSkillIds.length
    return {
      status: manualReviewCount > 0 ? 'manual_review_required' : 'migration_ready',
      archivedSkillCount,
      archivedRunCount: plan.sourceCounts.runs,
      convertedSkillIds,
      manualReviewCount,
      rollbackPerformed,
    }
  } catch (error) {
    executor.rollback()
    rollbackPerformed = true
    // Keep the local variables in the error path observable in a debugger and in
    // future structured logging without exposing source payloads.
    void archivedSkillCount
    void archiveRunsCompleted
    void convertedSkillIds
    void rollbackPerformed
    throw error
  }
}

export function createBackupManifest(input: BackupManifestInput): BackupManifest {
  fs.mkdirSync(input.backupDir, { recursive: true })
  const tableDigests: Record<string, string> = {}
  const redactedTables: Record<string, readonly Record<string, unknown>[]> = {}
  for (const tableName of Object.keys(input.tables).sort()) {
    const redactedRows = input.tables[tableName].map((row) => redactSecrets(row, { knownSecrets: input.knownSecrets }))
    redactedTables[tableName] = redactedRows
    tableDigests[tableName] = sha256(canonicalJsonString(redactedRows))
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'legacy-migration-backup',
    databasePath: path.basename(input.databasePath),
    createdAt: input.now ?? Date.now(),
    sourceCounts: input.sourceCounts,
    tables: redactedTables,
    tableDigests,
    restore: {
      mode: 'logical-read-only-archive',
      retained: true,
      dropOldTables: false,
    },
  }
  const content = `${canonicalJsonString(manifest)}\n`
  const manifestPath = path.join(input.backupDir, 'backup-manifest.json')
  fs.writeFileSync(manifestPath, content, 'utf8')
  return {
    manifestPath,
    sha256: sha256(content),
    databasePath: manifest.databasePath,
    createdAt: manifest.createdAt,
    sourceCounts: { ...input.sourceCounts },
    tableDigests,
  }
}

export function reconcileLegacyMigrationCounts(input: {
  sourceCounts: LegacyMigrationSourceCounts
  targetCountsBefore: LegacyMigrationTargetCounts
  targetCountsAfter: LegacyMigrationTargetCounts
  expectedTargetDelta: LegacyMigrationTargetCounts
  archivedCounts: LegacyMigrationSourceCounts
  manualReviewCount: number
  orphanedMappings: number
  digestMismatches: number
  artifactOwnershipMismatches: number
}): LegacyMigrationReconciliation {
  const deltas = Object.fromEntries(TARGET_COUNT_KEYS.map((key) => [key, input.targetCountsAfter[key] - input.targetCountsBefore[key]])) as LegacyMigrationTargetCounts
  const deltaMatches = TARGET_COUNT_KEYS.every((key) => deltas[key] === input.expectedTargetDelta[key])
  const archiveComplete = input.archivedCounts.skills === input.sourceCounts.skills && input.archivedCounts.runs === input.sourceCounts.runs
  const ok = deltaMatches && archiveComplete && input.orphanedMappings === 0 && input.digestMismatches === 0 && input.artifactOwnershipMismatches === 0
  return {
    sourceCounts: { ...input.sourceCounts },
    targetCountsBefore: { ...input.targetCountsBefore },
    targetCountsAfter: { ...input.targetCountsAfter },
    expectedTargetDelta: { ...input.expectedTargetDelta },
    deltas,
    archivedCounts: { ...input.archivedCounts },
    manualReviewCount: input.manualReviewCount,
    orphanedMappings: input.orphanedMappings,
    digestMismatches: input.digestMismatches,
    artifactOwnershipMismatches: input.artifactOwnershipMismatches,
    deltaMatches,
    archiveComplete,
    ok,
  }
}

export function evaluateLegacyMigrationGate(reconciliation: LegacyMigrationReconciliation): LegacyMigrationGate {
  if (!reconciliation.ok) {
    if (!reconciliation.deltaMatches) return { allowed: false, reason: 'Package Runtime count delta does not match the migration plan' }
    if (!reconciliation.archiveComplete) return { allowed: false, reason: 'Legacy source archive is incomplete' }
    if (reconciliation.orphanedMappings > 0) return { allowed: false, reason: 'orphaned migration mappings remain' }
    if (reconciliation.digestMismatches > 0) return { allowed: false, reason: 'digest mismatches remain' }
    return { allowed: false, reason: 'Artifact ownership mismatches remain' }
  }
  if (reconciliation.manualReviewCount > 0) return { allowed: false, reason: `${reconciliation.manualReviewCount} Legacy record(s) still require manual review` }
  return { allowed: true, reason: 'all migration gates satisfied' }
}

export function assertLegacyDropGate(reconciliation: LegacyMigrationReconciliation): void {
  const gate = evaluateLegacyMigrationGate(reconciliation)
  if (!gate.allowed) throw new Error(`Refusing to drop Legacy tables: ${gate.reason}`)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
