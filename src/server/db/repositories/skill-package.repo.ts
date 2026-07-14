import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import {
  capabilityGrantRequestSchema,
  selectInheritableGrants,
  type CapabilityGrantMode,
  type CapabilityScope,
  type RequestedCapability,
  type SkillCapability,
  type StoredCapabilityGrant,
} from '../../skills/policy/capability-policy'
import { normalizeSkillRunEvent } from '../../skills/runtime/skill-run-events'
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

  deleteInstallation(id: string): void {
    getOrmDb().delete(skill_installations).where(eq(skill_installations.id, id)).run()
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
    event: { type: string; payload: Record<string, unknown> }
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
      const event = normalizeSkillRunEvent(data.event)
      tx.insert(skill_run_events).values({
        id: uuidv4(),
        run_id: data.runId,
        seq: Number(lastSeq) + 1,
        schema_version: event.schemaVersion,
        type: event.type,
        payload_json: JSON.stringify(event.payload),
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
    type: string
    payload: Record<string, unknown>
  }) {
    const event = normalizeSkillRunEvent(data)
    const row = {
      id: uuidv4(),
      run_id: data.runId,
      seq: data.seq,
      schema_version: event.schemaVersion,
      type: event.type,
      payload_json: JSON.stringify(event.payload),
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
    this.appendEvent({
      runId: data.runId,
      seq: this.listEvents(data.runId).length + 1,
      type: 'artifact.created',
      payload: {
        artifactId: row.id,
        kind: row.kind,
        path: row.path,
        sha256: row.sha256,
        sizeBytes: row.size_bytes,
      },
    })
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
    capability: SkillCapability
    grantMode: CapabilityGrantMode
    scope?: CapabilityScope
    grantedBy?: string | null
    expiresAt?: number | null
    sessionId?: string | null
  }) {
    const grant = capabilityGrantRequestSchema.parse({
      capability: data.capability,
      grantMode: data.grantMode,
      scope: data.scope ?? {},
      sessionId: data.sessionId ?? undefined,
      grantedBy: data.grantedBy ?? undefined,
      expiresAt: data.expiresAt ?? undefined,
    })
    const row = {
      id: uuidv4(),
      skill_version_id: data.skillVersionId,
      capability: grant.capability,
      grant_mode: grant.grantMode,
      scope_json: stringifyJsonObject(grant.scope, 'scope'),
      granted_by: grant.grantedBy ?? null,
      granted_at: Date.now(),
      expires_at: grant.expiresAt ?? null,
      revoked_at: null,
      session_id: grant.sessionId ?? null,
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

  inheritCapabilityGrants(data: {
    fromSkillVersionId: string
    toSkillVersionId: string
    requestedCapabilities: RequestedCapability[]
  }) {
    const oldGrants = this.listCapabilityGrants(data.fromSkillVersionId) as StoredCapabilityGrant[]
    const inheritable = selectInheritableGrants(
      oldGrants.filter((grant) => grant.grant_mode === 'persistent'),
      data.requestedCapabilities,
    )
    return inheritable.map((grant) => this.createCapabilityGrant({
      skillVersionId: data.toSkillVersionId,
      capability: grant.capability as SkillCapability,
      grantMode: grant.grant_mode as CapabilityGrantMode,
      scope: JSON.parse(grant.scope_json),
      grantedBy: grant.granted_by,
      expiresAt: grant.expires_at,
    }))
  },
}
