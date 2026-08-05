import { randomUUID } from 'crypto'
import type {
  ApplyRunChangeRequest,
  ApplyRunChangeResult,
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
} from './ports'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
    type: string
    payload: JsonObject
  }): RunEventSnapshot {
    const events = this.events.get(data.runId) ?? []
    const event: RunEventSnapshot = {
      id: this.ids.next(),
      runId: data.runId,
      seq: data.seq ?? this.nextSequence(data.runId),
      schemaVersion: data.schemaVersion,
      type: data.type,
      payload: clone(data.payload),
      createdAt: this.clock.now(),
    }
    events.push(event)
    events.sort((a, b) => a.seq - b.seq)
    this.events.set(data.runId, events)
    return clone(event)
  }

  listEvents(runId: string): readonly RunEventSnapshot[] {
    return clone(this.events.get(runId) ?? [])
  }

  nextSequence(runId: string): number {
    return (this.events.get(runId) ?? []).reduce((max, event) => Math.max(max, event.seq), 0) + 1
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
      cancelRequested: false,
      startedAt: data.status === 'running' ? now : null,
      updatedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    }
    this.runs.set(run.id, run)
    return clone(run)
  }

  getRun(id: string): RunSnapshot | undefined {
    const run = this.runs.get(id)
    return run ? clone(run) : undefined
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
      ...(changes.cancelRequested === undefined ? {} : { cancelRequested: changes.cancelRequested }),
      ...(changes.startedAt === undefined ? {} : { startedAt: changes.startedAt }),
      ...(changes.finishedAt === undefined ? {} : { finishedAt: changes.finishedAt }),
      ...(changes.errorCode === undefined ? {} : { errorCode: changes.errorCode }),
      ...(changes.errorMessage === undefined ? {} : { errorMessage: changes.errorMessage }),
      revision: current.revision + 1,
      updatedAt: this.clock.now(),
    }
    this.runs.set(next.id, next)
    this.events.appendEvent({ runId: data.runId, schemaVersion: data.event.schemaVersion, type: data.event.type, payload: data.event.payload })
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

  createArtifact(data: { runId: string; kind: string; path: string; sha256: string; mimeType?: string | null; sizeBytes?: number; metadata?: JsonObject }): ArtifactSnapshot {
    const row: ArtifactSnapshot = { id: this.ids.next(), runId: data.runId, kind: data.kind, mimeType: data.mimeType ?? null, path: data.path, sizeBytes: data.sizeBytes ?? 0, sha256: data.sha256, metadata: clone(data.metadata ?? {}), createdAt: this.clock.now() }
    this.artifacts.set(row.id, row)
    return clone(row)
  }
  getArtifact(id: string): ArtifactSnapshot | undefined { const row = this.artifacts.get(id); return row ? clone(row) : undefined }
  listArtifacts(runId: string): readonly ArtifactSnapshot[] { return [...this.artifacts.values()].filter((row) => row.runId === runId).sort((a, b) => a.createdAt - b.createdAt).map(clone) }
}

export class FakeCapabilityGrantRepository implements CapabilityGrantRepository {
  private readonly grants = new Map<string, CapabilityGrantSnapshot>()
  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}
  createCapabilityGrant(data: { skillVersionId: string; capability: string; grantMode: string; scope?: JsonObject; grantedBy?: string | null; expiresAt?: number | null; sessionId?: string | null }): CapabilityGrantSnapshot {
    const row: CapabilityGrantSnapshot = { id: this.ids.next(), skillVersionId: data.skillVersionId, capability: data.capability, grantMode: data.grantMode, scope: clone(data.scope ?? {}), grantedBy: data.grantedBy ?? null, grantedAt: this.clock.now(), expiresAt: data.expiresAt ?? null, revokedAt: null, sessionId: data.sessionId ?? null, consumedAt: null }
    this.grants.set(row.id, row)
    return clone(row)
  }
  listCapabilityGrants(skillVersionId: string): readonly CapabilityGrantSnapshot[] { return [...this.grants.values()].filter((row) => row.skillVersionId === skillVersionId).map(clone) }
  findActiveCapabilityGrant(data: { skillVersionId: string; capability: string; sessionId?: string | null; now?: number }): CapabilityGrantSnapshot | undefined {
    const now = data.now ?? this.clock.now()
    const row = [...this.grants.values()].find((candidate) => candidate.skillVersionId === data.skillVersionId && candidate.capability === data.capability && candidate.revokedAt === null && candidate.consumedAt === null && (candidate.expiresAt === null || candidate.expiresAt > now) && (candidate.sessionId === null || candidate.sessionId === (data.sessionId ?? null)))
    return row ? clone(row) : undefined
  }
  consumeCapabilityGrant(id: string, now = this.clock.now()): boolean { const row = this.grants.get(id); if (!row || row.revokedAt !== null || row.consumedAt !== null) return false; this.grants.set(id, { ...row, consumedAt: now }); return true }
  revokeCapabilityGrant(id: string, now = this.clock.now()): boolean { const row = this.grants.get(id); if (!row || row.revokedAt !== null) return false; this.grants.set(id, { ...row, revokedAt: now }); return true }
}

export function createFakeSkillRuntimePorts(options: { now?: number } = {}): SkillRuntimePorts & { clock: FakeClock; ids: FakeIdGenerator } {
  const clock = new FakeClock(options.now ?? 0)
  const ids = new FakeIdGenerator()
  const events = new FakeSkillRunEventRepository(ids, clock)
  return {
    packages: new FakePackageSkillRepository(ids, clock),
    runs: new FakeSkillRunRepository(ids, clock, events),
    events,
    grants: new FakeCapabilityGrantRepository(ids, clock),
    artifacts: new FakeArtifactRepository(ids, clock),
    clock,
    ids,
  }
}

export function createFakeId(): string {
  return randomUUID()
}
