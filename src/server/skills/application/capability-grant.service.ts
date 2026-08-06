import { z } from 'zod'
import {
  isForbiddenPackageCapability,
  isScopeSubset,
  normalizeCapabilityScope,
  capabilityGrantModeSchema,
  skillCapabilitySchema,
  type CapabilityGrantMode,
  type CapabilityScope,
} from '../policy/capability-policy'
import { normalizeSkillRunEvent } from '../runtime/skill-run-events'
import type {
  AuditRepository,
  CapabilityGrantRepository,
  CapabilityGrantSnapshot,
  CapabilityGrantStatus,
  Clock,
  JsonObject,
  PackageSkillRepository,
  SkillRunEventRepository,
  SkillRunRepository,
} from './ports'

const requestedCapabilitySchema = z.object({
  capability: z.string().min(1),
  scope: z.unknown().optional(),
  requestedScope: z.unknown().optional(),
  grantMode: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
}).passthrough()

export type CapabilityGrantServiceDependencies = {
  readonly packages: PackageSkillRepository
  readonly runs: SkillRunRepository
  readonly grants: CapabilityGrantRepository
  readonly clock: Clock
  readonly events: SkillRunEventRepository
  readonly audit?: AuditRepository
}

export type CapabilityGrantState = 'granted' | 'approval_required' | 'denied' | 'forbidden'

export type CapabilityRequestResult = {
  readonly grantId: string
  readonly runId: string
  readonly capability: string
  readonly requestedScope: CapabilityScope
  readonly grantedScope: CapabilityScope | null
  readonly state: CapabilityGrantState
  readonly status: CapabilityGrantState | 'forbidden'
  readonly grantStatus: CapabilityGrantStatus | 'forbidden'
  readonly approvalRequired: boolean
  readonly reason?: string
  readonly expiresAt?: number | null
}

export type CapabilityGrantServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'OWNERSHIP_VIOLATION'
  | 'SCOPE_EXCEEDED'
  | 'APPROVAL_REQUIRED'
  | 'GRANT_DENIED'
  | 'GRANT_REVOKED'
  | 'GRANT_EXPIRED'
  | 'GRANT_EXHAUSTED'
  | 'INVALID_GRANT_STATE'
  | 'FORBIDDEN_CAPABILITY'

export class CapabilityGrantServiceError extends Error {
  readonly name = 'CapabilityGrantServiceError'

  constructor(
    readonly code: CapabilityGrantServiceErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message)
  }
}

type ParsedRequestedCapability = {
  capability: string
  scope: CapabilityScope

  grantMode: CapabilityGrantMode
  sessionId: string | null
  expiresAt: number | null
}

export type CapabilityGrantView = CapabilityGrantSnapshot & { readonly grantId: string }

type ApproveGrantInput = {
  actor: string
  scope?: unknown
  expiresAt?: number | null
}

type ActorInput = {
  actor: string
  reason?: string
}

type ConsumeGrantInput = {
  runId?: string
  sessionId?: string
}

/**
 * Owns the requested-capability -> grant -> runtime-consumption lifecycle.
 *
 * Manifest declarations only create pending grants. A grant becomes usable
 * after an explicit approval whose scope is bounded by the immutable request.
 */
export class CapabilityGrantService {
  constructor(private readonly dependencies: CapabilityGrantServiceDependencies) {}

  requestCapabilities(runId: string, requestedOverride?: readonly unknown[]): readonly CapabilityRequestResult[] {
    const run = this.requireRun(runId)
    const version = this.dependencies.packages.getVersion(run.skillVersionId)
    if (!version) throw this.error('NOT_FOUND', `Skill version not found: ${run.skillVersionId}`)

    const requested = this.parseRequestedCapabilities(requestedOverride ?? this.readManifestCapabilities(version.manifest))
    return requested.map((request) => this.ensureRequestedGrant(run.id, run.skillVersionId, run.sessionId, request))
  }

  /** Creates a pending grant for an explicit request without approving it. */
  createGrant(input: {
    runId: string
    capability: string
    scope?: unknown
    grantMode?: string
    sessionId?: string | null
    expiresAt?: number | null
  }): CapabilityGrantSnapshot {
    const run = this.requireRun(input.runId)
    const request = this.parseRequestedCapability({
      capability: input.capability,
      scope: input.scope ?? {},
      grantMode: input.grantMode,
      sessionId: input.sessionId ?? run.sessionId ?? undefined,
      expiresAt: input.expiresAt ?? undefined,
    })
    this.assertGrantable(request.capability)
    return this.dependencies.grants.createCapabilityGrant({
      skillVersionId: run.skillVersionId,
      capability: request.capability,
      grantMode: request.grantMode,
      requestedScope: request.scope,
      grantedScope: null,
      status: 'pending',
      sessionId: request.grantMode === 'session' ? request.sessionId : null,
      runId: run.id,
      maxCalls: request.scope.maxCalls ?? null,
      expiresAt: request.expiresAt,
    })
  }

  approveGrant(grantId: string, input: ApproveGrantInput): CapabilityGrantView {
    const grant = this.requireGrant(grantId)
    const actor = this.requireActor(input.actor)
    const requestedScope = normalizeCapabilityScope(grant.requestedScope)
    const grantedScope = normalizeCapabilityScope(input.scope ?? requestedScope)
    this.assertOwnershipForGrant(grant, undefined, undefined)
    if (!isScopeSubset(grantedScope, requestedScope)) {
      throw this.error('SCOPE_EXCEEDED', `Granted scope exceeds requested scope for ${grant.capability}`)
    }
    if (grant.status === 'approved') {
      if (isScopeSubset(grantedScope, normalizeCapabilityScope(grant.grantedScope ?? grant.scope))
        && isScopeSubset(normalizeCapabilityScope(grant.grantedScope ?? grant.scope), grantedScope)) {
        return this.withGrantId(grant)
      }
      throw this.error('INVALID_GRANT_STATE', `Grant is already approved: ${grantId}`)
    }
    if (grant.status === 'rejected' || grant.status === 'revoked' || grant.status === 'expired' || grant.status === 'consumed') {
      throw this.error('INVALID_GRANT_STATE', `Grant cannot be approved from ${grant.status}`)
    }
    const now = this.dependencies.clock.now()
    const expiresAt = input.expiresAt === undefined ? grant.expiresAt : input.expiresAt
    if (expiresAt !== null && expiresAt !== undefined && expiresAt <= now) {
      throw this.error('VALIDATION_ERROR', 'Grant expiry must be in the future')
    }
    const updated = this.dependencies.grants.updateCapabilityGrant({
      id: grant.id,
      status: 'approved',
      grantedScope,
      approvedBy: actor,
      approvedAt: now,
      expiresAt: expiresAt ?? null,
      maxCalls: grantedScope.maxCalls ?? null,
    })
    if (!updated) throw this.error('NOT_FOUND', `Capability grant not found: ${grantId}`)
    this.audit('capability.approved', actor, updated, { scope: grantedScope })
    return this.withGrantId(updated)
  }

  rejectGrant(grantId: string, input: ActorInput): CapabilityGrantView {
    const grant = this.requireGrant(grantId)
    const actor = this.requireActor(input.actor)
    if (grant.status === 'rejected') return this.withGrantId(grant)
    if (grant.status !== 'pending') throw this.error('INVALID_GRANT_STATE', `Grant cannot be rejected from ${grant.status}`)
    const updated = this.dependencies.grants.updateCapabilityGrant({
      id: grant.id,
      status: 'rejected',
      revokeReason: input.reason?.trim() || 'Rejected by approver',
    })
    if (!updated) throw this.error('NOT_FOUND', `Capability grant not found: ${grantId}`)
    this.audit('capability.rejected', actor, updated, { reason: input.reason?.trim() || 'Rejected by approver' })
    this.appendEventForGrant(updated, 'capability.failed', { errorCode: 'CAPABILITY_REJECTED', reason: input.reason?.trim() || 'Rejected by approver' })
    return this.withGrantId(updated)
  }

  revokeGrant(grantId: string, input: ActorInput): CapabilityGrantView {
    const grant = this.requireGrant(grantId)
    const actor = this.requireActor(input.actor)
    if (grant.status === 'revoked') return this.withGrantId(grant)
    if (!['approved', 'pending', 'consumed'].includes(grant.status)) {
      throw this.error('INVALID_GRANT_STATE', `Grant cannot be revoked from ${grant.status}`)
    }
    const now = this.dependencies.clock.now()
    const reason = input.reason?.trim() || 'Revoked by approver'
    const revoked = grant.status === 'approved'
      ? this.dependencies.grants.revokeCapabilityGrant(grant.id, now, reason)
      : Boolean(this.dependencies.grants.updateCapabilityGrant({ id: grant.id, status: 'revoked', revokeReason: reason, revokedAt: now }))
    if (!revoked) throw this.error('INVALID_GRANT_STATE', `Grant could not be revoked: ${grantId}`)
    const updated = this.requireGrant(grantId)
    this.audit('capability.revoked', actor, updated, { reason })
    return this.withGrantId(updated)
  }

  expireGrant(grantId: string): CapabilityGrantSnapshot {
    const grant = this.requireGrant(grantId)
    const now = this.dependencies.clock.now()
    if (grant.status === 'expired') return grant
    if (grant.expiresAt === null || grant.expiresAt > now) {
      throw this.error('VALIDATION_ERROR', `Grant has not expired: ${grantId}`)
    }
    const updated = this.dependencies.grants.updateCapabilityGrant({ id: grant.id, status: 'expired' })
    if (!updated) throw this.error('NOT_FOUND', `Capability grant not found: ${grantId}`)
    this.audit('capability.expired', null, updated)
    return updated
  }

  consumeGrant(grantId: string, input: ConsumeGrantInput = {}): CapabilityGrantSnapshot {
    const grant = this.requireGrant(grantId)
    this.assertOwnershipForGrant(grant, input.runId, input.sessionId)
    const now = this.dependencies.clock.now()
    if (grant.expiresAt !== null && grant.expiresAt <= now) {
      this.dependencies.grants.updateCapabilityGrant({ id: grant.id, status: 'expired' })
      throw this.error('GRANT_EXPIRED', `Capability grant has expired: ${grantId}`)
    }
    if (grant.status === 'pending') throw this.error('APPROVAL_REQUIRED', `Capability approval required: ${grant.capability}`)
    if (grant.status === 'rejected') throw this.error('GRANT_DENIED', `Capability grant was rejected: ${grant.capability}`)
    if (grant.status === 'revoked') throw this.error('GRANT_REVOKED', `Capability grant was revoked: ${grant.capability}`)
    if (grant.status === 'consumed') throw this.error('GRANT_EXHAUSTED', `Capability grant is exhausted: ${grant.capability}`)
    if (grant.status !== 'approved') throw this.error('INVALID_GRANT_STATE', `Grant is not consumable: ${grant.status}`)
    if (grant.maxCalls !== null && grant.callsUsed >= grant.maxCalls) throw this.error('GRANT_EXHAUSTED', `Capability grant is exhausted: ${grant.capability}`)

    const consumed = this.dependencies.grants.consumeCapabilityGrant(grant.id, now, { runId: input.runId, sessionId: input.sessionId })
    if (!consumed) {
      const current = this.requireGrant(grantId)
      if (current.expiresAt !== null && current.expiresAt <= now) throw this.error('GRANT_EXPIRED', `Capability grant has expired: ${grantId}`)
      if (current.maxCalls !== null && current.callsUsed >= current.maxCalls || current.status === 'consumed') throw this.error('GRANT_EXHAUSTED', `Capability grant is exhausted: ${grant.capability}`)
      throw this.error('INVALID_GRANT_STATE', `Capability grant could not be consumed: ${grantId}`)
    }
    const updated = this.requireGrant(grantId)
    this.audit('capability.consumed', null, updated, { runId: input.runId ?? null, sessionId: input.sessionId ?? null })
    return updated
  }

  getRunCapabilities(runId: string): readonly CapabilityRequestResult[] {
    const run = this.requireRun(runId)
    const version = this.dependencies.packages.getVersion(run.skillVersionId)
    if (!version) throw this.error('NOT_FOUND', `Skill version not found: ${run.skillVersionId}`)
    const requested = this.parseRequestedCapabilities(this.readManifestCapabilities(version.manifest))
    const grants = this.dependencies.grants.listCapabilityGrants(run.skillVersionId, { runId: run.id, sessionId: run.sessionId })
    return requested.map((request) => {
      if (isForbiddenPackageCapability(request.capability) || !skillCapabilitySchema.safeParse(request.capability).success) {
        return this.toResult(run.id, request.capability, request.scope, null, 'forbidden', 'forbidden', 'Capability is not allowed for package runtime')
      }
      const grant = [...grants].reverse().find((candidate) => candidate.capability === request.capability && candidate.runId === run.id)
        ?? [...grants].reverse().find((candidate) => candidate.capability === request.capability && candidate.runId === null)
      return grant ? this.toResultFromGrant(run.id, grant) : this.toResult(run.id, request.capability, request.scope, null, 'approval_required', 'pending', 'Approval required')
    })
  }

  private ensureRequestedGrant(runId: string, skillVersionId: string, sessionId: string | null, request: ParsedRequestedCapability): CapabilityRequestResult {
    const requestedScope = request.scope
    if (isForbiddenPackageCapability(request.capability) || !skillCapabilitySchema.safeParse(request.capability).success) {
      return this.toResult(runId, request.capability, requestedScope, null, 'forbidden', 'forbidden', 'Capability is not allowed for package runtime')
    }
    const existing = this.dependencies.grants.listCapabilityGrants(skillVersionId, { runId, sessionId })
      .filter((grant) => grant.capability === request.capability && (grant.runId === runId || grant.runId === null))
      .sort((left, right) => right.grantedAt - left.grantedAt)[0]
    if (existing && existing.status === 'approved' && (existing.expiresAt === null || existing.expiresAt > this.dependencies.clock.now()) && (existing.maxCalls === null || existing.callsUsed < existing.maxCalls)) {
      return this.toResultFromGrant(runId, existing)
    }
    if (existing && ['pending', 'rejected', 'revoked', 'consumed'].includes(existing.status)) {
      return this.toResultFromGrant(runId, existing)
    }
    const grant = this.dependencies.grants.createCapabilityGrant({
      skillVersionId,
      capability: request.capability,
      grantMode: request.grantMode,
      requestedScope,
      grantedScope: null,
      status: 'pending',
      sessionId: request.grantMode === 'session' ? request.sessionId ?? sessionId : null,
      runId,
      maxCalls: requestedScope.maxCalls ?? null,
      expiresAt: request.expiresAt,
    })
    this.audit('capability.requested', null, grant, { requestedScope, grantMode: request.grantMode })
    this.appendEventForGrant(grant, 'capability.requested', {})
    this.appendEventForGrant(grant, 'capability.approval_required', { reason: 'Approval required' })
    return this.toResultFromGrant(runId, grant)
  }

  private parseRequestedCapabilities(value: unknown): ParsedRequestedCapability[] {
    if (!Array.isArray(value)) return []
    return value.map((raw) => this.parseRequestedCapability(raw))
  }

  private parseRequestedCapability(raw: unknown): ParsedRequestedCapability {
    const candidate = typeof raw === 'string' ? { capability: raw } : requestedCapabilitySchema.parse(raw)
    const scope = normalizeCapabilityScope(candidate.requestedScope ?? candidate.scope ?? {})
    const grantMode = this.normalizeGrantMode(candidate.grantMode)
    const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : null
    if (grantMode === 'session' && !sessionId) throw this.error('VALIDATION_ERROR', `Session grant requires sessionId for ${candidate.capability}`)
    const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : null
    return { capability: candidate.capability, scope, grantMode, sessionId, expiresAt }
  }

  private normalizeGrantMode(value: string | undefined): CapabilityGrantMode {
    if (value === 'run') return 'persistent'
    const parsed = capabilityGrantModeSchema.safeParse(value ?? 'persistent')
    if (!parsed.success) throw this.error('VALIDATION_ERROR', `Unsupported grant mode: ${value}`)
    return parsed.data
  }

  private readManifestCapabilities(manifest: JsonObject): unknown {
    return manifest.requestedCapabilities ?? manifest.requested_capabilities ?? manifest.capabilities ?? []
  }

  private requireRun(runId: string) {
    if (!runId || typeof runId !== 'string') throw this.error('VALIDATION_ERROR', 'runId is required')
    const run = this.dependencies.runs.getRun(runId)
    if (!run) throw this.error('NOT_FOUND', `Skill run not found: ${runId}`)
    return run
  }

  private requireGrant(grantId: string): CapabilityGrantSnapshot {
    if (!grantId) throw this.error('VALIDATION_ERROR', 'grantId is required')
    const grant = this.dependencies.grants.getCapabilityGrant(grantId)
    if (!grant) throw this.error('NOT_FOUND', `Capability grant not found: ${grantId}`)
    return grant
  }

  private assertGrantable(capability: string): void {
    if (isForbiddenPackageCapability(capability) || !skillCapabilitySchema.safeParse(capability).success) {
      throw this.error('FORBIDDEN_CAPABILITY', `Capability is not allowed for package runtime: ${capability}`)
    }
  }

  private requireActor(actor: string): string {
    if (typeof actor !== 'string' || actor.trim().length === 0) throw this.error('VALIDATION_ERROR', 'actor is required')
    return actor.trim()
  }

  private assertOwnershipForGrant(grant: CapabilityGrantSnapshot, runId: string | undefined, sessionId: string | undefined): void {
    if (runId !== undefined && grant.runId !== null && grant.runId !== runId) {
      throw this.error('OWNERSHIP_VIOLATION', `Capability grant ownership violation for run: ${runId}`)
    }
    if (sessionId !== undefined && grant.sessionId !== null && grant.sessionId !== sessionId) {
      throw this.error('OWNERSHIP_VIOLATION', `Capability grant ownership violation for session: ${sessionId}`)
    }
  }

  private toResultFromGrant(runId: string, grant: CapabilityGrantSnapshot): CapabilityRequestResult {
    if (grant.status === 'approved' && (grant.expiresAt === null || grant.expiresAt > this.dependencies.clock.now()) && (grant.maxCalls === null || grant.callsUsed < grant.maxCalls)) {
      return this.toResult(runId, grant.capability, normalizeCapabilityScope(grant.requestedScope), grant.grantedScope, 'granted', 'approved', undefined, grant.id, grant.expiresAt)
    }
    if (grant.status === 'pending') return this.toResult(runId, grant.capability, normalizeCapabilityScope(grant.requestedScope), null, 'approval_required', 'pending', 'Approval required', grant.id, grant.expiresAt)
    return this.toResult(runId, grant.capability, normalizeCapabilityScope(grant.requestedScope), grant.grantedScope, 'denied', grant.status, `Capability grant is ${grant.status}`, grant.id, grant.expiresAt)
  }

  private toResult(
    runId: string,
    capability: string,
    requestedScope: CapabilityScope,
    grantedScope: JsonObject | null,
    state: CapabilityGrantState,
    grantStatus: CapabilityGrantStatus | 'forbidden',
    reason?: string,
    grantId?: string,
    expiresAt?: number | null,
  ): CapabilityRequestResult {
    return { runId, capability, requestedScope, grantedScope: grantedScope ? normalizeCapabilityScope(grantedScope) : null, state, status: state, grantStatus, approvalRequired: state === 'approval_required', ...(reason ? { reason } : {}), grantId: grantId ?? '', ...(expiresAt === undefined ? {} : { expiresAt }) }
  }

  private appendEventForGrant(grant: CapabilityGrantSnapshot, type: 'capability.requested' | 'capability.approval_required' | 'capability.failed', extra: JsonObject): void {
    if (!grant.runId) return
    const normalized = normalizeSkillRunEvent({
      type,
      payload: { capability: grant.capability, grantId: grant.id, ...extra },
      occurredAt: this.dependencies.clock.now(),
      producer: 'capability-grant-service',
    })
    this.dependencies.events.appendEvent({
      runId: grant.runId,
      seq: this.dependencies.events.nextSequence(grant.runId),
      ...normalized,
    })
  }

  private audit(action: string, actor: string | null, grant: CapabilityGrantSnapshot, payload: JsonObject = {}): void {
    this.dependencies.audit?.append({
      actor,
      action,
      resourceType: 'skill_capability_grant',
      resourceId: grant.id,
      payload: { capability: grant.capability, skillVersionId: grant.skillVersionId, status: grant.status, at: this.dependencies.clock.now(), ...payload },
    })
  }

  private withGrantId(grant: CapabilityGrantSnapshot): CapabilityGrantView {
    return { ...grant, grantId: grant.id }
  }

  private error(code: CapabilityGrantServiceErrorCode, message: string, details?: JsonObject): CapabilityGrantServiceError {
    return new CapabilityGrantServiceError(code, message, details)
  }
}