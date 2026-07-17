import { v4 as uuidv4 } from 'uuid'
import { and, eq, isNull } from 'drizzle-orm'
import type { ResearchRunDto, ResearchRunFilter, ResearchRunStatus } from '@shared/deepresearch/contracts'
import { isDeepResearchAutoResumeEnabled } from '../config/config'
import { getOrmDb } from '../db/client'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import { research_recovery_commands, research_runs } from '../db/schema'

const RECOVERY_LEASE_MS = 30_000
const RECOVERABLE_ACTIVE_STATUSES: ResearchRunStatus[] = ['planning', 'researching', 'synthesizing', 'verifying']
const RECOVERY_AUTO_RESUME_KEY_PREFIX = 'deepresearch:auto-resume:v1:'
const WORKFLOW_ACTIVE_STATUSES = new Set(['running', 'pending', 'waiting'])
const WORKFLOW_INTERRUPTABLE_STATUSES = new Set(['suspended'])
const WORKFLOW_TERMINAL_STATUSES = new Set(['success', 'succeeded', 'completed', 'failed', 'canceled', 'cancelled'])

type RecoveryCommandStatus = 'claimed' | 'dispatching' | 'dispatched'

const RECOVERY_PROCESS_DISPATCH_TOKEN_PREFIX = uuidv4()

export interface DeepResearchWorkflowRunState {
  status: string
}

export interface DeepResearchRecoveryRunSnapshot {
  run: ResearchRunDto
  executorId: string | null
  leaseExpiresAt: number | null
  workflowRunId: string | null
}

export interface DeepResearchRecoveryCorrection {
  runId: string
  fromStatus: ResearchRunStatus
  toStatus: ResearchRunStatus
  leaseExpired: boolean
  leaseExpiresAt: number | null
  executorId: string | null
  workflowRunId: string | null
  workflowStatus: string | null
  run: ResearchRunDto
}

export type DeepResearchRecoverySkipReason = 'workflow-active' | 'workflow-terminal' | 'workflow-unknown'

export interface DeepResearchRecoverySkippedRun {
  runId: string
  status: ResearchRunStatus
  reason: DeepResearchRecoverySkipReason
  leaseExpired: boolean
  leaseExpiresAt: number | null
  executorId: string | null
  workflowRunId: string | null
  workflowStatus: string | null
  run: ResearchRunDto
}

export interface DeepResearchRecoveryRunRepository {
  list(filter?: ResearchRunFilter): ResearchRunDto[]
  get(id: string): ResearchRunDto | undefined
  getRecoverySnapshot?(id: string): DeepResearchRecoveryRunSnapshot | undefined
  acquireLease(id: string, executorId: string, leaseMs: number, now?: number): boolean
  releaseLease(id: string, executorId: string): boolean
  transitionWithEvent(id: string, to: ResearchRunStatus, options?: { phase?: string; resumePhase?: string | null }): ResearchRunDto
}

export interface DeepResearchRecoveryCoordinatorOptions {
  researchRunRepo?: DeepResearchRecoveryRunRepository
  getWorkflowRunState?: (workflowRunId: string) => Promise<DeepResearchWorkflowRunState | null>
  enqueueResume?: (runId: string, commandKey: string) => Promise<unknown>
  claimCommandKey?: (runId: string, commandKey: string) => boolean | Promise<boolean>
  releaseCommandKey?: (runId: string, commandKey: string) => void | Promise<void>
  markCommandDispatched?: (runId: string, commandKey: string) => void | Promise<void>
  claimedCommandKeys?: Set<string>
  isAutoResumeEnabled?: () => boolean
  recoveryExecutorId?: string
  leaseMs?: number
}

export interface DeepResearchRecoveryResult {
  interrupted: ResearchRunDto[]
  autoResumed: ResearchRunDto[]
  corrections: DeepResearchRecoveryCorrection[]
  skipped: DeepResearchRecoverySkippedRun[]
}

const defaultClaimedRecoveryCommandKeys = new Set<string>()

function normalizeWorkflowStatus(state: DeepResearchWorkflowRunState | null): string | null {
  return typeof state?.status === 'string' && state.status.trim() ? state.status.trim().toLowerCase() : null
}

function recoverySkipReason(workflowStatus: string | null): DeepResearchRecoverySkipReason | null {
  if (workflowStatus === null || WORKFLOW_INTERRUPTABLE_STATUSES.has(workflowStatus)) return null
  if (WORKFLOW_ACTIVE_STATUSES.has(workflowStatus)) return 'workflow-active'
  if (WORKFLOW_TERMINAL_STATUSES.has(workflowStatus)) return 'workflow-terminal'
  return 'workflow-unknown'
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof (error as { message?: unknown })?.message === 'string'
    && (error as { message: string }).message.includes('UNIQUE constraint failed')
}

function claimPersistedRecoveryCommand(runId: string, commandKey: string): boolean {
  const now = Date.now()
  try {
    getOrmDb().insert(research_recovery_commands).values({
      id: uuidv4(),
      run_id: runId,
      command_key: commandKey,
      status: 'claimed',
      dispatch_token: null,
      created_at: now,
      updated_at: now,
    }).run()
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return true
    throw error
  }
}

function newDispatchToken(): string {
  return RECOVERY_PROCESS_DISPATCH_TOKEN_PREFIX + ':' + uuidv4()
}

function isCurrentProcessDispatchToken(token: string | null): boolean {
  return typeof token === 'string' && token.startsWith(RECOVERY_PROCESS_DISPATCH_TOKEN_PREFIX + ':')
}

function dispatchTokenPredicate(token: string | null) {
  return token === null ? isNull(research_recovery_commands.dispatch_token) : eq(research_recovery_commands.dispatch_token, token)
}

function markPersistedRecoveryCommandDispatched(runId: string, commandKey: string, dispatchToken: string, now = Date.now()): boolean {
  const result = getOrmDb().update(research_recovery_commands).set({
    status: 'dispatched',
    dispatch_token: null,
    updated_at: now,
  }).where(and(
    eq(research_recovery_commands.run_id, runId),
    eq(research_recovery_commands.command_key, commandKey),
    eq(research_recovery_commands.status, 'dispatching'),
    eq(research_recovery_commands.dispatch_token, dispatchToken),
  )).run()
  return result.changes === 1
}

function releasePersistedRecoveryCommandDispatch(runId: string, commandKey: string, dispatchToken: string, now = Date.now()): boolean {
  const result = getOrmDb().update(research_recovery_commands).set({
    status: 'claimed',
    dispatch_token: null,
    updated_at: now,
  }).where(and(
    eq(research_recovery_commands.run_id, runId),
    eq(research_recovery_commands.command_key, commandKey),
    eq(research_recovery_commands.status, 'dispatching'),
    eq(research_recovery_commands.dispatch_token, dispatchToken),
  )).run()
  return result.changes === 1
}

function beginPersistedRecoveryCommandDispatch(runId: string, commandKey: string, allowDispatched: boolean, now = Date.now()): string | null {
  const current = getOrmDb().select({
    status: research_recovery_commands.status,
    dispatchToken: research_recovery_commands.dispatch_token,
  }).from(research_recovery_commands).where(and(
    eq(research_recovery_commands.run_id, runId),
    eq(research_recovery_commands.command_key, commandKey),
  )).get()
  if (!current) return null

  const currentStatus = current.status as RecoveryCommandStatus
  const retryableStatuses: RecoveryCommandStatus[] = allowDispatched ? ['claimed', 'dispatched'] : ['claimed']
  const canDispatch = retryableStatuses.includes(currentStatus)
    || (currentStatus === 'dispatching' && !isCurrentProcessDispatchToken(current.dispatchToken))
  if (!canDispatch) return null

  const dispatchToken = newDispatchToken()
  const result = getOrmDb().update(research_recovery_commands).set({
    status: 'dispatching',
    dispatch_token: dispatchToken,
    updated_at: now,
  }).where(and(
    eq(research_recovery_commands.run_id, runId),
    eq(research_recovery_commands.command_key, commandKey),
    eq(research_recovery_commands.status, currentStatus),
    dispatchTokenPredicate(current.dispatchToken),
  )).run()
  return result.changes === 1 ? dispatchToken : null
}

export function createDeepResearchRecoveryCoordinator(options: DeepResearchRecoveryCoordinatorOptions = {}) {
  const repository: DeepResearchRecoveryRunRepository = options.researchRunRepo ?? researchRunRepo
  const leaseMs = options.leaseMs ?? RECOVERY_LEASE_MS
  const isAutoResumeEnabled = options.isAutoResumeEnabled ?? isDeepResearchAutoResumeEnabled
  const recoveryExecutorId = options.recoveryExecutorId ?? 'deepresearch-recovery-' + uuidv4()
  const claimedCommandKeys = options.claimedCommandKeys ?? defaultClaimedRecoveryCommandKeys
  const persistedDispatchTokens = new Map<string, string>()

  function getRecoverySnapshot(id: string): DeepResearchRecoveryRunSnapshot | undefined {
    const injectedSnapshot = repository.getRecoverySnapshot?.(id)
    if (injectedSnapshot) return injectedSnapshot

    const run = repository.get(id)
    if (!run) return undefined


    const row = getOrmDb().select({
      executorId: research_runs.executor_id,
      leaseExpiresAt: research_runs.lease_expires_at,
      workflowRunId: research_runs.workflow_run_id,
    }).from(research_runs).where(eq(research_runs.id, id)).get()

    return row
      ? {
        run,
        executorId: row.executorId ?? null,
        leaseExpiresAt: row.leaseExpiresAt ?? null,
        workflowRunId: row.workflowRunId ?? run.workflowRunId,
      }
      : undefined
  }

  async function inspectWorkflowState(run: ResearchRunDto): Promise<string | null> {
    if (!run.workflowRunId || !options.getWorkflowRunState) return null
    return normalizeWorkflowStatus(await options.getWorkflowRunState(run.workflowRunId))
  }

  function hasExpiredLease(snapshot: DeepResearchRecoveryRunSnapshot, now: number): boolean {
    return snapshot.leaseExpiresAt !== null && snapshot.leaseExpiresAt <= now
  }

  function toSkippedRun(snapshot: DeepResearchRecoveryRunSnapshot, reason: DeepResearchRecoverySkipReason, workflowStatus: string | null): DeepResearchRecoverySkippedRun {
    return {
      runId: snapshot.run.id,
      status: snapshot.run.status,
      reason,
      leaseExpired: true,
      leaseExpiresAt: snapshot.leaseExpiresAt,
      executorId: snapshot.executorId,
      workflowRunId: snapshot.run.workflowRunId ?? snapshot.workflowRunId,
      workflowStatus,
      run: snapshot.run,
    }
  }

  async function interruptExpiredActiveRuns(now: number): Promise<{ interrupted: ResearchRunDto[]; corrections: DeepResearchRecoveryCorrection[]; skipped: DeepResearchRecoverySkippedRun[] }> {
    const interrupted: ResearchRunDto[] = []
    const corrections: DeepResearchRecoveryCorrection[] = []
    const skipped: DeepResearchRecoverySkippedRun[] = []

    for (const listed of repository.list({ statuses: RECOVERABLE_ACTIVE_STATUSES })) {
      const originalSnapshot = getRecoverySnapshot(listed.id)
      if (!originalSnapshot || !RECOVERABLE_ACTIVE_STATUSES.includes(originalSnapshot.run.status)) continue
      if (!hasExpiredLease(originalSnapshot, now)) continue

      const originalWorkflowStatus = await inspectWorkflowState(originalSnapshot.run)
      const originalSkipReason = recoverySkipReason(originalWorkflowStatus)
      if (originalSkipReason) {
        skipped.push(toSkippedRun(originalSnapshot, originalSkipReason, originalWorkflowStatus))
        continue
      }

      if (!repository.acquireLease(listed.id, recoveryExecutorId, leaseMs, now)) continue

      try {
        const current = repository.get(listed.id)
        if (!current || !RECOVERABLE_ACTIVE_STATUSES.includes(current.status)) continue

        const workflowStatus = await inspectWorkflowState(current)
        const skipReason = recoverySkipReason(workflowStatus)
        if (skipReason) {
          skipped.push(toSkippedRun({ ...originalSnapshot, run: current, workflowRunId: current.workflowRunId ?? originalSnapshot.workflowRunId }, skipReason, workflowStatus))
          continue
        }

        const corrected = repository.transitionWithEvent(current.id, 'interrupted', {
          phase: 'interrupted',
          resumePhase: current.phase,
        })
        interrupted.push(corrected)
        corrections.push({
          runId: current.id,
          fromStatus: current.status,
          toStatus: 'interrupted',
          leaseExpired: true,
          leaseExpiresAt: originalSnapshot.leaseExpiresAt,
          executorId: originalSnapshot.executorId,
          workflowRunId: current.workflowRunId ?? originalSnapshot.workflowRunId,
          workflowStatus,
          run: corrected,
        })
      } finally {
        repository.releaseLease(listed.id, recoveryExecutorId)
      }
    }

    return { interrupted, corrections, skipped }
  }

  async function claimCommandKey(runId: string, commandKey: string): Promise<boolean> {
    if (options.claimCommandKey) return options.claimCommandKey(runId, commandKey)
    if (!options.claimedCommandKeys) return claimPersistedRecoveryCommand(runId, commandKey)
    if (claimedCommandKeys.has(commandKey)) return false
    claimedCommandKeys.add(commandKey)
    return true
  }

  async function releaseCommandKey(runId: string, commandKey: string): Promise<void> {
    if (options.releaseCommandKey) return options.releaseCommandKey(runId, commandKey)
    if (!options.claimCommandKey && !options.claimedCommandKeys) {
      const dispatchToken = persistedDispatchTokens.get(commandKey)
      if (dispatchToken) releasePersistedRecoveryCommandDispatch(runId, commandKey, dispatchToken)
      persistedDispatchTokens.delete(commandKey)
      return
    }
    claimedCommandKeys.delete(commandKey)
  }

  async function beginCommandDispatch(runId: string, commandKey: string, status: ResearchRunStatus, now: number): Promise<boolean> {
    if (options.claimCommandKey || options.claimedCommandKeys) return claimCommandKey(runId, commandKey)
    claimPersistedRecoveryCommand(runId, commandKey)
    const dispatchToken = beginPersistedRecoveryCommandDispatch(runId, commandKey, status === 'queued', now)
    if (!dispatchToken) return false
    persistedDispatchTokens.set(commandKey, dispatchToken)
    return true
  }

  async function markCommandDispatched(runId: string, commandKey: string): Promise<void> {
    if (options.markCommandDispatched) return options.markCommandDispatched(runId, commandKey)
    if (!options.claimCommandKey && !options.claimedCommandKeys) {
      const dispatchToken = persistedDispatchTokens.get(commandKey)
      if (dispatchToken) markPersistedRecoveryCommandDispatched(runId, commandKey, dispatchToken)
      persistedDispatchTokens.delete(commandKey)
    }
  }

  async function autoResumeInterruptedRuns(): Promise<ResearchRunDto[]> {
    if (!isAutoResumeEnabled() || !options.enqueueResume) return []

    const autoResumed: ResearchRunDto[] = []
    for (const listed of repository.list({ statuses: ['interrupted', 'queued'] })) {
      const current = repository.get(listed.id)
      if (current?.status !== 'interrupted' && current?.status !== 'queued') continue

      const commandKey = RECOVERY_AUTO_RESUME_KEY_PREFIX + current.id
      if (!(await beginCommandDispatch(current.id, commandKey, current.status, Date.now()))) continue
      try {
        await options.enqueueResume(current.id, commandKey)
        await markCommandDispatched(current.id, commandKey)
      } catch (error) {
        await releaseCommandKey(current.id, commandKey)
        throw error
      }
      const queued = repository.get(current.id)
      if (queued?.status === 'queued') autoResumed.push(queued)
    }
    return autoResumed
  }

  return Object.freeze({
    async recoverInterruptedRuns(now = Date.now()): Promise<DeepResearchRecoveryResult> {
      const { interrupted, corrections, skipped } = await interruptExpiredActiveRuns(now)
      const autoResumed = await autoResumeInterruptedRuns()
      return { interrupted, autoResumed, corrections, skipped }
    },
  })
}
