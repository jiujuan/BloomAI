import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { resolvePackageSkillId } from '../../../shared/skill-references'
import { getOrmDb } from '../client'
import {
  skill_artifacts,
  skill_capability_grants,
  skill_installations,
  skill_run_commands,
  skill_packages,
  skill_run_events,
  skill_runs_v2,
  skill_versions,
} from '../schema'
import type {
  ApplyRunChangeRequest,
  ArtifactRepository,
  ArtifactSnapshot,
  CapabilityGrantRepository,
  CapabilityGrantSnapshot,
  Clock,
  IdGenerator,
  InstallationSnapshot,
  JsonObject,
  PackageSkillRepository,
  PackageSnapshot,
  Page,
  RunEventSnapshot,
  RunSnapshot,
  SkillRunEventRepository,
  SkillRunRepository,
  SkillRunStatus,
  SkillRuntimePorts,
  VersionSnapshot,
} from '../../skills/application/ports'

const jsonObjectSchema = z.record(z.unknown())

function stringifyJsonObject(value: unknown, fieldName: string): string {
  const parsed = jsonObjectSchema.safeParse(value)
  if (!parsed.success || Array.isArray(value)) throw new Error(`${fieldName} must be a JSON object`)
  return JSON.stringify(parsed.data)
}

export const skillPackageRepo = {
  createPackage(data: {
    name: string
    description: string
    sourceType: string
    sourceUri?: string | null
    sourceRef?: string | null
  }) {
    const now = Date.now()
    const row = {
      id: uuidv4(),
      name: data.name,
      description: data.description,
      source_type: data.sourceType,
      source_uri: data.sourceUri ?? null,
      source_ref: data.sourceRef ?? null,
      created_at: now,
      updated_at: now,
    }
    getOrmDb().insert(skill_packages).values(row).run()
    return row
  },

  getPackage(id: string) {
    return getOrmDb().select().from(skill_packages).where(eq(skill_packages.id, id)).get()
  },

  listPackages(options: { limit: number; offset: number }) {
    const data = getOrmDb().select().from(skill_packages).orderBy(desc(skill_packages.updated_at))
      .limit(options.limit).offset(options.offset).all()
    const total = getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_packages).get()?.count ?? 0
    return { data, total: Number(total) }
  },


  createVersion(data: {
    packageId: string
    version: string
    manifest: Record<string, unknown>
    manifestHash: string
    packagePath: string
    sourceSnapshot?: Record<string, unknown>
    isCompatible?: boolean
  }) {
    const row = {
      id: uuidv4(),
      package_id: data.packageId,
      version: data.version,
      runtime: 'instruction-agent',
      manifest_json: stringifyJsonObject(data.manifest, 'manifest'),
      manifest_hash: data.manifestHash,
      package_path: data.packagePath,
      source_snapshot_json: stringifyJsonObject(data.sourceSnapshot ?? {}, 'sourceSnapshot'),
      is_compatible: data.isCompatible === false ? 0 : 1,
      created_at: Date.now(),
    }
    getOrmDb().insert(skill_versions).values(row).run()
    return row
  },

  getVersion(id: string) {
    return getOrmDb().select().from(skill_versions).where(eq(skill_versions.id, id)).get()
  },

  listVersions(packageId: string) {
    return getOrmDb().select().from(skill_versions).where(eq(skill_versions.package_id, packageId))
      .orderBy(desc(skill_versions.created_at)).all()
  },


  createInstallation(data: {
    packageId: string
    currentVersionId: string
    status: string
    enabled?: boolean
  }) {
    const now = Date.now()
    const row = {
      id: uuidv4(),
      package_id: data.packageId,
      current_version_id: data.currentVersionId,
      status: data.status,
      enabled: data.enabled === false ? 0 : 1,
      installed_at: now,
      updated_at: now,
    }
    getOrmDb().insert(skill_installations).values(row).run()
    return row
  },

  getInstallation(id: string) {
    return getOrmDb().select().from(skill_installations).where(eq(skill_installations.id, id)).get()
  },

  setInstallationEnabled(id: string, enabled: boolean) {
    const now = Date.now()
    const result = getOrmDb().update(skill_installations)
      .set({ enabled: enabled ? 1 : 0, updated_at: now })
      .where(eq(skill_installations.id, id))
      .run()
    return result.changes === 1 ? this.getInstallation(id) : undefined
  },

  listInstallations(packageId: string) {
    return getOrmDb().select().from(skill_installations).where(eq(skill_installations.package_id, packageId))
      .orderBy(desc(skill_installations.updated_at)).all()
  },


  deleteInstallation(id: string): boolean {
    return getOrmDb().delete(skill_installations).where(eq(skill_installations.id, id)).run().changes === 1
  },

  createRun(data: {
    skillVersionId: string
    status: string
    input: Record<string, unknown>
    context: Record<string, unknown>
    output?: Record<string, unknown> | null
    surface?: string | null
    sessionId?: string | null
    imageSessionId?: string | null
  }) {
    const now = Date.now()
    const row = {
      id: uuidv4(),
      skill_version_id: data.skillVersionId,
      status: data.status,
      revision: 0,
      input_json: stringifyJsonObject(data.input, 'input'),
      output_json: data.output ? stringifyJsonObject(data.output, 'output') : null,
      context_json: stringifyJsonObject(data.context, 'context'),
      surface: data.surface ?? null,
      session_id: data.sessionId ?? null,
      image_session_id: data.imageSessionId ?? null,
      waiting_reason: null,
      cancel_requested: 0,
      started_at: data.status === 'running' ? now : null,
      updated_at: now,
      finished_at: null,
      error_code: null,
      error_message: null,
    }
    getOrmDb().insert(skill_runs_v2).values(row).run()
    return row
  },

  getRun(id: string) {
    return getOrmDb().select().from(skill_runs_v2).where(eq(skill_runs_v2.id, id)).get()
  },

  setRunImageSessionId(runId: string, imageSessionId: string) {
    getOrmDb().update(skill_runs_v2).set({
      image_session_id: imageSessionId,
      updated_at: Date.now(),
    }).where(eq(skill_runs_v2.id, runId)).run()
    return this.getRun(runId)
  },

  applyRunChange(data: {
    runId: string
    expectedRevision: number
    changes: {
      status?: string
      input?: Record<string, unknown>
      output?: Record<string, unknown> | null
      waitingReason?: string | null
      cancelRequested?: boolean
      startedAt?: number | null
      finishedAt?: number | null
      errorCode?: string | null
      errorMessage?: string | null
    }
    event: { schemaVersion: number; type: string; payload: Record<string, unknown> }
    command?: { idempotencyKey: string }
  }): { run: typeof skill_runs_v2.$inferSelect; duplicate: boolean } | undefined {
    return getOrmDb().transaction((tx) => {
      if (data.command) {
        const existing = tx.select().from(skill_run_commands).where(and(
          eq(skill_run_commands.run_id, data.runId),
          eq(skill_run_commands.idempotency_key, data.command.idempotencyKey),
        )).get()
        if (existing) return { run: JSON.parse(existing.result_json) as typeof skill_runs_v2.$inferSelect, duplicate: true }
      }

      const now = Date.now()
      const changes = data.changes
      const result = tx.update(skill_runs_v2).set({
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.input === undefined ? {} : { input_json: stringifyJsonObject(changes.input, 'input') }),
        ...(changes.output === undefined ? {} : { output_json: changes.output === null ? null : stringifyJsonObject(changes.output, 'output') }),
        ...(changes.waitingReason === undefined ? {} : { waiting_reason: changes.waitingReason }),
        ...(changes.cancelRequested === undefined ? {} : { cancel_requested: changes.cancelRequested ? 1 : 0 }),
        ...(changes.startedAt === undefined ? {} : { started_at: changes.startedAt }),
        ...(changes.finishedAt === undefined ? {} : { finished_at: changes.finishedAt }),
        ...(changes.errorCode === undefined ? {} : { error_code: changes.errorCode }),
        ...(changes.errorMessage === undefined ? {} : { error_message: changes.errorMessage }),
        revision: data.expectedRevision + 1,
        updated_at: now,
      }).where(and(
        eq(skill_runs_v2.id, data.runId),
        eq(skill_runs_v2.revision, data.expectedRevision),
      )).run()
      if (result.changes !== 1) return undefined

      const run = tx.select().from(skill_runs_v2).where(eq(skill_runs_v2.id, data.runId)).get()
      if (!run) throw new Error(`Run not found after update: ${data.runId}`)
      const lastSeq = tx.select({ seq: sql<number>`coalesce(max(${skill_run_events.seq}), 0)` })
        .from(skill_run_events).where(eq(skill_run_events.run_id, data.runId)).get()?.seq ?? 0
      tx.insert(skill_run_events).values({
        id: uuidv4(),
        run_id: data.runId,
        seq: Number(lastSeq) + 1,
        schema_version: data.event.schemaVersion,
        type: data.event.type,
        payload_json: JSON.stringify(data.event.payload),
        created_at: now,
      }).run()
      if (data.command) {
        tx.insert(skill_run_commands).values({
          id: uuidv4(),
          run_id: data.runId,
          idempotency_key: data.command.idempotencyKey,
          result_json: JSON.stringify(run),
          created_at: now,
        }).run()
      }
      return { run, duplicate: false }
    })
  },

  listRunsByStatus(status: string) {
    return getOrmDb().select().from(skill_runs_v2).where(eq(skill_runs_v2.status, status)).all()
  },

  listRuns(options: { limit: number; offset: number; status?: string; skillVersionId?: string }) {
    const conditions = [
      options.status === undefined ? undefined : eq(skill_runs_v2.status, options.status),
      options.skillVersionId === undefined ? undefined : eq(skill_runs_v2.skill_version_id, options.skillVersionId),
    ].filter(Boolean)
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions)
    const query = getOrmDb().select().from(skill_runs_v2)
    const data = where === undefined
      ? query.orderBy(desc(skill_runs_v2.updated_at)).limit(options.limit).offset(options.offset).all()
      : query.where(where).orderBy(desc(skill_runs_v2.updated_at)).limit(options.limit).offset(options.offset).all()
    const countQuery = getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_runs_v2)
    const total = where === undefined ? countQuery.get()?.count ?? 0 : countQuery.where(where).get()?.count ?? 0
    return { data, total: Number(total) }
  },

  resolveRunnableVersion(referenceId: string) {
    const packageReferenceId = resolvePackageSkillId(referenceId)
    if (!packageReferenceId) return undefined

    const directVersion = this.getVersion(packageReferenceId)
    if (directVersion) {
      const installation = this.listInstallations(directVersion.package_id).find((entry) =>
        entry.current_version_id === directVersion.id && entry.enabled === 1 && entry.status === 'installed'
      )
      return installation ? directVersion : undefined
    }
    const installation = this.getInstallation(packageReferenceId)
    if (installation?.enabled === 1 && installation.status === 'installed') return this.getVersion(installation.current_version_id)
    const packageRecord = this.getPackage(packageReferenceId)
    if (!packageRecord) return undefined
    const activeInstallation = this.listInstallations(packageRecord.id).find((entry) => entry.enabled === 1 && entry.status === 'installed')
    return activeInstallation ? this.getVersion(activeInstallation.current_version_id) : undefined
  },

  isPackageReference(referenceId: string) {
    const packageReferenceId = resolvePackageSkillId(referenceId)
    return Boolean(packageReferenceId && (
      this.getPackage(packageReferenceId) || this.getVersion(packageReferenceId) || this.getInstallation(packageReferenceId)
    ))
  },


  getCommandResult(runId: string, idempotencyKey: string) {
    const command = getOrmDb().select().from(skill_run_commands).where(and(
      eq(skill_run_commands.run_id, runId),
      eq(skill_run_commands.idempotency_key, idempotencyKey),
    )).get()
    return command ? JSON.parse(command.result_json) : undefined
  },

  appendEvent(data: {
    runId: string
    seq: number
    schemaVersion: number
    type: string
    payload: Record<string, unknown>
  }) {
    const row = {
      id: uuidv4(),
      run_id: data.runId,
      seq: data.seq,
      schema_version: data.schemaVersion,
      type: data.type,
      payload_json: JSON.stringify(data.payload),
      created_at: Date.now(),
    }
    getOrmDb().insert(skill_run_events).values(row).run()
    return row
  },

  listEvents(runId: string) {
    return getOrmDb()
      .select()
      .from(skill_run_events)
      .where(eq(skill_run_events.run_id, runId))
      .orderBy(asc(skill_run_events.seq))
      .all()
  },

  createArtifact(data: {
    runId: string
    kind: string
    path: string
    sha256: string
    mimeType?: string | null
    sizeBytes?: number
    metadata?: Record<string, unknown>
  }) {
    if (!this.getRun(data.runId)) throw new Error(`Run not found: ${data.runId}`)
    const row = {
      id: uuidv4(),
      run_id: data.runId,
      kind: data.kind,
      mime_type: data.mimeType ?? null,
      path: data.path,
      size_bytes: data.sizeBytes ?? 0,
      sha256: data.sha256,
      metadata_json: stringifyJsonObject(data.metadata ?? {}, 'metadata'),
      created_at: Date.now(),
    }
    getOrmDb().insert(skill_artifacts).values(row).run()
    return row
  },

  getArtifact(id: string) {
    return getOrmDb().select().from(skill_artifacts).where(eq(skill_artifacts.id, id)).get()
  },

  listArtifacts(runId: string) {
    return getOrmDb().select().from(skill_artifacts)
      .where(eq(skill_artifacts.run_id, runId))
      .orderBy(asc(skill_artifacts.created_at))
      .all()
  },

  createCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    grantMode: string
    scope?: Record<string, unknown>
    grantedBy?: string | null
    expiresAt?: number | null
    sessionId?: string | null
  }) {
    const row = {
      id: uuidv4(),
      skill_version_id: data.skillVersionId,
      capability: data.capability,
      grant_mode: data.grantMode,
      scope_json: stringifyJsonObject(data.scope ?? {}, 'scope'),
      granted_by: data.grantedBy ?? null,
      granted_at: Date.now(),
      expires_at: data.expiresAt ?? null,
      revoked_at: null,
      session_id: data.sessionId ?? null,
      consumed_at: null,
    }
    getOrmDb().insert(skill_capability_grants).values(row).run()
    return row
  },

  listCapabilityGrants(skillVersionId: string) {
    return getOrmDb()
      .select()
      .from(skill_capability_grants)
      .where(eq(skill_capability_grants.skill_version_id, skillVersionId))
      .all()
  },

  findActiveCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    sessionId?: string | null
    now?: number
  }) {
    const now = data.now ?? Date.now()
    const sessionPredicate = data.sessionId
      ? or(isNull(skill_capability_grants.session_id), eq(skill_capability_grants.session_id, data.sessionId))
      : isNull(skill_capability_grants.session_id)
    return getOrmDb()
      .select()
      .from(skill_capability_grants)
      .where(and(
        eq(skill_capability_grants.skill_version_id, data.skillVersionId),
        eq(skill_capability_grants.capability, data.capability),
        isNull(skill_capability_grants.revoked_at),
        isNull(skill_capability_grants.consumed_at),
        or(isNull(skill_capability_grants.expires_at), sql`${skill_capability_grants.expires_at} > ${now}`),
        sessionPredicate,
      ))
      .orderBy(asc(skill_capability_grants.granted_at))
      .get()
  },

  consumeCapabilityGrant(id: string, now = Date.now()): boolean {
    const result = getOrmDb()
      .update(skill_capability_grants)
      .set({ consumed_at: now })
      .where(and(eq(skill_capability_grants.id, id), isNull(skill_capability_grants.consumed_at), isNull(skill_capability_grants.revoked_at)))
      .run()
    return result.changes === 1
  },

  revokeCapabilityGrant(id: string, now = Date.now()): boolean {
    const result = getOrmDb()
      .update(skill_capability_grants)
      .set({ revoked_at: now })
      .where(and(eq(skill_capability_grants.id, id), isNull(skill_capability_grants.revoked_at)))
      .run()
    return result.changes === 1
  },

}


/** SQLite adapter for the application ports. Keep all row/JSON translation here. */
export function createSqliteSkillRuntimePorts(): SkillRuntimePorts {
  const clock: Clock = { now: () => Date.now() }
  const ids: IdGenerator = { next: () => uuidv4() }
  const events = createSqliteEventRepository(clock)
  const runs = createSqliteRunRepository()
  const packages = createSqlitePackageRepository()
  const grants = createSqliteGrantRepository()
  const artifacts = createSqliteArtifactRepository()
  return { packages, runs, events, grants, artifacts, clock, ids }
}

export function createSqlitePackageRepository(): PackageSkillRepository {
  return {
    createPackage(data) {
      return mapPackage(skillPackageRepo.createPackage(data))
    },
    getPackage(id) {
      const row = skillPackageRepo.getPackage(id)
      return row ? mapPackage(row) : undefined
    },
    listPackages(options): Page<PackageSnapshot> {
      const result = skillPackageRepo.listPackages(options)
      return { data: result.data.map(mapPackage), total: result.total }
    },
    createVersion(data) {
      return mapVersion(skillPackageRepo.createVersion(data))
    },
    getVersion(id) {
      const row = skillPackageRepo.getVersion(id)
      return row ? mapVersion(row) : undefined
    },
    listVersions(packageId) {
      return skillPackageRepo.listVersions(packageId).map(mapVersion)
    },
    createInstallation(data) {
      return mapInstallation(skillPackageRepo.createInstallation(data))
    },
    getInstallation(id) {
      const row = skillPackageRepo.getInstallation(id)
      return row ? mapInstallation(row) : undefined
    },
    setInstallationEnabled(id, enabled) {
      const row = skillPackageRepo.setInstallationEnabled(id, enabled)
      return row ? mapInstallation(row) : undefined
    },
    listInstallations(packageId) {
      return skillPackageRepo.listInstallations(packageId).map(mapInstallation)
    },
    deleteInstallation(id) {
      return skillPackageRepo.deleteInstallation(id)
    },
    resolveRunnableVersion(referenceId) {
      const row = skillPackageRepo.resolveRunnableVersion(referenceId)
      return row ? mapVersion(row) : undefined
    },
    isPackageReference(referenceId) {
      return skillPackageRepo.isPackageReference(referenceId)
    },
  }
}

export function createSqliteRunRepository(): SkillRunRepository {
  return {
    createRun(data) {
      return mapRun(skillPackageRepo.createRun(data))
    },
    getRun(id) {
      const row = skillPackageRepo.getRun(id)
      return row ? mapRun(row) : undefined
    },
    setRunImageSessionId(runId, imageSessionId) {
      const row = skillPackageRepo.setRunImageSessionId(runId, imageSessionId)
      return row ? mapRun(row) : undefined
    },
    applyRunChange(data: ApplyRunChangeRequest) {
      const result = skillPackageRepo.applyRunChange({
        runId: data.runId,
        expectedRevision: data.expectedRevision,
        changes: {
          ...(data.changes.status === undefined ? {} : { status: data.changes.status }),
          ...(data.changes.input === undefined ? {} : { input: data.changes.input }),
          ...(data.changes.output === undefined ? {} : { output: data.changes.output }),
          ...(data.changes.waitingReason === undefined ? {} : { waitingReason: data.changes.waitingReason }),
          ...(data.changes.cancelRequested === undefined ? {} : { cancelRequested: data.changes.cancelRequested }),
          ...(data.changes.startedAt === undefined ? {} : { startedAt: data.changes.startedAt }),
          ...(data.changes.finishedAt === undefined ? {} : { finishedAt: data.changes.finishedAt }),
          ...(data.changes.errorCode === undefined ? {} : { errorCode: data.changes.errorCode }),
          ...(data.changes.errorMessage === undefined ? {} : { errorMessage: data.changes.errorMessage }),
        },
        event: data.event,
        command: data.command,
      })
      return result ? { run: mapRun(result.run), duplicate: result.duplicate } : undefined
    },
    compareAndSet(data) {
      return this.applyRunChange(data)
    },
    getCommandResult(runId, idempotencyKey) {
      const row = skillPackageRepo.getCommandResult(runId, idempotencyKey)
      return row ? mapRun(row) : undefined
    },
    listRunsByStatus(status) {
      return skillPackageRepo.listRunsByStatus(status).map(mapRun)
    },
    listRuns(options) {
      const result = skillPackageRepo.listRuns(options)
      return { data: result.data.map(mapRun), total: result.total }
    },
  }
}

export function createSqliteEventRepository(clock: Clock = { now: () => Date.now() }): SkillRunEventRepository {
  return {
    appendEvent(data) {
      const row = skillPackageRepo.appendEvent({
        runId: data.runId,
        seq: data.seq ?? this.nextSequence(data.runId),
        schemaVersion: data.schemaVersion,
        type: data.type,
        payload: data.payload,
      })
      return mapEvent(row)
    },
    listEvents(runId) {
      return skillPackageRepo.listEvents(runId).map(mapEvent)
    },
    nextSequence(runId) {
      const events = skillPackageRepo.listEvents(runId)
      return events.reduce((max, event) => Math.max(max, event.seq), 0) + 1
    },
  }
}

export function createSqliteGrantRepository(): CapabilityGrantRepository {
  return {
    createCapabilityGrant(data) {
      return mapGrant(skillPackageRepo.createCapabilityGrant(data))
    },
    listCapabilityGrants(skillVersionId) {
      return skillPackageRepo.listCapabilityGrants(skillVersionId).map(mapGrant)
    },
    findActiveCapabilityGrant(data) {
      const row = skillPackageRepo.findActiveCapabilityGrant(data)
      return row ? mapGrant(row) : undefined
    },
    consumeCapabilityGrant(id, now) {
      return skillPackageRepo.consumeCapabilityGrant(id, now)
    },
    revokeCapabilityGrant(id, now) {
      return skillPackageRepo.revokeCapabilityGrant(id, now)
    },
  }
}

export function createSqliteArtifactRepository(): ArtifactRepository {
  return {
    createArtifact(data) {
      return mapArtifact(skillPackageRepo.createArtifact(data))
    },
    getArtifact(id) {
      const row = skillPackageRepo.getArtifact(id)
      return row ? mapArtifact(row) : undefined
    },
    listArtifacts(runId) {
      return skillPackageRepo.listArtifacts(runId).map(mapArtifact)
    },
  }
}

function parseObject(value: string, fieldName: string): JsonObject {
  const parsed = jsonObjectSchema.safeParse(JSON.parse(value))
  if (!parsed.success) throw new Error(`Invalid ${fieldName}`)
  return parsed.data
}

function mapPackage(row: any): PackageSnapshot {
  return { id: row.id, name: row.name, description: row.description, sourceType: row.source_type, sourceUri: row.source_uri, sourceRef: row.source_ref, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapVersion(row: any): VersionSnapshot {
  return { id: row.id, packageId: row.package_id, version: row.version, runtime: row.runtime, manifest: parseObject(row.manifest_json, 'manifest'), manifestHash: row.manifest_hash, packagePath: row.package_path, sourceSnapshot: parseObject(row.source_snapshot_json, 'source snapshot'), isCompatible: row.is_compatible === 1, createdAt: row.created_at }
}

function mapInstallation(row: any): InstallationSnapshot {
  return { id: row.id, packageId: row.package_id, currentVersionId: row.current_version_id, status: row.status, enabled: row.enabled === 1, installedAt: row.installed_at, updatedAt: row.updated_at }
}

function mapRun(row: any): RunSnapshot {
  return { id: row.id, skillVersionId: row.skill_version_id, status: row.status as SkillRunStatus, revision: row.revision, input: parseObject(row.input_json, 'run input'), output: row.output_json === null ? null : parseObject(row.output_json, 'run output'), context: parseObject(row.context_json, 'run context'), surface: row.surface, sessionId: row.session_id, imageSessionId: row.image_session_id, waitingReason: row.waiting_reason, cancelRequested: row.cancel_requested === 1, startedAt: row.started_at, updatedAt: row.updated_at, finishedAt: row.finished_at, errorCode: row.error_code, errorMessage: row.error_message }
}

function mapEvent(row: any): RunEventSnapshot {
  return { id: row.id, runId: row.run_id, seq: row.seq, schemaVersion: row.schema_version, type: row.type, payload: parseObject(row.payload_json, 'event payload'), createdAt: row.created_at }
}

function mapGrant(row: any): CapabilityGrantSnapshot {
  return { id: row.id, skillVersionId: row.skill_version_id, capability: row.capability, grantMode: row.grant_mode, scope: parseObject(row.scope_json, 'grant scope'), grantedBy: row.granted_by, grantedAt: row.granted_at, expiresAt: row.expires_at, revokedAt: row.revoked_at, sessionId: row.session_id, consumedAt: row.consumed_at }
}

function mapArtifact(row: any): ArtifactSnapshot {
  return { id: row.id, runId: row.run_id, kind: row.kind, mimeType: row.mime_type, path: row.path, sizeBytes: row.size_bytes, sha256: row.sha256, metadata: parseObject(row.metadata_json, 'artifact metadata'), createdAt: row.created_at }
}
