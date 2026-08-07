import { and, desc, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { skill_legacy_migrations } from '../schema'
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
