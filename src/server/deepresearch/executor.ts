import { v4 as uuidv4 } from 'uuid'
import type { ResearchCheckpointCursorDto, ResearchClarificationInput } from '@shared/deepresearch/contracts'
import { researchAttemptRepo } from '../db/repositories/deepresearch/research-attempt.repo'
import { researchCheckpointRepo } from '../db/repositories/deepresearch/research-checkpoint.repo'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import type { DeepResearchWorkflowRunState } from './recovery'
import { classifyResearchError } from './domain/errors'
import { recordDeepResearchAttemptDuration, recordDeepResearchCancellationLatency, recordDeepResearchExternalCallsAfterCancellation, recordDeepResearchFailure, recordDeepResearchLeaseRejectedWrite } from '../telemetry/metrics'
import { logError } from '../logger/logger'

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_LEASE_RENEWAL_MS = 10_000

const activeAbortControllers = new Map<string, { attemptId: string; controller: AbortController }>()

/** Signals an in-process owner immediately after durable cancellation is recorded. */
export function abortActiveDeepResearchExecution(runId: string): boolean {
  const active = activeAbortControllers.get(runId)
  if (!active || active.controller.signal.aborted) return false
  active.controller.abort()
  return true
}

/**
 * Non-persisted capability handed to exactly one workflow invocation.  The
 * token is deliberately not part of public Run/Attempt DTOs: it only proves
 * this executor still owns the short-lived Attempt lease.
 */
export interface DeepResearchAttemptExecutionContext {
  runId: string
  attemptId: string
  executorId?: string
  ownershipToken: string
  signal: AbortSignal
  resumeCursor: ResearchCheckpointCursorDto | null
}

export interface DeepResearchRuntimeAdapter {
  start(context: DeepResearchAttemptExecutionContext): Promise<unknown>
  resume(context: DeepResearchAttemptExecutionContext, resumeData: ResearchClarificationInput): Promise<unknown>
  getWorkflowRunState?(workflowRunId: string): Promise<DeepResearchWorkflowRunState | null>
}

export interface DeepResearchExecutor {
  start(runId: string): Promise<boolean>
  resume(runId: string, resumeData: ResearchClarificationInput): Promise<boolean>
  getWorkflowRunState?(workflowRunId: string): Promise<DeepResearchWorkflowRunState | null>
  readonly executorId: string
}

export interface CreateDeepResearchExecutorOptions {
  runtime: DeepResearchRuntimeAdapter
  executorId?: string
  leaseMs?: number
  leaseRenewalMs?: number
  /** Injected only for deterministic lease tests. */
  now?: () => number
  setInterval?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
}

function attemptResumeCursor(runId: string, startCheckpointKey: string | null): ResearchCheckpointCursorDto | null {
  if (!startCheckpointKey) return researchRunRepo.get(runId)?.checkpointCursor ?? null
  return researchCheckpointRepo.list(runId).find((checkpoint) => checkpoint.checkpointKey === startCheckpointKey)?.resumeCursor
    ?? researchRunRepo.get(runId)?.checkpointCursor
    ?? null
}

function cancellationRequested(runId: string): boolean {
  const run = researchRunRepo.get(runId)
  return Boolean(run && (run.status === 'cancelling' || run.status === 'cancelled' || run.cancellation?.requestedAt != null))
}

function abort(controller: AbortController): void {
  if (!controller.signal.aborted) controller.abort()
}

function isSuspendedWorkflowResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'status' in result
    && (result as { status?: unknown }).status === 'suspended'
}

export function createDeepResearchExecutor(options: CreateDeepResearchExecutorOptions): DeepResearchExecutor {
  const executorId = options.executorId ?? 'deepresearch-' + uuidv4()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const leaseRenewalMs = options.leaseRenewalMs ?? DEFAULT_LEASE_RENEWAL_MS
  const now = options.now ?? Date.now
  const startInterval = options.setInterval ?? ((callback, delay) => setInterval(callback, delay))
  const stopInterval = options.clearInterval ?? ((timer) => clearInterval(timer))

  async function execute(runId: string, invoke: (context: DeepResearchAttemptExecutionContext) => Promise<unknown>): Promise<boolean> {
    // The command service chose the Attempt and its checkpoint.  The executor
    // only claims that Attempt; it never guesses a recovery phase.
    const attempt = researchAttemptRepo.findActive(runId)
    if (!attempt) return false

    const ownershipToken = uuidv4()
    if (!researchAttemptRepo.acquireLease(attempt.id, executorId, ownershipToken, leaseMs, now())) {
      const run = researchRunRepo.get(runId)
      if (run) recordDeepResearchLeaseRejectedWrite({ profile: run.profile, depth: run.depth, phase: run.phase })
      return false
    }
    const executionStartedAt = now()

    const controller = new AbortController()
    activeAbortControllers.set(runId, { attemptId: attempt.id, controller })
    let leaseLost = false
    const heartbeat = () => {
      if (!researchAttemptRepo.heartbeat(attempt.id, executorId, ownershipToken, leaseMs, now())) {
        leaseLost = true
        abort(controller)
        return
      }
      if (cancellationRequested(runId)) abort(controller)
    }
    const renewalTimer = startInterval(heartbeat, leaseRenewalMs)
    const context: DeepResearchAttemptExecutionContext = {
      runId,
      attemptId: attempt.id,
      executorId,
      ownershipToken,
      signal: controller.signal,
      resumeCursor: attemptResumeCursor(runId, attempt.startCheckpointKey),
    }

    try {
      if (cancellationRequested(runId)) abort(controller)
      if (controller.signal.aborted) {
        const completed = researchAttemptRepo.finishOwned({
          attemptId: attempt.id,
          executorId,
          ownershipToken,
          status: 'cancelled',
          now: now(),
        })
        return completed !== null
      }

      const result = await invoke(context)
      // A provider that cannot abort may still resolve. Never let that result
      // promote the Run or persist a downstream terminal outcome after cancel.
      if (controller.signal.aborted || cancellationRequested(runId)) {
        const completed = researchAttemptRepo.finishOwned({
          attemptId: attempt.id, executorId, ownershipToken, status: 'cancelled', now: now(),
        })
        return completed !== null && !leaseLost
      }
      // Suspending for clarification is not a terminal outcome. Release this
      // executor's short lease so the command-service resume path can claim
      // the same active Attempt with a fresh ownership token.
      if (isSuspendedWorkflowResult(result)) {
        // A cancellation request still wins over suspension. finishOwned()
        // rechecks both cancellation and ownership in one transaction.
        if (!cancellationRequested(runId)) return !leaseLost
        const completed = researchAttemptRepo.finishOwned({
          attemptId: attempt.id,
          executorId,
          ownershipToken,
          status: 'cancelled',
          now: now(),
        })
        return completed !== null && !leaseLost
      }
      const completed = researchAttemptRepo.finishOwned({
        attemptId: attempt.id,
        executorId,
        ownershipToken,
        status: 'succeeded',
        now: now(),
      })
      return completed !== null
    } catch (error) {
      const classification = classifyResearchError(error)
      logError('deep-research.execution', error, {
        runId,
        attemptId: attempt.id,
        phase: researchRunRepo.get(runId)?.phase ?? 'unknown',
        errorCode: classification.code,
        errorCategory: classification.category,
      })
      const status = classification.category === 'cancelled' || cancellationRequested(runId)
        ? 'cancelled'
        : 'failed'
      const completed = researchAttemptRepo.finishOwned({
        attemptId: attempt.id,
        executorId,
        ownershipToken,
        status,
        error: status === 'failed'
          ? { code: classification.code, message: classification.message, retryable: classification.retryable, category: classification.category }
          : null,
        now: now(),
      })
      if (completed && status === 'failed') {
        const run = researchRunRepo.get(runId)
        if (run) {
          recordDeepResearchFailure({
            researchRunId: run.id,
            workflowRunId: run.workflowRunId,
            profile: run.profile,
            depth: run.depth,
            phase: run.phase,
          })
        }
      }
      return completed !== null && !leaseLost
    } finally {
      stopInterval(renewalTimer)
      // This is a no-op after finishOwned; it only clears a still-owned lease
      // on an interruption path and cannot clear a replacement executor lease.
      researchAttemptRepo.releaseLease(attempt.id, executorId, ownershipToken)
      const finalRun = researchRunRepo.get(runId)
      if (finalRun) {
        const telemetryContext = { profile: finalRun.profile, depth: finalRun.depth, phase: finalRun.phase }
        recordDeepResearchAttemptDuration(now() - executionStartedAt, telemetryContext)
        const cancellationRequestedAt = finalRun.cancellation?.requestedAt ?? null
        if (cancellationRequestedAt != null || finalRun.status === 'cancelling' || finalRun.status === 'cancelled') {
          if (cancellationRequestedAt != null) recordDeepResearchCancellationLatency(Math.max(0, now() - cancellationRequestedAt), telemetryContext)
          // Every provider launch is guarded before invocation; a cancelled execution therefore contributes zero new calls.
          recordDeepResearchExternalCallsAfterCancellation(0, telemetryContext)
        }
      }
      if (activeAbortControllers.get(runId)?.attemptId === attempt.id) activeAbortControllers.delete(runId)
    }
  }

  return Object.freeze({
    executorId,
    start(runId: string): Promise<boolean> {
      return execute(runId, (context) => options.runtime.start(context))
    },
    resume(runId: string, resumeData: ResearchClarificationInput): Promise<boolean> {
      return execute(runId, (context) => options.runtime.resume(context, resumeData))
    },
    getWorkflowRunState(workflowRunId: string): Promise<DeepResearchWorkflowRunState | null> {
      return options.runtime.getWorkflowRunState?.(workflowRunId) ?? Promise.resolve(null)
    },
  })
}
