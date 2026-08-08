import { randomUUID } from 'crypto'
import type {
  ApplyRunChangeRequest,
  ApplyRunChangeResult,
  ArtifactRepository,
  ArtifactStatus,
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
} from './ports'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneNullable<T>(value: T | null): T | null {
  return value === null ? null : clone(value)
}

export class FakeIdGenerator implements IdGenerator {
  private sequence = 0

  constructor(private readonly prefix = 'fake') {}

  next(): string {
    this.sequence += 1
    return `${this.prefix}-${this.sequence}`
  }
}

export class FakeClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current
  }

  advance(ms: number): void {
    this.current += ms
  }

  set(value: number): void {
    this.current = value
  }
}

export class FakeSkillRunEventRepository implements SkillRunEventRepository {
  private readonly events = new Map<string, RunEventSnapshot[]>()

  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}

  appendEvent(data: {
    runId: string
    seq?: number
    schemaVersion: number
    producer?: string
    occurredAt?: number
    type: string
    payload: JsonObject
  }): RunEventSnapshot {
    const events = this.events.get(data.runId) ?? []
    const event: RunEventSnapshot = {
      id: this.ids.next(),
      runId: data.runId,
      seq: data.seq ?? this.nextSequence(data.runId),
      schemaVersion: data.schemaVersion,
      producer: data.producer ?? 'runtime',
      type: data.type,
      payload: clone(data.payload),
      occurredAt: data.occurredAt ?? this.clock.now(),
      createdAt: this.clock.now(),
    }
    events.push(event)
    events.sort((a, b) => a.seq - b.seq)
    this.events.set(data.runId, events)
    return clone(event)
  }

  listEvents(runId: string, options: { afterSeq?: number; limit?: number } = {}): readonly RunEventSnapshot[] {
    const afterSeq = options.afterSeq ?? 0
    const limit = options.limit === undefined ? undefined : Math.max(1, Math.min(500, Math.trunc(options.limit)))
    const rows = (this.events.get(runId) ?? []).filter((event) => event.seq > afterSeq)
    return clone(limit === undefined ? rows : rows.slice(0, limit))
  }

  listEventsPage(data: { runId: string; afterSeq?: number; limit?: number }) {
    const limit = data.limit === undefined ? 100 : Math.max(1, Math.min(500, Math.trunc(data.limit)))
    const rows = this.listEvents(data.runId, { afterSeq: data.afterSeq, limit: limit + 1 })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return { data: page, nextAfterSeq: hasMore ? page[page.length - 1]?.seq ?? null : null }
  }

  nextSequence(runId: string): number {
    return (this.events.get(runId) ?? []).reduce((max, event) => Math.max(max, event.seq), 0) + 1
  }
}

export class FakeSkillRunQueueRepository implements SkillRunQueueRepository {
  private readonly items = new Map<string, SkillRunQueueSnapshot>()

  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}

  enqueue(data: { runId: string; availableAt?: number }): SkillRunQueueSnapshot {
    const active = [...this.items.values()].find((item) =>
      item.runId === data.runId && ['queued', 'leased', 'retry_wait'].includes(item.status))
    if (active) throw new Error(`Active queue item already exists for run: ${data.runId}`)
    const now = this.clock.now()
    const item: SkillRunQueueSnapshot = {
      id: this.ids.next(),
      runId: data.runId,
      status: 'queued',
      availableAt: data.availableAt ?? now,
      leaseOwner: null,
      leaseUntil: null,
      attempt: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }
    this.items.set(item.id, item)
    return clone(item)
  }

  claimNext(data: { workerId: string; leaseMs: number; now?: number }): SkillRunQueueSnapshot | undefined {
    const now = data.now ?? this.clock.now()
    const candidate = [...this.items.values()]
      .filter((item) => (
        ((item.status === 'queued' || item.status === 'retry_wait') && item.availableAt <= now) ||
        (item.status === 'leased' && item.leaseUntil !== null && item.leaseUntil <= now)
      ))
      .sort((left, right) => left.availableAt - right.availableAt || left.createdAt - right.createdAt)[0]
    if (!candidate) return undefined
    const next: SkillRunQueueSnapshot = {
      ...candidate,
      status: 'leased',
      leaseOwner: data.workerId,
      leaseUntil: now + data.leaseMs,
      attempt: candidate.attempt + 1,
      updatedAt: now,
    }
    this.items.set(next.id, next)
    return clone(next)
  }

  heartbeat(data: { queueId: string; workerId: string; leaseMs: number; now?: number }): SkillRunQueueSnapshot | undefined {
    const current = this.items.get(data.queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== data.workerId) return undefined
    const now = data.now ?? this.clock.now()
    const next = { ...current, leaseUntil: now + data.leaseMs, updatedAt: now }
    this.items.set(next.id, next)
    return clone(next)
  }

  ack(data: { queueId: string; workerId: string; now?: number }): boolean {
    const current = this.items.get(data.queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== data.workerId) return false
    const now = data.now ?? this.clock.now()
    this.items.set(current.id, { ...current, status: 'done', leaseOwner: null, leaseUntil: null, updatedAt: now })
    return true
  }

  retry(data: { queueId: string; workerId: string; error: string; delayMs: number; now?: number }): SkillRunQueueSnapshot | undefined {
    const current = this.items.get(data.queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== data.workerId) return undefined
    const now = data.now ?? this.clock.now()
    const next = { ...current, status: 'retry_wait' as const, availableAt: now + Math.max(0, data.delayMs), leaseOwner: null, leaseUntil: null, lastError: data.error, updatedAt: now }
    this.items.set(next.id, next)
    return clone(next)
  }

  fail(data: { queueId: string; workerId: string; error: string; now?: number }): SkillRunQueueSnapshot | undefined {
    const current = this.items.get(data.queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== data.workerId) return undefined
    const now = data.now ?? this.clock.now()
    const next = { ...current, status: 'dead' as const, leaseOwner: null, leaseUntil: null, lastError: data.error, updatedAt: now }
    this.items.set(next.id, next)
    return clone(next)
  }

  get(queueId: string): SkillRunQueueSnapshot | undefined {
    const item = this.items.get(queueId)
    return item ? clone(item) : undefined
  }

  list(options: { runId?: string; status?: SkillRunQueueStatus } = {}): readonly SkillRunQueueSnapshot[] {
    return [...this.items.values()]
      .filter((item) => options.runId === undefined || item.runId === options.runId)
      .filter((item) => options.status === undefined || item.status === options.status)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(clone)
  }
}

export class FakeSkillRunRepository implements SkillRunRepository {
  private readonly runs = new Map<string, RunSnapshot>()
  private readonly commands = new Map<string, RunSnapshot>()

  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: SkillRunEventRepository,
  ) {}

  createRun(data: {
    skillVersionId: string
    status: SkillRunStatus
    input: JsonObject
    context: JsonObject
    output?: JsonObject | null
    surface?: string | null
    sessionId?: string | null
    imageSessionId?: string | null
  }): RunSnapshot {
    const now = this.clock.now()
    const run: RunSnapshot = {
      id: this.ids.next(),
      skillVersionId: data.skillVersionId,
      status: data.status,
      revision: 0,
      input: clone(data.input),
      output: data.output === undefined ? null : clone(data.output),
      context: clone(data.context),
      surface: data.surface ?? null,
      sessionId: data.sessionId ?? null,
      imageSessionId: data.imageSessionId ?? null,
      waitingReason: null,
      waitingSince: null,
      waitingExpiresAt: null,
      cancelRequested: false,
      cancelRequestedAt: null,
      interruptedAt: null,
      cancelReason: null,
      lastCheckpoint: null,
      startedAt: data.status === 'running' ? now : null,
      updatedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      currentStep: null,
      requiredAction: null,
      workerId: null,
      heartbeatAt: null,
      executionMode: 'instruction-agent',
      stepCount: 0,
      tokenUsage: 0,
      lastHeartbeatAt: null,
      resultSummary: null,
    }
    this.runs.set(run.id, run)
    return clone(run)
  }

  getRun(id: string): RunSnapshot | undefined {
    const run = this.runs.get(id)
    return run ? clone(run) : undefined
  }

  removeRunForAtomicRollback(id: string): void {
    this.runs.delete(id)
  }

  setRunImageSessionId(runId: string, imageSessionId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId)
    if (!run) return undefined
    const next = { ...run, imageSessionId, updatedAt: this.clock.now() }
    this.runs.set(runId, next)
    return clone(next)
  }

  applyRunChange(data: ApplyRunChangeRequest): ApplyRunChangeResult | undefined {
    if (data.command) {
      const key = `${data.runId}\u0000${data.command.idempotencyKey}`
      const previous = this.commands.get(key)
      if (previous) return { run: clone(previous), duplicate: true }
    }
    const current = this.runs.get(data.runId)
    if (!current || current.revision !== data.expectedRevision) return undefined
    const changes = data.changes
    const next: RunSnapshot = {
      ...current,
      ...(changes.status === undefined ? {} : { status: changes.status }),
      ...(changes.input === undefined ? {} : { input: clone(changes.input) }),
      ...(changes.output === undefined ? {} : { output: changes.output === null ? null : clone(changes.output) }),
      ...(changes.waitingReason === undefined ? {} : { waitingReason: changes.waitingReason }),
      ...(changes.waitingSince === undefined ? {} : { waitingSince: changes.waitingSince }),
      ...(changes.waitingExpiresAt === undefined ? {} : { waitingExpiresAt: changes.waitingExpiresAt }),
      ...(changes.cancelRequested === undefined ? {} : { cancelRequested: changes.cancelRequested }),
      ...(changes.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: changes.cancelRequestedAt }),
      ...(changes.interruptedAt === undefined ? {} : { interruptedAt: changes.interruptedAt }),
      ...(changes.cancelReason === undefined ? {} : { cancelReason: changes.cancelReason }),
      ...(changes.lastCheckpoint === undefined ? {} : { lastCheckpoint: cloneNullable(changes.lastCheckpoint) }),
      ...(changes.startedAt === undefined ? {} : { startedAt: changes.startedAt }),
      ...(changes.finishedAt === undefined ? {} : { finishedAt: changes.finishedAt }),
      ...(changes.errorCode === undefined ? {} : { errorCode: changes.errorCode }),
      ...(changes.errorMessage === undefined ? {} : { errorMessage: changes.errorMessage }),
      ...(changes.currentStep === undefined ? {} : { currentStep: changes.currentStep }),
      ...(changes.requiredAction === undefined ? {} : { requiredAction: cloneNullable(changes.requiredAction) }),
      ...(changes.workerId === undefined ? {} : { workerId: changes.workerId }),
      ...(changes.heartbeatAt === undefined ? {} : { heartbeatAt: changes.heartbeatAt }),
      revision: current.revision + 1,
      updatedAt: this.clock.now(),
    }
    this.runs.set(next.id, next)
    this.events.appendEvent({ runId: data.runId, schemaVersion: data.event.schemaVersion, producer: data.event.producer, occurredAt: data.event.occurredAt, type: data.event.type, payload: data.event.payload })
    if (data.command) this.commands.set(`${data.runId}\u0000${data.command.idempotencyKey}`, next)
    return { run: clone(next), duplicate: false }
  }

  compareAndSet(data: ApplyRunChangeRequest): ApplyRunChangeResult | undefined {
    return this.applyRunChange(data)
  }

  getCommandResult(runId: string, idempotencyKey: string): RunSnapshot | undefined {
    const result = this.commands.get(`${runId}\u0000${idempotencyKey}`)
    return result ? clone(result) : undefined
  }

  listRunsByStatus(status: SkillRunStatus): readonly RunSnapshot[] {
    return [...this.runs.values()].filter((run) => run.status === status).map(clone)
  }

  listRuns(options: { limit: number; offset: number; status?: string; skillVersionId?: string }): Page<RunSnapshot> {
    const filtered = [...this.runs.values()]
      .filter((run) => options.status === undefined || run.status === options.status)
      .filter((run) => options.skillVersionId === undefined || run.skillVersionId === options.skillVersionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { data: filtered.slice(options.offset, options.offset + options.limit).map(clone), total: filtered.length }
  }
}

export class FakePackageSkillRepository implements PackageSkillRepository {
  private readonly packages = new Map<string, PackageSnapshot>()
  private readonly versions = new Map<string, VersionSnapshot>()
  private readonly installations = new Map<string, InstallationSnapshot>()

  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}

  createPackage(data: { name: string; description: string; sourceType: string; sourceUri?: string | null; sourceRef?: string | null }): PackageSnapshot {
    const now = this.clock.now()
    const row: PackageSnapshot = { id: this.ids.next(), name: data.name, description: data.description, sourceType: data.sourceType, sourceUri: data.sourceUri ?? null, sourceRef: data.sourceRef ?? null, createdAt: now, updatedAt: now }
    this.packages.set(row.id, row)
    return clone(row)
  }

  getPackage(id: string): PackageSnapshot | undefined { const row = this.packages.get(id); return row ? clone(row) : undefined }

  listPackages(options: { limit: number; offset: number }): Page<PackageSnapshot> {
    const rows = [...this.packages.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    return { data: rows.slice(options.offset, options.offset + options.limit).map(clone), total: rows.length }
  }

  createVersion(data: { packageId: string; version: string; manifest: JsonObject; manifestHash: string; packagePath: string; sourceSnapshot?: JsonObject; isCompatible?: boolean }): VersionSnapshot {
    const row: VersionSnapshot = { id: this.ids.next(), packageId: data.packageId, version: data.version, runtime: 'instruction-agent', manifest: clone(data.manifest), manifestHash: data.manifestHash, packagePath: data.packagePath, sourceSnapshot: clone(data.sourceSnapshot ?? {}), isCompatible: data.isCompatible !== false, createdAt: this.clock.now() }
    this.versions.set(row.id, row)
    return clone(row)
  }

  getVersion(id: string): VersionSnapshot | undefined { const row = this.versions.get(id); return row ? clone(row) : undefined }
  listVersions(packageId: string): readonly VersionSnapshot[] { return [...this.versions.values()].filter((row) => row.packageId === packageId).sort((a, b) => b.createdAt - a.createdAt).map(clone) }

  createInstallation(data: { packageId: string; currentVersionId: string; status: string; enabled?: boolean }): InstallationSnapshot {
    const now = this.clock.now()
    const row: InstallationSnapshot = { id: this.ids.next(), packageId: data.packageId, currentVersionId: data.currentVersionId, status: data.status, enabled: data.enabled !== false, installedAt: now, updatedAt: now }
    this.installations.set(row.id, row)
    return clone(row)
  }
  getInstallation(id: string): InstallationSnapshot | undefined { const row = this.installations.get(id); return row ? clone(row) : undefined }
  setInstallationEnabled(id: string, enabled: boolean): InstallationSnapshot | undefined { const row = this.installations.get(id); if (!row) return undefined; const next = { ...row, enabled, updatedAt: this.clock.now() }; this.installations.set(id, next); return clone(next) }
  listInstallations(packageId: string): readonly InstallationSnapshot[] { return [...this.installations.values()].filter((row) => row.packageId === packageId).sort((a, b) => b.updatedAt - a.updatedAt).map(clone) }
  deleteInstallation(id: string): boolean { return this.installations.delete(id) }
  resolveRunnableVersion(referenceId: string): VersionSnapshot | undefined {
    const direct = this.versions.get(referenceId)
    if (direct) return this.listInstallations(direct.packageId).some((row) => row.currentVersionId === direct.id && row.enabled && row.status === 'installed') ? clone(direct) : undefined
    const installation = this.installations.get(referenceId)
    if (installation?.enabled && installation.status === 'installed') return this.getVersion(installation.currentVersionId)
    if (!this.packages.has(referenceId)) return undefined
    const active = this.listInstallations(referenceId).find((row) => row.enabled && row.status === 'installed')
    return active ? this.getVersion(active.currentVersionId) : undefined
  }
  isPackageReference(referenceId: string): boolean { return this.packages.has(referenceId) || this.versions.has(referenceId) || this.installations.has(referenceId) }
}

export class FakeArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<string, ArtifactSnapshot>()

  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}

  createArtifact(data: { runId: string; kind: string; path: string; sha256: string; mimeType?: string | null; sizeBytes?: number; metadata?: JsonObject; retentionUntil?: number | null; status?: ArtifactStatus; skillVersionId?: string | null }): ArtifactSnapshot {
    const row: ArtifactSnapshot = { id: this.ids.next(), runId: data.runId, skillVersionId: data.skillVersionId ?? null, kind: data.kind, mimeType: data.mimeType ?? null, path: data.path, sizeBytes: data.sizeBytes ?? 0, sha256: data.sha256, status: data.status ?? 'ready', metadata: clone(data.metadata ?? {}), createdAt: this.clock.now(), retentionUntil: data.retentionUntil ?? null, exportedAt: null, exportedBy: null }
    this.artifacts.set(row.id, row)
    return clone(row)
  }
  getArtifact(id: string): ArtifactSnapshot | undefined { const row = this.artifacts.get(id); return row ? clone(row) : undefined }
  listArtifacts(runId: string): readonly ArtifactSnapshot[] { return [...this.artifacts.values()].filter((row) => row.runId === runId).sort((a, b) => a.createdAt - b.createdAt).map(clone) }
  updateArtifactStatus(data: { id: string; status: ArtifactStatus }): ArtifactSnapshot | undefined {
    const current = this.artifacts.get(data.id)
    if (!current) return undefined
    const next = { ...current, status: data.status }
    this.artifacts.set(data.id, next)
    return clone(next)
  }
  markArtifactExported(data: { id: string; exportedAt: number; exportedBy?: string | null }): ArtifactSnapshot | undefined {
    const current = this.artifacts.get(data.id)
    if (!current) return undefined
    const next = { ...current, exportedAt: data.exportedAt, exportedBy: data.exportedBy ?? null }
    this.artifacts.set(data.id, next)
    return clone(next)
  }
}

export class FakeCapabilityGrantRepository implements CapabilityGrantRepository {
  private readonly grants = new Map<string, CapabilityGrantSnapshot>()
  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}
  createCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    grantMode: string
    scope?: JsonObject
    requestedScope?: JsonObject
    grantedScope?: JsonObject | null
    status?: CapabilityGrantSnapshot['status']
    grantedBy?: string | null
    approvedBy?: string | null
    approvedAt?: number | null
    expiresAt?: number | null
    sessionId?: string | null
    runId?: string | null
    maxCalls?: number | null
    callsUsed?: number
  }): CapabilityGrantSnapshot {
    const requestedScope = clone(data.requestedScope ?? data.scope ?? {})
    const grantedScope = data.grantedScope === undefined ? (data.status === 'approved' || data.status === undefined ? clone(data.scope ?? requestedScope) : null) : cloneNullable(data.grantedScope)
    const row: CapabilityGrantSnapshot = {
      id: this.ids.next(), skillVersionId: data.skillVersionId, capability: data.capability, grantMode: data.grantMode,
      scope: clone(grantedScope ?? {}), requestedScope, grantedScope, status: data.status ?? 'approved',
      grantedBy: data.grantedBy ?? null, grantedAt: this.clock.now(), approvedBy: data.approvedBy ?? null,
      approvedAt: data.approvedAt ?? null, expiresAt: data.expiresAt ?? null, revokedAt: null,
      revokeReason: null, sessionId: data.sessionId ?? null, runId: data.runId ?? null,
      maxCalls: data.maxCalls ?? (typeof requestedScope.maxCalls === 'number' ? requestedScope.maxCalls : null),
      callsUsed: data.callsUsed ?? 0, consumedAt: null,
    }
    this.grants.set(row.id, row)
    return clone(row)
  }
  getCapabilityGrant(id: string): CapabilityGrantSnapshot | undefined { const row = this.grants.get(id); return row ? clone(row) : undefined }
  listCapabilityGrants(skillVersionId: string, options: { runId?: string | null; sessionId?: string | null } = {}): readonly CapabilityGrantSnapshot[] {
    return [...this.grants.values()].filter((row) => row.skillVersionId === skillVersionId
      && (options.runId === undefined || row.runId === options.runId)
      && (options.sessionId === undefined || row.sessionId === options.sessionId)).map(clone)
  }
  findActiveCapabilityGrant(data: { skillVersionId: string; capability: string; sessionId?: string | null; runId?: string | null; now?: number }): CapabilityGrantSnapshot | undefined {
    const now = data.now ?? this.clock.now()
    const row = [...this.grants.values()].find((candidate) => candidate.skillVersionId === data.skillVersionId && candidate.capability === data.capability
      && candidate.status === 'approved' && candidate.revokedAt === null && candidate.consumedAt === null
      && (candidate.expiresAt === null || candidate.expiresAt > now)
      && (candidate.maxCalls === null || candidate.callsUsed < candidate.maxCalls)
      && (candidate.sessionId === null || candidate.sessionId === (data.sessionId ?? null))
      && (candidate.runId === null || candidate.runId === (data.runId ?? null)))
    return row ? clone(row) : undefined
  }
  updateCapabilityGrant(data: { id: string; status?: CapabilityGrantSnapshot['status']; grantedScope?: JsonObject | null; approvedBy?: string | null; approvedAt?: number | null; revokeReason?: string | null; revokedAt?: number | null; expiresAt?: number | null; maxCalls?: number | null }): CapabilityGrantSnapshot | undefined {
    const row = this.grants.get(data.id)
    if (!row) return undefined
    const grantedScope = data.grantedScope === undefined ? row.grantedScope : cloneNullable(data.grantedScope)
    const next: CapabilityGrantSnapshot = { ...row,
      status: data.status ?? row.status, grantedScope, scope: clone(grantedScope ?? {}),
      approvedBy: data.approvedBy === undefined ? row.approvedBy : data.approvedBy,
      approvedAt: data.approvedAt === undefined ? row.approvedAt : data.approvedAt,
      revokeReason: data.revokeReason === undefined ? row.revokeReason : data.revokeReason,
      revokedAt: data.revokedAt === undefined ? row.revokedAt : data.revokedAt,
      expiresAt: data.expiresAt === undefined ? row.expiresAt : data.expiresAt,
      maxCalls: data.maxCalls === undefined ? row.maxCalls : data.maxCalls,
    }
    this.grants.set(row.id, next)
    return clone(next)
  }
  consumeCapabilityGrant(id: string, now = this.clock.now(), context: { runId?: string | null; sessionId?: string | null } = {}): boolean {
    const row = this.grants.get(id)
    if (!row || row.status !== 'approved' || row.revokedAt !== null || row.consumedAt !== null) return false
    if (row.expiresAt !== null && row.expiresAt <= now) { this.grants.set(id, { ...row, status: 'expired' }); return false }
    if (context.runId !== undefined && row.runId !== null && context.runId !== row.runId) return false
    if (context.sessionId !== undefined && row.sessionId !== null && context.sessionId !== row.sessionId) return false
    if (row.maxCalls !== null && row.callsUsed >= row.maxCalls) return false
    const callsUsed = row.callsUsed + 1
    const exhausted = row.grantMode === 'once' || row.maxCalls !== null && callsUsed >= row.maxCalls
    this.grants.set(id, { ...row, callsUsed, consumedAt: row.grantMode === 'once' ? now : null, status: exhausted ? 'consumed' : 'approved' })
    return true
  }
  revokeCapabilityGrant(id: string, now = this.clock.now(), reason?: string): boolean {
    const row = this.grants.get(id)
    if (!row || row.revokedAt !== null || row.status !== 'approved') return false
    this.grants.set(id, { ...row, status: 'revoked', revokedAt: now, revokeReason: reason ?? null })
    return true
  }
}

export function createFakeSkillRuntimePorts(options: { now?: number } = {}): SkillRuntimePorts & { clock: FakeClock; ids: FakeIdGenerator } {
  const clock = new FakeClock(options.now ?? 0)
  const ids = new FakeIdGenerator()
  const events = new FakeSkillRunEventRepository(ids, clock)
  const queue = new FakeSkillRunQueueRepository(ids, clock)
  const runs = new FakeSkillRunRepository(ids, clock, events)
  const atomicRuns = runs as FakeSkillRunRepository & {
    createRunAndEnqueue: (data: Parameters<SkillRunRepository['createRun']>[0] & { availableAt?: number; initialEvent?: { schemaVersion: number; type: string; payload: JsonObject } }) => ReturnType<NonNullable<SkillRunRepository['createRunAndEnqueue']>>
  }

  atomicRuns.createRunAndEnqueue = (data) => {
    const run = runs.createRun(data)
    try {
      const queued = queue.enqueue({ runId: run.id, availableAt: data.availableAt })
      if (data.initialEvent) events.appendEvent({ runId: run.id, seq: 1, ...data.initialEvent })
      return { run, queue: queued }
    } catch (error) {
      // Keep the fake's atomic contract aligned with the SQLite adapter.
      runs.removeRunForAtomicRollback(run.id)
      throw error
    }
  }
  return {
    packages: new FakePackageSkillRepository(ids, clock),
    runs: atomicRuns,
    events,
    grants: new FakeCapabilityGrantRepository(ids, clock),
    artifacts: new FakeArtifactRepository(ids, clock),
    queue,
    clock,
    ids,
  }
}

export function createFakeId(): string {
  return randomUUID()
}
