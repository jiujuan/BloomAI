import { and, asc, desc, eq, gt, isNull, lte, max, or, sql } from 'drizzle-orm'
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
  skill_run_queue,
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
  SkillRunQueueRepository,
  SkillRunQueueSnapshot,
  SkillRunQueueStatus,
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
      cancel_requested_at: null,
      started_at: data.status === 'running' ? now : null,
      updated_at: now,
      finished_at: null,
      error_code: null,
      error_message: null,
      current_step: null,
      required_action_json: null,
      worker_id: null,
      heartbeat_at: null,
      execution_mode: 'instruction-agent',
      step_count: 0,
      token_usage: 0,
      last_heartbeat_at: null,
      result_summary: null,
    }
    getOrmDb().insert(skill_runs_v2).values(row).run()
    return row
  },

  createRunAndEnqueue(data: {
    skillVersionId: string
    status: string
    input: Record<string, unknown>
    context: Record<string, unknown>
    output?: Record<string, unknown> | null
    surface?: string | null
    sessionId?: string | null
    imageSessionId?: string | null
    availableAt?: number
    initialEvent?: { schemaVersion: number; type: string; payload: Record<string, unknown>; producer?: string; occurredAt?: number }
  }) {
    const now = Date.now()
    const run = {
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
      cancel_requested_at: null,
      started_at: data.status === 'running' ? now : null,
      updated_at: now,
      finished_at: null,
      error_code: null,
      error_message: null,
      current_step: null,
      required_action_json: null,
      worker_id: null,
      heartbeat_at: null,
      execution_mode: 'instruction-agent',
      step_count: 0,
      token_usage: 0,
      last_heartbeat_at: null,
      result_summary: null,
    }
    const queue = {
      id: uuidv4(),
      run_id: run.id,
      status: 'queued',
      available_at: data.availableAt ?? now,
      lease_owner: null,
      lease_until: null,
      attempt: 0,
      last_error: null,
      created_at: now,
      updated_at: now,
    }
    getOrmDb().transaction((tx) => {
      tx.insert(skill_runs_v2).values(run).run()
      tx.insert(skill_run_queue).values(queue).run()
      if (data.initialEvent) {
        tx.insert(skill_run_events).values({
          id: uuidv4(),
          run_id: run.id,
          seq: 1,
          schema_version: data.initialEvent.schemaVersion,
          producer: data.initialEvent.producer ?? 'runtime',
          occurred_at: data.initialEvent.occurredAt ?? now,
          type: data.initialEvent.type,
          payload_json: JSON.stringify(data.initialEvent.payload),
          created_at: now,
        }).run()
      }
    })
    return { run, queue }
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
      cancelRequestedAt?: number | null
      interruptedAt?: number | null
      cancelReason?: string | null
      lastCheckpoint?: Record<string, unknown> | null
      startedAt?: number | null
      finishedAt?: number | null
      errorCode?: string | null
      errorMessage?: string | null
      currentStep?: string | null
      requiredAction?: Record<string, unknown> | null
      workerId?: string | null
      heartbeatAt?: number | null
      executionMode?: string
      stepCount?: number
      tokenUsage?: number
      lastHeartbeatAt?: number | null
      resultSummary?: string | null
    }
    event: { schemaVersion: number; producer?: string; occurredAt?: number; type: string; payload: Record<string, unknown> }
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
        ...(changes.cancelRequestedAt === undefined ? {} : { cancel_requested_at: changes.cancelRequestedAt }),
        ...(changes.interruptedAt === undefined ? {} : { interrupted_at: changes.interruptedAt }),
        ...(changes.cancelReason === undefined ? {} : { cancel_reason: changes.cancelReason }),
        ...(changes.lastCheckpoint === undefined ? {} : { last_checkpoint_json: changes.lastCheckpoint === null ? null : stringifyJsonObject(changes.lastCheckpoint, 'lastCheckpoint') }),
        ...(changes.startedAt === undefined ? {} : { started_at: changes.startedAt }),
        ...(changes.finishedAt === undefined ? {} : { finished_at: changes.finishedAt }),
        ...(changes.errorCode === undefined ? {} : { error_code: changes.errorCode }),
        ...(changes.errorMessage === undefined ? {} : { error_message: changes.errorMessage }),
        ...(changes.currentStep === undefined ? {} : { current_step: changes.currentStep }),
        ...(changes.requiredAction === undefined ? {} : { required_action_json: changes.requiredAction === null ? null : stringifyJsonObject(changes.requiredAction, 'requiredAction') }),
        ...(changes.workerId === undefined ? {} : { worker_id: changes.workerId }),
        ...(changes.heartbeatAt === undefined ? {} : { heartbeat_at: changes.heartbeatAt }),
        ...(changes.executionMode === undefined ? {} : { execution_mode: changes.executionMode }),
        ...(changes.stepCount === undefined ? {} : { step_count: changes.stepCount }),
        ...(changes.tokenUsage === undefined ? {} : { token_usage: changes.tokenUsage }),
        ...(changes.lastHeartbeatAt === undefined ? {} : { last_heartbeat_at: changes.lastHeartbeatAt }),
        ...(changes.resultSummary === undefined ? {} : { result_summary: changes.resultSummary }),
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
        producer: data.event.producer ?? 'runtime',
        occurred_at: data.event.occurredAt ?? now,
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
    seq?: number
    schemaVersion: number
    producer?: string
    occurredAt?: number
    type: string
    payload: Record<string, unknown>
  }) {
    return getOrmDb().transaction((tx) => {
      const now = Date.now()
      const seq = data.seq ?? ((tx.select({ maxSeq: max(skill_run_events.seq) })
        .from(skill_run_events)
        .where(eq(skill_run_events.run_id, data.runId))
        .get()?.maxSeq ?? 0) + 1)
      const row = {
        id: uuidv4(),
        run_id: data.runId,
        seq,
        schema_version: data.schemaVersion,
        producer: data.producer ?? 'runtime',
        occurred_at: data.occurredAt ?? now,
        type: data.type,
        payload_json: JSON.stringify(data.payload),
        created_at: now,
      }
      tx.insert(skill_run_events).values(row).run()
      return row
    })
  },

  listEvents(runId: string, options: { afterSeq?: number; limit?: number } = {}) {
    const afterSeq = options.afterSeq ?? 0
    const limit = options.limit === undefined ? undefined : Math.max(1, Math.min(500, Math.trunc(options.limit)))
    const conditions = [
      eq(skill_run_events.run_id, runId),
      gt(skill_run_events.seq, afterSeq),
    ]
    const query = getOrmDb().select().from(skill_run_events).where(and(...conditions)).orderBy(asc(skill_run_events.seq))
    return limit === undefined ? query.all() : query.limit(limit).all()
  },

  listEventsPage(runId: string, options: { afterSeq?: number; limit?: number } = {}) {
    const limit = options.limit === undefined ? 100 : Math.max(1, Math.min(500, Math.trunc(options.limit)))
    const rows = this.listEvents(runId, { afterSeq: options.afterSeq, limit: limit + 1 })
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    return { data, nextAfterSeq: hasMore ? data[data.length - 1]?.seq ?? null : null }
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
    requestedScope?: Record<string, unknown>
    grantedScope?: Record<string, unknown> | null
    status?: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'consumed'
    grantedBy?: string | null
    approvedBy?: string | null
    approvedAt?: number | null
    expiresAt?: number | null
    sessionId?: string | null
    runId?: string | null
    ownerId?: string | null
    maxCalls?: number | null
    callsUsed?: number
  }) {
    const requestedScope = data.requestedScope ?? data.scope ?? {}
    const grantedScope = data.grantedScope === undefined ? (data.scope ?? (data.status === 'approved' ? requestedScope : null)) : data.grantedScope
    const now = Date.now()
    const row = {
      id: uuidv4(),
      skill_version_id: data.skillVersionId,
      capability: data.capability,
      grant_mode: data.grantMode,
      scope_json: stringifyJsonObject(grantedScope ?? {}, 'scope'),
      requested_scope_json: stringifyJsonObject(requestedScope, 'requested scope'),
      granted_scope_json: grantedScope === null ? null : stringifyJsonObject(grantedScope, 'granted scope'),
      status: data.status ?? 'approved',
      granted_by: data.grantedBy ?? null,
      granted_at: now,
      approved_by: data.approvedBy ?? (data.status === 'approved' ? data.grantedBy ?? null : null),
      approved_at: data.approvedAt ?? (data.status === 'approved' ? now : null),
      expires_at: data.expiresAt ?? null,
      revoked_at: null,
      revoke_reason: null,
      session_id: data.sessionId ?? null,
      run_id: data.runId ?? null,
      owner_id: data.ownerId ?? null,
      max_calls: data.maxCalls ?? (typeof requestedScope.maxCalls === 'number' ? requestedScope.maxCalls : null),
      calls_used: data.callsUsed ?? 0,
      consumed_at: null,
      idempotency_key: null,
    }
    getOrmDb().insert(skill_capability_grants).values(row).run()
    return row
  },

  getCapabilityGrant(id: string) {
    const row = getOrmDb().select().from(skill_capability_grants).where(eq(skill_capability_grants.id, id)).get()
    return row
  },

  listCapabilityGrants(skillVersionId: string, options: { runId?: string | null; sessionId?: string | null } = {}) {
    const predicates = [eq(skill_capability_grants.skill_version_id, skillVersionId)]
    if (options.runId !== undefined) predicates.push(options.runId === null ? isNull(skill_capability_grants.run_id) : eq(skill_capability_grants.run_id, options.runId))
    if (options.sessionId !== undefined) predicates.push(options.sessionId === null ? isNull(skill_capability_grants.session_id) : eq(skill_capability_grants.session_id, options.sessionId))
    return getOrmDb().select().from(skill_capability_grants).where(and(...predicates)).orderBy(asc(skill_capability_grants.granted_at)).all()
  },

  findActiveCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    sessionId?: string | null
    runId?: string | null
    now?: number
  }) {
    const now = data.now ?? Date.now()
    const sessionPredicate = data.sessionId
      ? or(isNull(skill_capability_grants.session_id), eq(skill_capability_grants.session_id, data.sessionId))
      : isNull(skill_capability_grants.session_id)
    const runPredicate = data.runId
      ? or(isNull(skill_capability_grants.run_id), eq(skill_capability_grants.run_id, data.runId))
      : isNull(skill_capability_grants.run_id)
    const row = getOrmDb()
      .select()
      .from(skill_capability_grants)
      .where(and(
        eq(skill_capability_grants.skill_version_id, data.skillVersionId),
        eq(skill_capability_grants.capability, data.capability),
        eq(skill_capability_grants.status, 'approved'),
        isNull(skill_capability_grants.revoked_at),
        isNull(skill_capability_grants.consumed_at),
        or(isNull(skill_capability_grants.expires_at), sql`${skill_capability_grants.expires_at} > ${now}`),
        or(isNull(skill_capability_grants.max_calls), sql`${skill_capability_grants.calls_used} < ${skill_capability_grants.max_calls}`),
        sessionPredicate,
        runPredicate,
      ))
      .orderBy(asc(skill_capability_grants.granted_at))
      .get()
    return row
  },

  updateCapabilityGrant(data: {
    id: string
    status?: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'consumed'
    grantedScope?: Record<string, unknown> | null
    approvedBy?: string | null
    approvedAt?: number | null
    revokeReason?: string | null
    revokedAt?: number | null
    expiresAt?: number | null
    maxCalls?: number | null
  }) {
    const current = getOrmDb().select().from(skill_capability_grants).where(eq(skill_capability_grants.id, data.id)).get()
    if (!current) return undefined
    const grantedScope = data.grantedScope === undefined ? current.granted_scope_json : data.grantedScope === null ? '{}' : stringifyJsonObject(data.grantedScope, 'granted scope')
    const patch: Record<string, unknown> = {}
    if (data.status !== undefined) patch.status = data.status
    if (data.grantedScope !== undefined) { patch.granted_scope_json = data.grantedScope === null ? null : grantedScope; patch.scope_json = data.grantedScope === null ? '{}' : grantedScope }
    if (data.approvedBy !== undefined) patch.approved_by = data.approvedBy
    if (data.approvedAt !== undefined) patch.approved_at = data.approvedAt
    if (data.revokeReason !== undefined) patch.revoke_reason = data.revokeReason
    if (data.revokedAt !== undefined) patch.revoked_at = data.revokedAt
    if (data.expiresAt !== undefined) patch.expires_at = data.expiresAt
    if (data.maxCalls !== undefined) patch.max_calls = data.maxCalls
    if (Object.keys(patch).length) getOrmDb().update(skill_capability_grants).set(patch as any).where(eq(skill_capability_grants.id, data.id)).run()
    const next = getOrmDb().select().from(skill_capability_grants).where(eq(skill_capability_grants.id, data.id)).get()
    return next
  },

  consumeCapabilityGrant(id: string, now = Date.now(), context: { runId?: string | null; sessionId?: string | null } = {}): boolean {
    const current = getOrmDb().select().from(skill_capability_grants).where(eq(skill_capability_grants.id, id)).get()
    if (!current || current.status !== 'approved' || current.revoked_at !== null || current.consumed_at !== null) return false
    if (current.expires_at !== null && current.expires_at <= now) {
      getOrmDb().update(skill_capability_grants).set({ status: 'expired' }).where(eq(skill_capability_grants.id, id)).run()
      return false
    }
    if (context.runId !== undefined && current.run_id !== null && current.run_id !== context.runId) return false
    if (context.sessionId !== undefined && current.session_id !== null && current.session_id !== context.sessionId) return false
    if (current.max_calls !== null && current.calls_used >= current.max_calls) return false
    const nextCalls = current.calls_used + 1
    const exhausted = current.grant_mode === 'once' || current.max_calls !== null && nextCalls >= current.max_calls
    const result = getOrmDb().update(skill_capability_grants).set({
      calls_used: nextCalls,
      consumed_at: current.grant_mode === 'once' ? now : current.consumed_at,
      status: exhausted ? 'consumed' : 'approved',
    }).where(and(
      eq(skill_capability_grants.id, id),
      eq(skill_capability_grants.status, 'approved'),
      eq(skill_capability_grants.calls_used, current.calls_used),
      isNull(skill_capability_grants.revoked_at),
      isNull(skill_capability_grants.consumed_at),
    )).run()
    return result.changes === 1
  },

  revokeCapabilityGrant(id: string, now = Date.now(), reason?: string): boolean {
    const result = getOrmDb()
      .update(skill_capability_grants)
      .set({ revoked_at: now, status: 'revoked', revoke_reason: reason ?? null })
      .where(and(eq(skill_capability_grants.id, id), isNull(skill_capability_grants.revoked_at), eq(skill_capability_grants.status, 'approved')))
      .run()
    return result.changes === 1
  },

  enqueueRun(data: { runId: string; availableAt?: number }) {
    const now = Date.now()
    const row = {
      id: uuidv4(),
      run_id: data.runId,
      status: 'queued',
      available_at: data.availableAt ?? now,
      lease_owner: null,
      lease_until: null,
      attempt: 0,
      last_error: null,
      created_at: now,
      updated_at: now,
    }
    getOrmDb().insert(skill_run_queue).values(row).run()
    return row
  },

  claimNextRunQueue(data: { workerId: string; leaseMs: number; now?: number }) {
    const now = data.now ?? Date.now()
    return getOrmDb().transaction((tx) => {
      const candidate = tx.select().from(skill_run_queue)
        .where(or(
          and(or(eq(skill_run_queue.status, 'queued'), eq(skill_run_queue.status, 'retry_wait')), lte(skill_run_queue.available_at, now)),
          and(eq(skill_run_queue.status, 'leased'), lte(skill_run_queue.lease_until, now)),
        ))
        .orderBy(asc(skill_run_queue.available_at), asc(skill_run_queue.created_at))
        .get()
      if (!candidate) return undefined
      const result = tx.update(skill_run_queue).set({
        status: 'leased',
        lease_owner: data.workerId,
        lease_until: now + data.leaseMs,
        attempt: candidate.attempt + 1,
        updated_at: now,
      }).where(and(
        eq(skill_run_queue.id, candidate.id),
        or(
          and(or(eq(skill_run_queue.status, 'queued'), eq(skill_run_queue.status, 'retry_wait')), lte(skill_run_queue.available_at, now)),
          and(eq(skill_run_queue.status, 'leased'), lte(skill_run_queue.lease_until, now)),
        ),
      )).run()
      if (result.changes !== 1) return undefined
      return tx.select().from(skill_run_queue).where(eq(skill_run_queue.id, candidate.id)).get()
    })
  },

  heartbeatRunQueue(data: { queueId: string; workerId: string; leaseMs: number; now?: number }) {
    const now = data.now ?? Date.now()
    const result = getOrmDb().update(skill_run_queue).set({
      lease_until: now + data.leaseMs,
      updated_at: now,
    }).where(and(
      eq(skill_run_queue.id, data.queueId),
      eq(skill_run_queue.status, 'leased'),
      eq(skill_run_queue.lease_owner, data.workerId),
    )).run()
    return result.changes === 1 ? getOrmDb().select().from(skill_run_queue).where(eq(skill_run_queue.id, data.queueId)).get() : undefined
  },

  ackRunQueue(data: { queueId: string; workerId: string; now?: number }): boolean {
    const result = getOrmDb().update(skill_run_queue).set({
      status: 'done',
      lease_owner: null,
      lease_until: null,
      updated_at: data.now ?? Date.now(),
    }).where(and(
      eq(skill_run_queue.id, data.queueId),
      eq(skill_run_queue.status, 'leased'),
      eq(skill_run_queue.lease_owner, data.workerId),
    )).run()
    return result.changes === 1
  },

  retryRunQueue(data: { queueId: string; workerId: string; error: string; delayMs: number; now?: number }) {
    const now = data.now ?? Date.now()
    const result = getOrmDb().update(skill_run_queue).set({
      status: 'retry_wait',
      available_at: now + Math.max(0, data.delayMs),
      lease_owner: null,
      lease_until: null,
      last_error: data.error,
      updated_at: now,
    }).where(and(
      eq(skill_run_queue.id, data.queueId),
      eq(skill_run_queue.status, 'leased'),
      eq(skill_run_queue.lease_owner, data.workerId),
    )).run()
    return result.changes === 1 ? getOrmDb().select().from(skill_run_queue).where(eq(skill_run_queue.id, data.queueId)).get() : undefined
  },

  failRunQueue(data: { queueId: string; workerId: string; error: string; now?: number }) {
    const now = data.now ?? Date.now()
    const result = getOrmDb().update(skill_run_queue).set({
      status: 'dead',
      lease_owner: null,
      lease_until: null,
      last_error: data.error,
      updated_at: now,
    }).where(and(
      eq(skill_run_queue.id, data.queueId),
      eq(skill_run_queue.status, 'leased'),
      eq(skill_run_queue.lease_owner, data.workerId),
    )).run()
    return result.changes === 1 ? getOrmDb().select().from(skill_run_queue).where(eq(skill_run_queue.id, data.queueId)).get() : undefined
  },

  getRunQueue(id: string) {
    return getOrmDb().select().from(skill_run_queue).where(eq(skill_run_queue.id, id)).get()
  },

  listRunQueue(options: { runId?: string; status?: SkillRunQueueStatus } = {}) {
    const conditions = [
      options.runId === undefined ? undefined : eq(skill_run_queue.run_id, options.runId),
      options.status === undefined ? undefined : eq(skill_run_queue.status, options.status),
    ].filter(Boolean)
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions)
    const query = getOrmDb().select().from(skill_run_queue)
    return (where === undefined ? query.orderBy(asc(skill_run_queue.created_at)).all() : query.where(where).orderBy(asc(skill_run_queue.created_at)).all())
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
  const queue = createSqliteQueueRepository(clock)
  return { packages, runs, events, grants, artifacts, queue, clock, ids }
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
    createRunAndEnqueue(data) {
      const result = skillPackageRepo.createRunAndEnqueue(data)
      return { run: mapRun(result.run), queue: mapQueue(result.queue) }
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
          ...(data.changes.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: data.changes.cancelRequestedAt }),
          ...(data.changes.startedAt === undefined ? {} : { startedAt: data.changes.startedAt }),
          ...(data.changes.finishedAt === undefined ? {} : { finishedAt: data.changes.finishedAt }),
          ...(data.changes.errorCode === undefined ? {} : { errorCode: data.changes.errorCode }),
          ...(data.changes.errorMessage === undefined ? {} : { errorMessage: data.changes.errorMessage }),
          ...(data.changes.currentStep === undefined ? {} : { currentStep: data.changes.currentStep }),
          ...(data.changes.requiredAction === undefined ? {} : { requiredAction: data.changes.requiredAction }),
          ...(data.changes.workerId === undefined ? {} : { workerId: data.changes.workerId }),
          ...(data.changes.heartbeatAt === undefined ? {} : { heartbeatAt: data.changes.heartbeatAt }),
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

export function createSqliteQueueRepository(_clock: Clock = { now: () => Date.now() }): SkillRunQueueRepository {
  return {
    enqueue(data) {
      return mapQueue(skillPackageRepo.enqueueRun(data))
    },
    claimNext(data) {
      const row = skillPackageRepo.claimNextRunQueue(data)
      return row ? mapQueue(row) : undefined
    },
    heartbeat(data) {
      const row = skillPackageRepo.heartbeatRunQueue(data)
      return row ? mapQueue(row) : undefined
    },
    ack(data) {
      return skillPackageRepo.ackRunQueue(data)
    },
    retry(data) {
      const row = skillPackageRepo.retryRunQueue(data)
      return row ? mapQueue(row) : undefined
    },
    fail(data) {
      const row = skillPackageRepo.failRunQueue(data)
      return row ? mapQueue(row) : undefined
    },
    get(id) {
      const row = skillPackageRepo.getRunQueue(id)
      return row ? mapQueue(row) : undefined
    },
    list(options) {
      return skillPackageRepo.listRunQueue(options).map(mapQueue)
    },
  }
}

export function createSqliteEventRepository(clock: Clock = { now: () => Date.now() }): SkillRunEventRepository {
  return {
    appendEvent(data) {
      const row = skillPackageRepo.appendEvent({
        runId: data.runId,
        seq: data.seq,
        schemaVersion: data.schemaVersion,
        producer: data.producer,
        occurredAt: data.occurredAt,
        type: data.type,
        payload: data.payload,
      })
      return mapEvent(row)
    },
    listEvents(runId, options) {
      return skillPackageRepo.listEvents(runId, options).map(mapEvent)
    },
    listEventsPage(data) {
      const page = skillPackageRepo.listEventsPage(data.runId, data)
      return { data: page.data.map(mapEvent), nextAfterSeq: page.nextAfterSeq }
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
    getCapabilityGrant(id) {
      const row = skillPackageRepo.getCapabilityGrant(id)
      return row ? mapGrant(row) : undefined
    },
    listCapabilityGrants(skillVersionId, options) {
      return skillPackageRepo.listCapabilityGrants(skillVersionId, options).map(mapGrant)
    },
    findActiveCapabilityGrant(data) {
      const row = skillPackageRepo.findActiveCapabilityGrant(data)
      return row ? mapGrant(row) : undefined
    },
    updateCapabilityGrant(data) {
      const row = skillPackageRepo.updateCapabilityGrant(data)
      return row ? mapGrant(row) : undefined
    },
    consumeCapabilityGrant(id, now, context) {
      return skillPackageRepo.consumeCapabilityGrant(id, now, context)
    },
    revokeCapabilityGrant(id, now, reason) {
      return skillPackageRepo.revokeCapabilityGrant(id, now, reason)
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
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    status: row.status as SkillRunStatus,
    revision: row.revision,
    input: parseObject(row.input_json, 'run input'),
    output: row.output_json === null ? null : parseObject(row.output_json, 'run output'),
    context: parseObject(row.context_json, 'run context'),
    surface: row.surface,
    sessionId: row.session_id,
    imageSessionId: row.image_session_id,
    waitingReason: row.waiting_reason,
    cancelRequested: row.cancel_requested === 1,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    interruptedAt: row.interrupted_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    lastCheckpoint: row.last_checkpoint_json === null || row.last_checkpoint_json === undefined ? null : parseObject(row.last_checkpoint_json, 'last checkpoint'),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    currentStep: row.current_step ?? null,
    requiredAction: row.required_action_json === null || row.required_action_json === undefined ? null : parseObject(row.required_action_json, 'required action'),
    workerId: row.worker_id ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    executionMode: row.execution_mode ?? 'instruction-agent',
    stepCount: row.step_count ?? 0,
    tokenUsage: row.token_usage ?? 0,
    lastHeartbeatAt: row.last_heartbeat_at ?? row.heartbeat_at ?? null,
    resultSummary: row.result_summary ?? null,
  }
}

function mapEvent(row: any): RunEventSnapshot {
  return { id: row.id, runId: row.run_id, seq: row.seq, schemaVersion: row.schema_version, producer: row.producer ?? 'runtime', type: row.type, payload: parseObject(row.payload_json, 'event payload'), occurredAt: row.occurred_at ?? row.created_at, createdAt: row.created_at }
}

function mapGrant(row: any): CapabilityGrantSnapshot {
  const legacyScope = parseObject(row.scope_json ?? '{}', 'grant scope')
  const requestedScope = parseObject(row.requested_scope_json ?? row.scope_json ?? '{}', 'requested grant scope')
  const grantedScope = row.granted_scope_json === null || row.granted_scope_json === undefined
    ? (row.status === 'approved' || row.status === undefined ? legacyScope : null)
    : parseObject(row.granted_scope_json, 'granted grant scope')
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    capability: row.capability,
    grantMode: row.grant_mode,
    scope: grantedScope ?? {},
    requestedScope,
    grantedScope,
    status: row.status ?? 'approved',
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    approvedBy: row.approved_by ?? row.granted_by ?? null,
    approvedAt: row.approved_at ?? row.granted_at ?? null,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason ?? null,
    sessionId: row.session_id,
    runId: row.run_id ?? null,
    maxCalls: row.max_calls ?? null,
    callsUsed: row.calls_used ?? 0,
    consumedAt: row.consumed_at,
  }
}

function mapArtifact(row: any): ArtifactSnapshot {
  return { id: row.id, runId: row.run_id, kind: row.kind, mimeType: row.mime_type, path: row.path, sizeBytes: row.size_bytes, sha256: row.sha256, metadata: parseObject(row.metadata_json, 'artifact metadata'), createdAt: row.created_at }
}

function mapQueue(row: any): SkillRunQueueSnapshot {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status as SkillRunQueueStatus,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    attempt: row.attempt,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
