/**
 * Application-level ports for the Package Skill runtime.
 *
 * These types intentionally use immutable domain snapshots instead of Drizzle
 * rows. SQLite adapters are responsible for translating between the two.
 */
export type JsonObject = Record<string, unknown>

export type Page<T> = {
  readonly data: readonly T[]
  readonly total: number
}

export type PackageSnapshot = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly sourceType: string
  readonly sourceUri: string | null
  readonly sourceRef: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type VersionSnapshot = {
  readonly id: string
  readonly packageId: string
  readonly version: string
  readonly runtime: string
  readonly manifest: JsonObject
  readonly manifestHash: string
  readonly packagePath: string
  readonly sourceSnapshot: JsonObject
  readonly isCompatible: boolean
  readonly createdAt: number
}

export type InstallationSnapshot = {
  readonly id: string
  readonly packageId: string
  readonly currentVersionId: string
  readonly status: string
  readonly enabled: boolean
  readonly installedAt: number
  readonly updatedAt: number
}

export type SkillRunStatus =
  | 'created'
  | 'validating'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type RunSnapshot = {
  readonly id: string
  readonly skillVersionId: string
  readonly status: SkillRunStatus
  readonly revision: number
  readonly input: JsonObject
  readonly output: JsonObject | null
  readonly context: JsonObject
  readonly surface: string | null
  readonly sessionId: string | null
  readonly imageSessionId: string | null
  readonly waitingReason: string | null
  readonly cancelRequested: boolean
  readonly startedAt: number | null
  readonly updatedAt: number
  readonly finishedAt: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

export type RunEventSnapshot = {
  readonly id: string
  readonly runId: string
  readonly seq: number
  readonly schemaVersion: number
  readonly type: string
  readonly payload: JsonObject
  readonly createdAt: number
}

export type RunChange = {
  readonly status?: SkillRunStatus
  readonly input?: JsonObject
  readonly output?: JsonObject | null
  readonly waitingReason?: string | null
  readonly cancelRequested?: boolean
  readonly startedAt?: number | null
  readonly finishedAt?: number | null
  readonly errorCode?: string | null
  readonly errorMessage?: string | null
}

export type RunChangeEvent = {
  readonly schemaVersion: number
  readonly type: string
  readonly payload: JsonObject
}

export type ApplyRunChangeRequest = {
  readonly runId: string
  readonly expectedRevision: number
  readonly changes: RunChange
  readonly event: RunChangeEvent
  readonly command?: { readonly idempotencyKey: string }
}

export type ApplyRunChangeResult = {
  readonly run: RunSnapshot
  readonly duplicate: boolean
}

export type CapabilityGrantSnapshot = {
  readonly id: string
  readonly skillVersionId: string
  readonly capability: string
  readonly grantMode: string
  readonly scope: JsonObject
  readonly grantedBy: string | null
  readonly grantedAt: number
  readonly expiresAt: number | null
  readonly revokedAt: number | null
  readonly sessionId: string | null
  readonly consumedAt: number | null
}

export type ArtifactSnapshot = {
  readonly id: string
  readonly runId: string
  readonly kind: string
  readonly mimeType: string | null
  readonly path: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly metadata: JsonObject
  readonly createdAt: number
}

export type AuditEvent = {
  readonly actor?: string | null
  readonly action: string
  readonly resourceType: string
  readonly resourceId?: string | null
  readonly payload?: JsonObject
}

export interface PackageSkillRepository {
  createPackage(data: {
    name: string
    description: string
    sourceType: string
    sourceUri?: string | null
    sourceRef?: string | null
  }): PackageSnapshot
  getPackage(id: string): PackageSnapshot | undefined
  listPackages(options: { limit: number; offset: number }): Page<PackageSnapshot>
  createVersion(data: {
    packageId: string
    version: string
    manifest: JsonObject
    manifestHash: string
    packagePath: string
    sourceSnapshot?: JsonObject
    isCompatible?: boolean
  }): VersionSnapshot
  getVersion(id: string): VersionSnapshot | undefined
  listVersions(packageId: string): readonly VersionSnapshot[]
  createInstallation(data: {
    packageId: string
    currentVersionId: string
    status: string
    enabled?: boolean
  }): InstallationSnapshot
  getInstallation(id: string): InstallationSnapshot | undefined
  setInstallationEnabled(id: string, enabled: boolean): InstallationSnapshot | undefined
  listInstallations(packageId: string): readonly InstallationSnapshot[]
  deleteInstallation(id: string): boolean
  resolveRunnableVersion(referenceId: string): VersionSnapshot | undefined
  isPackageReference(referenceId: string): boolean
}

export interface SkillRunRepository {
  createRun(data: {
    skillVersionId: string
    status: SkillRunStatus
    input: JsonObject
    context: JsonObject
    output?: JsonObject | null
    surface?: string | null
    sessionId?: string | null
    imageSessionId?: string | null
  }): RunSnapshot
  getRun(id: string): RunSnapshot | undefined
  setRunImageSessionId(runId: string, imageSessionId: string): RunSnapshot | undefined
  applyRunChange(data: ApplyRunChangeRequest): ApplyRunChangeResult | undefined
  getCommandResult(runId: string, idempotencyKey: string): RunSnapshot | undefined
  listRunsByStatus(status: SkillRunStatus): readonly RunSnapshot[]
  listRuns(options: { limit: number; offset: number; status?: string; skillVersionId?: string }): Page<RunSnapshot>
  compareAndSet(data: ApplyRunChangeRequest): ApplyRunChangeResult | undefined
  claimNextRun?(input: { workerId: string; leaseMs: number; now?: number }): RunSnapshot | undefined
  releaseLease?(runId: string, workerId: string): boolean
  markInterrupted?(workerId?: string): number
}

export interface SkillRunEventRepository {
  appendEvent(data: {
    runId: string
    seq?: number
    schemaVersion: number
    type: string
    payload: JsonObject
  }): RunEventSnapshot
  listEvents(runId: string): readonly RunEventSnapshot[]
  nextSequence(runId: string): number
}

export interface CapabilityGrantRepository {
  createCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    grantMode: string
    scope?: JsonObject
    grantedBy?: string | null
    expiresAt?: number | null
    sessionId?: string | null
  }): CapabilityGrantSnapshot
  listCapabilityGrants(skillVersionId: string): readonly CapabilityGrantSnapshot[]
  findActiveCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    sessionId?: string | null
    now?: number
  }): CapabilityGrantSnapshot | undefined
  consumeCapabilityGrant(id: string, now?: number): boolean
  revokeCapabilityGrant(id: string, now?: number): boolean
}

export interface ArtifactRepository {
  createArtifact(data: {
    runId: string
    kind: string
    path: string
    sha256: string
    mimeType?: string | null
    sizeBytes?: number
    metadata?: JsonObject
  }): ArtifactSnapshot
  getArtifact(id: string): ArtifactSnapshot | undefined
  listArtifacts(runId: string): readonly ArtifactSnapshot[]
}

export interface AuditRepository {
  append(event: AuditEvent): void
}

export interface Clock {
  now(): number
}

export interface IdGenerator {
  next(): string
}

export type SkillRuntimePorts = {
  readonly packages: PackageSkillRepository
  readonly runs: SkillRunRepository
  readonly events: SkillRunEventRepository
  readonly grants: CapabilityGrantRepository
  readonly artifacts: ArtifactRepository
  readonly audit?: AuditRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

/** The Legacy adapter is intentionally separate from PackageSkillRepository. */
export interface LegacySkillRepositoryPort {
  list(): readonly JsonObject[]
  get(id: string): JsonObject | undefined
  install(id: string): JsonObject
  update(id: string, patch: JsonObject): JsonObject
  delete(id: string): boolean
  run(id: string, input: JsonObject): Promise<JsonObject>
}
