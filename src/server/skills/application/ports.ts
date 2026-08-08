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
  readonly deletedAt?: number | null
  readonly deleteReason?: string | null
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
  readonly immutableHash?: string
  readonly status?: string
  readonly securityStatus?: string
  readonly snapshotHash?: string
  readonly securityFindings?: JsonObject
  readonly publishedAt?: number | null
  readonly createdAt: number
}

export type InstallationSnapshot = {
  readonly id: string
  readonly packageId: string
  readonly currentVersionId: string
  readonly previousVersionId?: string | null
  readonly status: string
  readonly enabled: boolean
  readonly revision?: number
  readonly changedAt?: number | null
  readonly disabledAt?: number | null
  readonly uninstalledAt?: number | null
  readonly deletedAt?: number | null
  readonly rollbackReason?: string | null
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

export type SkillRunQueueStatus = 'queued' | 'leased' | 'retry_wait' | 'done' | 'dead'

export type SkillRunQueueSnapshot = {
  readonly id: string
  readonly runId: string
  readonly status: SkillRunQueueStatus
  readonly availableAt: number
  readonly leaseOwner: string | null
  readonly leaseUntil: number | null
  readonly attempt: number
  readonly lastError: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

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
  readonly waitingSince: number | null
  readonly waitingExpiresAt: number | null
  readonly cancelRequested: boolean
  readonly cancelRequestedAt: number | null
  readonly interruptedAt: number | null
  readonly cancelReason: string | null
  readonly lastCheckpoint: JsonObject | null
  readonly startedAt: number | null
  readonly updatedAt: number
  readonly finishedAt: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly currentStep: string | null
  readonly requiredAction: JsonObject | null
  readonly workerId: string | null
  readonly heartbeatAt: number | null
  readonly executionMode: string
  readonly stepCount: number
  readonly tokenUsage: number
  readonly lastHeartbeatAt: number | null
  readonly resultSummary: string | null
}

export type RunEventSnapshot = {
  readonly id: string
  readonly runId: string
  readonly seq: number
  readonly schemaVersion: number
  readonly producer: string
  readonly type: string
  readonly payload: JsonObject
  readonly occurredAt: number
  /** Legacy alias retained for existing consumers. */
  readonly createdAt: number
}

export type RunChange = {
  readonly status?: SkillRunStatus
  readonly input?: JsonObject
  readonly output?: JsonObject | null
  readonly waitingReason?: string | null
  readonly waitingSince?: number | null
  readonly waitingExpiresAt?: number | null
  readonly cancelRequested?: boolean
  readonly cancelRequestedAt?: number | null
  readonly interruptedAt?: number | null
  readonly cancelReason?: string | null
  readonly lastCheckpoint?: JsonObject | null
  readonly startedAt?: number | null
  readonly finishedAt?: number | null
  readonly errorCode?: string | null
  readonly errorMessage?: string | null
  readonly currentStep?: string | null
  readonly requiredAction?: JsonObject | null
  readonly workerId?: string | null
  readonly heartbeatAt?: number | null
  readonly executionMode?: string
  readonly stepCount?: number
  readonly tokenUsage?: number
  readonly lastHeartbeatAt?: number | null
  readonly resultSummary?: string | null
}

export type RunChangeEvent = {
  readonly schemaVersion: number
  readonly producer?: string
  readonly occurredAt?: number
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

export type CapabilityGrantStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'consumed'

export type CapabilityGrantSnapshot = {
  readonly id: string
  readonly skillVersionId: string
  readonly capability: string
  readonly grantMode: string
  /** Legacy alias for grantedScope retained for existing broker callers. */
  readonly scope: JsonObject
  readonly requestedScope: JsonObject
  readonly grantedScope: JsonObject | null
  readonly status: CapabilityGrantStatus
  readonly grantedBy: string | null
  readonly grantedAt: number
  readonly approvedBy: string | null
  readonly approvedAt: number | null
  readonly expiresAt: number | null
  readonly revokedAt: number | null
  readonly revokeReason: string | null
  readonly sessionId: string | null
  readonly runId: string | null
  readonly maxCalls: number | null
  readonly callsUsed: number
  readonly consumedAt: number | null
}

export type ArtifactStatus = 'processing' | 'ready' | 'orphaned'

export type ArtifactSnapshot = {
  readonly id: string
  readonly runId: string
  readonly skillVersionId: string | null
  readonly kind: string
  readonly mimeType: string | null
  readonly path: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly metadata: JsonObject
  readonly status: ArtifactStatus
  readonly createdAt: number
  readonly retentionUntil?: number | null
  readonly exportedAt?: number | null
  readonly exportedBy?: string | null
}

export type AuditEvent = {
  readonly actor?: string | null
  readonly action: string
  readonly resourceType: string
  readonly resourceId?: string | null
  readonly securityDecision?: string
  readonly policyVersion?: string
  readonly sourceFingerprint?: string | null
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
  listPackages(options: { limit: number; offset: number; includeArchived?: boolean }): Page<PackageSnapshot>
  createVersion(data: {
    packageId: string
    version: string
    manifest: JsonObject
    manifestHash: string
    packagePath: string
    sourceSnapshot?: JsonObject
    isCompatible?: boolean
    immutableHash?: string
    status?: string
    securityStatus?: string
    snapshotHash?: string
    securityFindings?: JsonObject
  }): VersionSnapshot
  getVersion(id: string): VersionSnapshot | undefined
  listVersions(packageId: string): readonly VersionSnapshot[]
  findVersionByImmutableHash?(packageId: string, immutableHash: string): VersionSnapshot | undefined
  createInstallation(data: {
    packageId: string
    currentVersionId: string
    status: string
    enabled?: boolean
  }): InstallationSnapshot
  getInstallation(id: string): InstallationSnapshot | undefined
  setInstallationEnabled(id: string, enabled: boolean): InstallationSnapshot | undefined
  getInstallationCommandResult?(installationId: string, idempotencyKey: string): InstallationSnapshot | undefined
  setInstallationEnabledCas?(data: { installationId: string; enabled: boolean; expectedRevision: number; idempotencyKey: string }): InstallationSnapshot | undefined
  listInstallations(packageId: string): readonly InstallationSnapshot[]
  listAllInstallations?(options: { limit: number; offset: number }): Page<InstallationSnapshot>
  deleteInstallation(id: string): boolean
  uninstallInstallation?(data: { installationId: string; expectedRevision: number; idempotencyKey: string }): InstallationSnapshot | undefined
  rollbackInstallation?(data: { installationId: string; versionId: string; expectedRevision: number; idempotencyKey: string; reason: string }): InstallationSnapshot | undefined
  softDeletePackage?(data: { packageId: string; idempotencyKey: string; reason: string }): PackageSnapshot | undefined
  switchCurrentVersion?(data: { installationId: string; versionId: string; expectedRevision: number; idempotencyKey: string }): InstallationSnapshot | undefined
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
  findChatRunByIdempotency?(sessionId: string, idempotencyKey: string): RunSnapshot | undefined
  listRunsByStatus(status: SkillRunStatus): readonly RunSnapshot[]
  listRuns(options: { limit: number; offset: number; status?: string; skillVersionId?: string }): Page<RunSnapshot>
  /**
   * Atomically creates a run and its durable queue item when the adapter can
   * provide a single database transaction. The coordinator falls back to the
   * two port calls for test doubles that do not implement this optimization.
   */
  createRunAndEnqueue?(data: {
    skillVersionId: string
    status: SkillRunStatus
    input: JsonObject
    context: JsonObject
    output?: JsonObject | null
    surface?: string | null
    sessionId?: string | null
    imageSessionId?: string | null
    availableAt?: number
    initialEvent?: {
      schemaVersion: number
      producer?: string
      occurredAt?: number
      type: string
      payload: JsonObject
    }
  }): { run: RunSnapshot; queue: SkillRunQueueSnapshot }
  compareAndSet(data: ApplyRunChangeRequest): ApplyRunChangeResult | undefined
  claimNextRun?(input: { workerId: string; leaseMs: number; now?: number }): RunSnapshot | undefined
  releaseLease?(runId: string, workerId: string): boolean
  markInterrupted?(workerId?: string): number
}

export interface SkillRunQueueRepository {
  enqueue(data: { runId: string; availableAt?: number }): SkillRunQueueSnapshot
  claimNext(data: { workerId: string; leaseMs: number; now?: number }): SkillRunQueueSnapshot | undefined
  heartbeat(data: { queueId: string; workerId: string; leaseMs: number; now?: number }): SkillRunQueueSnapshot | undefined
  ack(data: { queueId: string; workerId: string; now?: number }): boolean
  retry(data: { queueId: string; workerId: string; error: string; delayMs: number; now?: number }): SkillRunQueueSnapshot | undefined
  fail(data: { queueId: string; workerId: string; error: string; now?: number }): SkillRunQueueSnapshot | undefined
  get(queueId: string): SkillRunQueueSnapshot | undefined
  list(options?: { runId?: string; status?: SkillRunQueueStatus }): readonly SkillRunQueueSnapshot[]
}

export interface SkillRunEventRepository {
  appendEvent(data: {
    runId: string
    seq?: number
    schemaVersion: number
    producer?: string
    occurredAt?: number
    type: string
    payload: JsonObject
  }): RunEventSnapshot
  listEvents(runId: string, options?: { afterSeq?: number; limit?: number }): readonly RunEventSnapshot[]
  listEventsPage?(data: { runId: string; afterSeq?: number; limit?: number }): { data: readonly RunEventSnapshot[]; nextAfterSeq: number | null }
  nextSequence(runId: string): number
}

export interface CapabilityGrantRepository {
  createCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    grantMode: string
    scope?: JsonObject
    requestedScope?: JsonObject
    grantedScope?: JsonObject | null
    status?: CapabilityGrantStatus
    grantedBy?: string | null
    approvedBy?: string | null
    approvedAt?: number | null
    expiresAt?: number | null
    sessionId?: string | null
    runId?: string | null
    maxCalls?: number | null
    callsUsed?: number
  }): CapabilityGrantSnapshot
  getCapabilityGrant(id: string): CapabilityGrantSnapshot | undefined
  listCapabilityGrants(skillVersionId: string, options?: { runId?: string | null; sessionId?: string | null }): readonly CapabilityGrantSnapshot[]
  findActiveCapabilityGrant(data: {
    skillVersionId: string
    capability: string
    sessionId?: string | null
    runId?: string | null
    now?: number
  }): CapabilityGrantSnapshot | undefined
  updateCapabilityGrant(data: {
    id: string
    status?: CapabilityGrantStatus
    grantedScope?: JsonObject | null
    approvedBy?: string | null
    approvedAt?: number | null
    revokeReason?: string | null
    revokedAt?: number | null
    expiresAt?: number | null
    maxCalls?: number | null
  }): CapabilityGrantSnapshot | undefined
  consumeCapabilityGrant(id: string, now?: number, context?: { runId?: string | null; sessionId?: string | null }): boolean
  revokeCapabilityGrant(id: string, now?: number, reason?: string): boolean
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
    retentionUntil?: number | null
    status?: ArtifactStatus
    skillVersionId?: string | null
  }): ArtifactSnapshot
  getArtifact(id: string): ArtifactSnapshot | undefined
  listArtifacts(runId: string): readonly ArtifactSnapshot[]
  updateArtifactStatus(data: { id: string; status: ArtifactStatus }): ArtifactSnapshot | undefined
  markArtifactExported?(data: { id: string; exportedAt: number; exportedBy?: string | null }): ArtifactSnapshot | undefined
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
  readonly queue: SkillRunQueueRepository
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
