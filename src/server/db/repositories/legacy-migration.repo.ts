import { and, desc, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { skill_legacy_archives, skill_legacy_migration_runs, skill_legacy_migrations } from '../schema'
import { ServiceError } from '../../services/errors'

export type LegacyMigrationDecision = 'auto_convertible' | 'manual_review' | 'critical_blocked' | 'unsupported'
export type LegacyMigrationStatus = 'legacy_archive' | 'migration_previewed' | 'manual_review_required' | 'migration_published' | 'migration_blocked'

export type LegacyMigrationRecord = {
  id: string
  legacySkillId: string
  legacyType: string
  sourceSha256: string
  decision: LegacyMigrationDecision
  status: LegacyMigrationStatus
  packageId: string | null
  packageVersionId: string | null
  reportArtifactId: string | null
  ownerId: string
  createdBy: string
  preview: Record<string, unknown>
  warnings: unknown[]
  sideEffects: Record<string, unknown>
  lastError: string | null
  revision: number
  createdAt: number
  updatedAt: number
  publishedAt: number | null
}

export type CreateLegacyMigrationInput = {
  legacySkillId: string
  legacyType: string
  sourceSha256: string
  decision: LegacyMigrationDecision
  status: LegacyMigrationStatus
  ownerId: string
  createdBy: string
  preview?: Record<string, unknown>
  warnings?: unknown[]
  sideEffects?: Record<string, unknown>
}

export type LegacyArchiveRecord = {
  id: string
  archiveKey: string
  sourceType: string
  legacySkillId: string | null
  sourceSha256: string
  payload: Record<string, unknown>
  redaction: Record<string, unknown>
  readOnly: boolean
  archivedAt: number
}

export type ArchiveLegacySourceInput = {
  id?: string
  archiveKey: string
  sourceType: string
  legacySkillId?: string | null
  sourceSha256: string
  payload?: Record<string, unknown>
  redaction?: Record<string, unknown>
  archivedAt?: number
}

export type LegacyMigrationRunRecord = {
  id: string
  phase: string
  status: string
  backupManifestPath: string
  backupManifestSha256: string
  sourceCounts: Record<string, unknown>
  targetCountsBefore: Record<string, unknown>
  targetCountsAfter: Record<string, unknown>
  reconciliation: Record<string, unknown>
  manualReviewCount: number
  gateStatus: string
  rollback: Record<string, unknown>
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export type CreateLegacyMigrationRunInput = {
  id?: string
  phase: string
  status: string
  backupManifestPath: string
  backupManifestSha256: string
  sourceCounts?: Record<string, unknown>
  targetCountsBefore?: Record<string, unknown>
  targetCountsAfter?: Record<string, unknown>
  reconciliation?: Record<string, unknown>
  manualReviewCount?: number
  gateStatus: string
  rollback?: Record<string, unknown>
  lastError?: string | null
  createdAt?: number
  updatedAt?: number
}

export type UpdateLegacyMigrationRunInput = {
  id: string
  expectedUpdatedAt?: number
  phase?: string
  status?: string
  backupManifestPath?: string
  backupManifestSha256?: string
  sourceCounts?: Record<string, unknown>
  targetCountsBefore?: Record<string, unknown>
  targetCountsAfter?: Record<string, unknown>
  reconciliation?: Record<string, unknown>
  manualReviewCount?: number
  gateStatus?: string
  rollback?: Record<string, unknown>
  lastError?: string | null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function mapRow(row: any): LegacyMigrationRecord {
  return {
    id: row.id,
    legacySkillId: row.legacy_skill_id,
    legacyType: row.legacy_type,
    sourceSha256: row.source_sha256,
    decision: row.decision,
    status: row.status,
    packageId: row.package_id ?? null,
    packageVersionId: row.package_version_id ?? null,
    reportArtifactId: row.report_artifact_id ?? null,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    preview: parseJson(row.preview_json, {}),
    warnings: parseJson(row.warnings_json, []),
    sideEffects: parseJson(row.side_effects_json, {}),
    lastError: row.last_error ?? null,
    revision: Number(row.revision ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    publishedAt: row.published_at ?? null,
  }
}

function mapArchiveRow(row: any): LegacyArchiveRecord {
  return {
    id: row.id,
    archiveKey: row.archive_key,
    sourceType: row.source_type,
    legacySkillId: row.legacy_skill_id ?? null,
    sourceSha256: row.source_sha256,
    payload: parseJson(row.payload_json, {}),
    redaction: parseJson(row.redaction_json, {}),
    readOnly: Number(row.read_only ?? 1) === 1,
    archivedAt: Number(row.archived_at),
  }
}

function mapRunRow(row: any): LegacyMigrationRunRecord {
  return {
    id: row.id,
    phase: row.phase,
    status: row.status,
    backupManifestPath: row.backup_manifest_path,
    backupManifestSha256: row.backup_manifest_sha256,
    sourceCounts: parseJson(row.source_counts_json, {}),
    targetCountsBefore: parseJson(row.target_counts_before_json, {}),
    targetCountsAfter: parseJson(row.target_counts_after_json, {}),
    reconciliation: parseJson(row.reconciliation_json, {}),
    manualReviewCount: Number(row.manual_review_count ?? 0),
    gateStatus: row.gate_status,
    rollback: parseJson(row.rollback_json, {}),
    lastError: row.last_error ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function getArchiveRowByKey(archiveKey: string) {
  return getOrmDb().select().from(skill_legacy_archives).where(eq(skill_legacy_archives.archive_key, archiveKey)).get()
}

function getRunRow(id: string) {
  return getOrmDb().select().from(skill_legacy_migration_runs).where(eq(skill_legacy_migration_runs.id, id)).get()
}

function assertArchiveIdentity(existing: LegacyArchiveRecord, input: ArchiveLegacySourceInput): void {
  const sameIdentity = existing.sourceType === input.sourceType
    && existing.legacySkillId === (input.legacySkillId ?? null)
    && existing.sourceSha256 === input.sourceSha256
  if (!sameIdentity) throw new ServiceError('CONFLICT', 'Legacy archive key is already bound to a different source')
}

function getBySource(legacySkillId: string, sourceSha256: string) {
  return getOrmDb().select().from(skill_legacy_migrations).where(and(
    eq(skill_legacy_migrations.legacy_skill_id, legacySkillId),
    eq(skill_legacy_migrations.source_sha256, sourceSha256),
  )).get()
}

function assertStateShape(status: LegacyMigrationStatus, decision: LegacyMigrationDecision): void {
  const valid = (status === 'legacy_archive' && decision === 'unsupported')
    || (status === 'migration_previewed' && decision === 'auto_convertible')
    || (status === 'manual_review_required' && decision === 'manual_review')
    || (status === 'migration_published' && decision === 'auto_convertible')
    || (status === 'migration_blocked' && (decision === 'critical_blocked' || decision === 'unsupported'))
  if (!valid) throw new ServiceError('INVALID_RUN_TRANSITION', `Invalid migration state: ${status}/${decision}`)
}

function assertAllowedTransition(currentStatus: LegacyMigrationStatus, nextStatus: LegacyMigrationStatus): void {
  const allowed: Record<LegacyMigrationStatus, readonly LegacyMigrationStatus[]> = {
    legacy_archive: ['legacy_archive', 'migration_previewed', 'manual_review_required', 'migration_blocked'],
    migration_previewed: ['migration_previewed', 'migration_published', 'migration_blocked'],
    manual_review_required: ['manual_review_required', 'migration_blocked'],
    migration_published: ['migration_published'],
    migration_blocked: ['migration_blocked'],
  }
  if (!allowed[currentStatus].includes(nextStatus)) {
    throw new ServiceError('INVALID_RUN_TRANSITION', `Invalid migration status transition: ${currentStatus} -> ${nextStatus}`)
  }
}

export const legacyMigrationRepo = {
  archiveSource(input: ArchiveLegacySourceInput): LegacyArchiveRecord {
    const existingRow = getArchiveRowByKey(input.archiveKey)
    if (existingRow) {
      const existing = mapArchiveRow(existingRow)
      assertArchiveIdentity(existing, input)
      return existing
    }

    const row = {
      id: input.id ?? uuidv4(),
      archive_key: input.archiveKey,
      source_type: input.sourceType,
      legacy_skill_id: input.legacySkillId ?? null,
      source_sha256: input.sourceSha256,
      payload_json: JSON.stringify(input.payload ?? {}),
      redaction_json: JSON.stringify(input.redaction ?? {}),
      read_only: 1,
      archived_at: input.archivedAt ?? Date.now(),
    }
    try {
      getOrmDb().insert(skill_legacy_archives).values(row).run()
      return mapArchiveRow(row)
    } catch (error) {
      const concurrentRow = getArchiveRowByKey(input.archiveKey)
      if (concurrentRow) {
        const concurrent = mapArchiveRow(concurrentRow)
        assertArchiveIdentity(concurrent, input)
        return concurrent
      }
      throw error
    }
  },

  getArchive(id: string): LegacyArchiveRecord | undefined {
    const row = getOrmDb().select().from(skill_legacy_archives).where(eq(skill_legacy_archives.id, id)).get()
    return row ? mapArchiveRow(row) : undefined
  },

  getArchiveByKey(archiveKey: string): LegacyArchiveRecord | undefined {
    const row = getArchiveRowByKey(archiveKey)
    return row ? mapArchiveRow(row) : undefined
  },

  listArchives(): LegacyArchiveRecord[] {
    return getOrmDb().select().from(skill_legacy_archives)
      .orderBy(desc(skill_legacy_archives.archived_at), desc(skill_legacy_archives.archive_key))
      .all()
      .map(mapArchiveRow)
  },

  createRun(input: CreateLegacyMigrationRunInput): LegacyMigrationRunRecord {
    const id = input.id ?? uuidv4()
    const existingRow = getRunRow(id)
    if (existingRow) {
      const existing = mapRunRow(existingRow)
      if (existing.backupManifestPath !== input.backupManifestPath || existing.backupManifestSha256 !== input.backupManifestSha256) {
        throw new ServiceError('CONFLICT', 'Migration run id is already bound to a different backup manifest')
      }
      return existing
    }

    const now = input.createdAt ?? input.updatedAt ?? Date.now()
    const row = {
      id,
      phase: input.phase,
      status: input.status,
      backup_manifest_path: input.backupManifestPath,
      backup_manifest_sha256: input.backupManifestSha256,
      source_counts_json: JSON.stringify(input.sourceCounts ?? {}),
      target_counts_before_json: JSON.stringify(input.targetCountsBefore ?? {}),
      target_counts_after_json: JSON.stringify(input.targetCountsAfter ?? {}),
      reconciliation_json: JSON.stringify(input.reconciliation ?? {}),
      manual_review_count: input.manualReviewCount ?? 0,
      gate_status: input.gateStatus,
      rollback_json: JSON.stringify(input.rollback ?? {}),
      last_error: input.lastError ?? null,
      created_at: input.createdAt ?? now,
      updated_at: input.updatedAt ?? now,
    }
    try {
      getOrmDb().insert(skill_legacy_migration_runs).values(row).run()
      return mapRunRow(row)
    } catch (error) {
      const concurrentRow = getRunRow(id)
      if (concurrentRow) {
        const concurrent = mapRunRow(concurrentRow)
        if (concurrent.backupManifestPath !== input.backupManifestPath || concurrent.backupManifestSha256 !== input.backupManifestSha256) {
          throw new ServiceError('CONFLICT', 'Migration run id is already bound to a different backup manifest')
        }
        return concurrent
      }
      throw error
    }
  },

  getRun(id: string): LegacyMigrationRunRecord | undefined {
    const row = getRunRow(id)
    return row ? mapRunRow(row) : undefined
  },

  listRuns(): LegacyMigrationRunRecord[] {
    return getOrmDb().select().from(skill_legacy_migration_runs)
      .orderBy(desc(skill_legacy_migration_runs.updated_at), desc(skill_legacy_migration_runs.id))
      .all()
      .map(mapRunRow)
  },

  updateRun(input: UpdateLegacyMigrationRunInput): LegacyMigrationRunRecord | undefined {
    const currentRow = getRunRow(input.id)
    if (!currentRow) return undefined
    if (input.expectedUpdatedAt !== undefined && Number(currentRow.updated_at) !== input.expectedUpdatedAt) return undefined
    if (input.phase !== undefined && input.phase.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Migration phase cannot be empty')
    if (input.status !== undefined && input.status.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Migration status cannot be empty')
    if (input.backupManifestPath !== undefined && input.backupManifestPath.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Backup manifest path cannot be empty')
    if (input.backupManifestSha256 !== undefined && input.backupManifestSha256.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Backup manifest hash cannot be empty')
    if (input.gateStatus !== undefined && input.gateStatus.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Migration gate status cannot be empty')
    if (input.manualReviewCount !== undefined && (!Number.isInteger(input.manualReviewCount) || input.manualReviewCount < 0)) {
      throw new ServiceError('VALIDATION_ERROR', 'Manual review count must be a non-negative integer')
    }

    const now = Date.now()
    const patch = {
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.backupManifestPath === undefined ? {} : { backup_manifest_path: input.backupManifestPath }),
      ...(input.backupManifestSha256 === undefined ? {} : { backup_manifest_sha256: input.backupManifestSha256 }),
      ...(input.sourceCounts === undefined ? {} : { source_counts_json: JSON.stringify(input.sourceCounts) }),
      ...(input.targetCountsBefore === undefined ? {} : { target_counts_before_json: JSON.stringify(input.targetCountsBefore) }),
      ...(input.targetCountsAfter === undefined ? {} : { target_counts_after_json: JSON.stringify(input.targetCountsAfter) }),
      ...(input.reconciliation === undefined ? {} : { reconciliation_json: JSON.stringify(input.reconciliation) }),
      ...(input.manualReviewCount === undefined ? {} : { manual_review_count: input.manualReviewCount }),
      ...(input.gateStatus === undefined ? {} : { gate_status: input.gateStatus }),
      ...(input.rollback === undefined ? {} : { rollback_json: JSON.stringify(input.rollback) }),
      ...(input.lastError === undefined ? {} : { last_error: input.lastError }),
      updated_at: now,
    }
    const where = input.expectedUpdatedAt === undefined
      ? eq(skill_legacy_migration_runs.id, input.id)
      : and(eq(skill_legacy_migration_runs.id, input.id), eq(skill_legacy_migration_runs.updated_at, input.expectedUpdatedAt))
    const result = getOrmDb().update(skill_legacy_migration_runs).set(patch).where(where).run()
    return result.changes === 1 ? this.getRun(input.id) : undefined
  },

  markRunFailed(input: {
    id: string
    error: string
    rollback?: Record<string, unknown>
    expectedUpdatedAt?: number
    gateStatus?: string
  }): LegacyMigrationRunRecord | undefined {
    if (input.error.trim() === '') throw new ServiceError('VALIDATION_ERROR', 'Migration failure reason cannot be empty')
    return this.updateRun({
      id: input.id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      status: 'failed',
      gateStatus: input.gateStatus ?? 'blocked_failure',
      rollback: input.rollback,
      lastError: input.error,
    })
  },

  get(id: string): LegacyMigrationRecord | undefined {
    const row = getOrmDb().select().from(skill_legacy_migrations).where(eq(skill_legacy_migrations.id, id)).get()
    return row ? mapRow(row) : undefined
  },

  findBySource(legacySkillId: string, sourceSha256: string): LegacyMigrationRecord | undefined {
    const row = getBySource(legacySkillId, sourceSha256)
    return row ? mapRow(row) : undefined
  },

  listByLegacySkill(legacySkillId: string): LegacyMigrationRecord[] {
    return getOrmDb().select().from(skill_legacy_migrations)
      .where(eq(skill_legacy_migrations.legacy_skill_id, legacySkillId))
      .orderBy(desc(skill_legacy_migrations.created_at))
      .all()
      .map(mapRow)
  },

  createPreview(input: CreateLegacyMigrationInput): LegacyMigrationRecord {
    assertStateShape(input.status, input.decision)
    const existing = getBySource(input.legacySkillId, input.sourceSha256)
    if (existing) {
      if (existing.owner_id !== input.ownerId) throw new ServiceError('FORBIDDEN', 'Migration owner does not match existing preview')
      return mapRow(existing)
    }
    const now = Date.now()
    const row = {
      id: uuidv4(),
      legacy_skill_id: input.legacySkillId,
      legacy_type: input.legacyType,
      source_sha256: input.sourceSha256,
      decision: input.decision,
      status: input.status,
      package_id: null,
      package_version_id: null,
      report_artifact_id: null,
      owner_id: input.ownerId,
      created_by: input.createdBy,
      preview_json: JSON.stringify(input.preview ?? {}),
      warnings_json: JSON.stringify(input.warnings ?? []),
      side_effects_json: JSON.stringify(input.sideEffects ?? {}),
      last_error: null,
      revision: 1,
      created_at: now,
      updated_at: now,
      published_at: null,
    }
    try {
      getOrmDb().insert(skill_legacy_migrations).values(row).run()
      return mapRow(row)
    } catch (error) {
      // A concurrent preview may win the unique (legacy id, source hash) race.
      const concurrent = getBySource(input.legacySkillId, input.sourceSha256)
      if (concurrent) return mapRow(concurrent)
      throw error
    }
  },

  updateValidation(input: {
    id: string
    ownerId: string
    expectedRevision: number
    status?: LegacyMigrationStatus
    decision?: LegacyMigrationDecision
    preview?: Record<string, unknown>
    warnings?: unknown[]
    sideEffects?: Record<string, unknown>
    lastError?: string | null
  }): LegacyMigrationRecord | undefined {
    const currentRow = getOrmDb().select().from(skill_legacy_migrations).where(eq(skill_legacy_migrations.id, input.id)).get()
    if (!currentRow) return undefined
    if (currentRow.owner_id !== input.ownerId) throw new ServiceError('FORBIDDEN', 'Migration owner does not match')
    if (Number(currentRow.revision) !== input.expectedRevision) return undefined
    const currentStatus = currentRow.status as LegacyMigrationStatus
    const currentDecision = currentRow.decision as LegacyMigrationDecision
    const nextStatus = input.status ?? currentStatus
    const nextDecision = input.decision ?? currentDecision
    assertAllowedTransition(currentStatus, nextStatus)
    assertStateShape(nextStatus, nextDecision)
    const result = getOrmDb().update(skill_legacy_migrations).set({
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.decision === undefined ? {} : { decision: input.decision }),
      ...(input.preview === undefined ? {} : { preview_json: JSON.stringify(input.preview) }),
      ...(input.warnings === undefined ? {} : { warnings_json: JSON.stringify(input.warnings) }),
      ...(input.sideEffects === undefined ? {} : { side_effects_json: JSON.stringify(input.sideEffects) }),
      ...(input.lastError === undefined ? {} : { last_error: input.lastError }),
      revision: input.expectedRevision + 1,
      updated_at: Date.now(),
    }).where(and(
      eq(skill_legacy_migrations.id, input.id),
      eq(skill_legacy_migrations.owner_id, input.ownerId),
      eq(skill_legacy_migrations.revision, input.expectedRevision),
    )).run()
    if (result.changes !== 1) return undefined
    return this.get(input.id)
  },

  markPublished(input: {
    id: string
    ownerId: string
    expectedRevision: number
    packageId: string
    packageVersionId: string
    reportArtifactId?: string | null
  }): LegacyMigrationRecord | undefined {
    const current = this.get(input.id)
    if (!current) return undefined
    if (current.ownerId !== input.ownerId) throw new ServiceError('FORBIDDEN', 'Migration owner does not match')
    if (current.revision !== input.expectedRevision) return undefined
    if (current.status === 'migration_published' && current.packageId === input.packageId && current.packageVersionId === input.packageVersionId) return current
    assertAllowedTransition(current.status, 'migration_published')
    assertStateShape('migration_published', 'auto_convertible')
    if (current.decision !== 'auto_convertible' || current.packageId !== null || current.packageVersionId !== null || current.publishedAt !== null) {
      throw new ServiceError('INVALID_RUN_TRANSITION', 'Only an un-published auto-convertible migration preview can be published')
    }
    const now = Date.now()
    const result = getOrmDb().update(skill_legacy_migrations).set({
      status: 'migration_published',
      decision: 'auto_convertible',
      package_id: input.packageId,
      package_version_id: input.packageVersionId,
      report_artifact_id: input.reportArtifactId ?? null,
      last_error: null,
      revision: input.expectedRevision + 1,
      updated_at: now,
      published_at: now,
    }).where(and(
      eq(skill_legacy_migrations.id, input.id),
      eq(skill_legacy_migrations.owner_id, input.ownerId),
      eq(skill_legacy_migrations.revision, input.expectedRevision),
      eq(skill_legacy_migrations.status, 'migration_previewed'),
      eq(skill_legacy_migrations.decision, 'auto_convertible'),
      isNull(skill_legacy_migrations.package_id),
      isNull(skill_legacy_migrations.package_version_id),
      isNull(skill_legacy_migrations.published_at),
    )).run()
    if (result.changes !== 1) return undefined
    return this.get(input.id)
  },

  markError(input: { id: string; ownerId: string; expectedRevision: number; status: LegacyMigrationStatus; error: string }): LegacyMigrationRecord | undefined {
    return this.updateValidation({
      id: input.id,
      ownerId: input.ownerId,
      expectedRevision: input.expectedRevision,
      status: input.status,
      lastError: input.error,
    })
  },
}
