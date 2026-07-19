import fs from 'node:fs'
import type {
  ResearchArtifactContent,
  ResearchAttemptTrigger,
  ResearchCoverageAssessmentDto,
  ResearchHistoryPageDto,
  ResearchIterationDto,
  ResearchRunAttemptSummaryDto,
  ResearchRunCheckpointSummaryDto,
  ResearchRunLifecycleDto,
  ResearchCheckpointCursorDto,
  ResearchClarificationInput,
  ResearchEventDto,
  ResearchRunAttemptDto,
  ResearchRunCheckpointDto,
  ResearchRunDetailDto,
  ResearchRunDiagnosticsDto,
  ResearchRunDto,
  ResearchRunFilter,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { researchAttemptRepo } from '../db/repositories/deepresearch/research-attempt.repo'
import { researchCheckpointRepo } from '../db/repositories/deepresearch/research-checkpoint.repo'
import { researchEventRepo } from '../db/repositories/deepresearch/research-event.repo'
import { researchIterationRepo } from '../db/repositories/deepresearch/research-iteration.repo'
import { researchCoverageAssessmentRepo } from '../db/repositories/deepresearch/research-coverage-assessment.repo'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import { researchReportRepo } from '../db/repositories/deepresearch/research-report.repo'
import { researchSourceRepo } from '../db/repositories/deepresearch/research-source.repo'
import { subscribeToResearchEvents } from './research-event-publisher'
import { claimDeepResearchCommand, deepResearchCommandKey, markDeepResearchCommandDispatched } from './commands'
import { getResearchBudget } from './domain/budgets'
import { createCheckpointCursor, createCheckpointReplayFingerprint } from './domain/checkpoint-replay'
import { isResearchDomainError, ResearchDomainError } from './domain/errors'
import { resolveResearchModelSnapshot, resolveResearchRuntimeModel } from './domain/model-selection'
import { createDeepResearchRecoveryCoordinator, type DeepResearchRecoveryResult, type DeepResearchWorkflowRunState } from './recovery'
import { abortActiveDeepResearchExecution } from './executor'
import { buildResearchRunDiagnostics } from './run-diagnostics'
import { recordDeepResearchCancellation, recordDeepResearchCheckpointReuse, recordDeepResearchResume, recordDeepResearchResumeOutcome, type DeepResearchTelemetryContext } from '../telemetry/metrics'

export interface DeepResearchScheduler {
  start(runId: string): Promise<unknown>
  resume(runId: string, resumeData: ResearchClarificationInput): Promise<unknown>
  getWorkflowRunState?(workflowRunId: string): Promise<DeepResearchWorkflowRunState | null>
}

export interface CreateDeepResearchServiceOptions {
  runtime: DeepResearchScheduler
}

/** Options shared by the start, resume and cancel command entry points. */
export interface DeepResearchCommandOptions {
  /** Client request ID / idempotency key. It is scoped to the Run by the command service. */
  commandKey?: string
  /** Recovery may select auto_resume; interactive calls keep the safe defaults. */
  trigger?: ResearchAttemptTrigger
  /** The first cancellation reason is durable; duplicate requests cannot replace it. */
  reason?: string | null
}

function requireRun(runId: string): ResearchRunDto {
  const run = researchRunRepo.get(runId)
  if (run) return run

  throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run not found: ' + runId, false)
}

function schedule(operation: () => Promise<unknown>): void {
  void operation().catch(() => undefined)
}

function telemetryContext(run: ResearchRunDto): DeepResearchTelemetryContext {
  return {
    researchRunId: run.id,
    workflowRunId: run.workflowRunId,
    profile: run.profile,
    depth: run.depth,
    phase: run.phase,
  }
}

function scopedCommandKey(
  kind: 'start' | 'resume' | 'cancel',
  run: ResearchRunDto,
  suppliedKey?: string,
): string {
  if (!suppliedKey) return deepResearchCommandKey(kind, run.id, run.stateVersion)
  return `deepresearch:command:v1:${kind}:${run.id}:client:${suppliedKey}`
}
function commandFingerprint(run: ResearchRunDto): string {
  return createCheckpointReplayFingerprint(run)
}

function initialCursor(run: ResearchRunDto): ResearchCheckpointCursorDto {
  return createCheckpointCursor(run, 'planning', 0)
}

function commandResult(run: ResearchRunDto, attempt?: ResearchRunAttemptDto | null, checkpoint?: ResearchRunCheckpointDto | null): ResearchRunDto {
  const currentAttempt = attempt ?? (run.currentAttemptId ? researchAttemptRepo.get(run.currentAttemptId) : undefined)
  const latestCheckpoint = checkpoint ?? (currentAttempt?.startCheckpointKey
    ? researchCheckpointRepo.list(run.id).find((item) => item.checkpointKey === currentAttempt.startCheckpointKey)
    : undefined)

  return {
    ...run,
    currentAttemptId: currentAttempt?.id ?? run.currentAttemptId ?? null,
    execution: currentAttempt ? { attempt: currentAttempt } : null,
    latestCheckpoint: latestCheckpoint ?? null,
    checkpointCursor: latestCheckpoint?.resumeCursor ?? run.checkpointCursor ?? null,
  }
}

function activeCommandResult(run: ResearchRunDto): ResearchRunDto | null {
  const active = researchAttemptRepo.findActive(run.id)
  return active ? commandResult(run, active) : null
}

export interface ResearchHistoryQuery {
  limit?: number
  cursor?: string
}

function attemptSummary(attempt: ResearchRunAttemptDto): ResearchRunAttemptSummaryDto {
  return {
    id: attempt.id,
    ordinal: attempt.ordinal,
    trigger: attempt.trigger,
    status: attempt.status,
    startCheckpointKey: attempt.startCheckpointKey,
    endCheckpointKey: attempt.endCheckpointKey,
    error: attempt.error,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    createdAt: attempt.createdAt,
  }
}

function checkpointSummary(checkpoint: ResearchRunCheckpointDto): ResearchRunCheckpointSummaryDto {
  return {
    id: checkpoint.id,
    attemptId: checkpoint.attemptId,
    sequence: checkpoint.sequence,
    checkpointKey: checkpoint.checkpointKey,
    phase: checkpoint.phase,
    status: checkpoint.status,
    resumeCursor: checkpoint.resumeCursor,
    replayPolicy: checkpoint.replayPolicy,
    createdAt: checkpoint.createdAt,
  }
}

function pageHistory<T>(items: readonly T[], query: ResearchHistoryQuery, cursorOf: (item: T) => string): ResearchHistoryPageDto<T> {
  const limit = Math.max(1, Math.min(query.limit ?? 20, 100))
  const start = query.cursor ? Math.max(0, items.findIndex((item) => cursorOf(item) === query.cursor) + 1) : 0
  const page = items.slice(start, start + limit)
  const hasMore = start + page.length < items.length
  return { items: page, nextCursor: hasMore && page.length > 0 ? cursorOf(page[page.length - 1]) : null }
}

function getLifecycle(run: ResearchRunDto): ResearchRunLifecycleDto {
  const attempts = researchAttemptRepo.listForRun(run.id)
  const checkpoints = researchCheckpointRepo.list(run.id)
  const iterations = researchIterationRepo.list(run.id).slice().reverse()
  const assessments = researchCoverageAssessmentRepo.list(run.id)
  const currentAttempt = run.currentAttemptId ? attempts.find((item) => item.id === run.currentAttemptId) ?? null : null
  const stopReason = iterations.find((item) => item.stopReason)?.stopReason ?? null
  const limitations = [...new Set([
    ...(run.quality?.limitations ?? []),
    ...(assessments[0]?.limitations ?? []),
    ...iterations.flatMap((item) => item.limitations),
    ...(stopReason?.limitations ?? []),
  ])]

  return {
    currentAttempt: currentAttempt ? attemptSummary(currentAttempt) : null,
    resumeCheckpoint: checkpoints[0] ? checkpointSummary(checkpoints[0]) : null,
    assessment: assessments[0] ?? null,
    attemptHistory: pageHistory(attempts.map(attemptSummary), {}, (item) => String(item.ordinal)),
    iterationHistory: pageHistory(iterations, {}, (item) => String(item.ordinal)),
    budget: { limit: run.budget, usage: run.usage },
    stopReason,
    limitations,
    cancellation: run.cancellation ?? null,
    capabilities: run.capabilities!,
  }
}

export function createDeepResearchService({ runtime }: CreateDeepResearchServiceOptions) {
  function dispatchStart(runId: string, commandKey: string): void {
    if (!markDeepResearchCommandDispatched(runId, commandKey)) return
    schedule(() => runtime.start(runId))
  }

  async function startRun(runId: string, options: DeepResearchCommandOptions = {}): Promise<ResearchRunDto> {
    const observed = requireRun(runId)
    const active = activeCommandResult(observed)
    if (active) return active
    if (observed.status !== 'queued' || observed.cancellation) {
      throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is not startable: ' + runId, false)
    }

    const trigger = options.trigger === 'auto_resume' ? 'auto_resume' : 'initial'
    const commandKey = scopedCommandKey('start', observed, options.commandKey)
    if (!claimDeepResearchCommand(runId, commandKey)) return commandResult(requireRun(runId))

    const current = requireRun(runId)
    const currentActive = activeCommandResult(current)
    if (currentActive) return currentActive
    if (current.status !== 'queued' || current.cancellation) return commandResult(current)

    const { attempt, checkpoint } = researchAttemptRepo.createWithInitialCheckpoint({
      runId,
      trigger,
      checkpoint: {
        checkpointKey: 'run:queued',
        phase: 'queued',
        status: 'completed',
        resumeCursor: initialCursor(current),
        inputFingerprint: commandFingerprint(current),
        replayPolicy: 'reuse',
      },
    })

    dispatchStart(runId, commandKey)
    return commandResult(requireRun(runId), attempt, checkpoint)
  }

  async function resumeRun(runId: string, options: DeepResearchCommandOptions = {}): Promise<ResearchRunDto> {
    const observed = requireRun(runId)
    const active = activeCommandResult(observed)
    if (observed.status === 'queued' && active) return active
    if (observed.status === 'queued' && options.trigger === 'auto_resume') {
      return startRun(runId, { ...options, trigger: 'auto_resume' })
    }
    if (observed.status === 'cancelled') {
      recordDeepResearchResumeOutcome('rejected', telemetryContext(observed))
      throw new ResearchDomainError('RESEARCH_CANCELLED', 'Cancelled Deep Research Runs cannot be resumed: ' + runId, false)
    }
    if (observed.status === 'cancelling') {
      recordDeepResearchResumeOutcome('rejected', telemetryContext(observed))
      throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is cancelling: ' + runId, false)
    }
    const canResume = observed.status === 'interrupted' || (observed.status === 'failed' && observed.error?.retryable === true)
    if (!canResume) {
      recordDeepResearchResumeOutcome('rejected', telemetryContext(observed))
      throw new ResearchDomainError('RESEARCH_NOT_RESUMABLE', 'Deep Research Run is not resumable: ' + runId, false)
    }

    if (observed.modelSelectionSnapshot) {
      try {
        await resolveResearchModelSnapshot(observed.modelSelectionSnapshot)
      } catch (error) {
        if (!isResearchDomainError(error) || error.code !== 'RESEARCH_MODEL_UNAVAILABLE') throw error

        const failed = researchRunRepo.transitionWithEventCas(runId, observed.stateVersion ?? 0, 'failed', {
          phase: 'awaiting_model_configuration',
          error: {
            code: error.code,
            message: error.message,
            retryable: true,
            category: 'provider',
          },
          eventType: 'research.run.status_changed',
          eventPayload: {
            id: runId,
            action: error.details?.action ?? 'test_model',
            selectedModelId: observed.modelSelectionSnapshot.selectedModelId,
          },
        })
        if (failed) {
          recordDeepResearchResumeOutcome('rejected', telemetryContext(failed))
          return commandResult(failed)
        }

        const current = requireRun(runId)
        const existing = activeCommandResult(current)
        return existing ?? commandResult(current)
      }
    }

    const trigger = options.trigger === 'auto_resume'
      ? 'auto_resume'
      : observed.status === 'failed'
        ? 'retry'
        : 'manual_resume'
    const commandKey = scopedCommandKey('resume', observed, options.commandKey)
    if (!claimDeepResearchCommand(runId, commandKey)) return commandResult(requireRun(runId))

    const resumed = researchRunRepo.transitionWithEventCas(runId, observed.stateVersion ?? 0, 'queued', {
      phase: 'queued',
      error: null,
      eventType: 'research.run.resumed',
      eventPayload: { id: runId },
    })
    if (!resumed) {
      const current = requireRun(runId)
      const existing = activeCommandResult(current)
      if (existing || current.status === 'cancelling' || current.status === 'cancelled') return existing ?? commandResult(current)
      recordDeepResearchResumeOutcome('rejected', telemetryContext(current))
      throw new ResearchDomainError('RESEARCH_NOT_RESUMABLE', 'Deep Research Run changed before it could resume: ' + runId, false)
    }

    const checkpoint = researchCheckpointRepo.findLatestCompatibleCursor(runId, commandFingerprint(observed))
    const attempt = researchAttemptRepo.create({
      runId,
      trigger,
      startCheckpointKey: checkpoint?.checkpointKey ?? (observed.resumePhase ? 'legacy:resume_from_planning' : null),
    })
    const resumeTelemetry = telemetryContext(resumed)
    recordDeepResearchResume(resumeTelemetry)
    recordDeepResearchResumeOutcome('succeeded', resumeTelemetry)
    if (checkpoint) recordDeepResearchCheckpointReuse(resumeTelemetry)
    dispatchStart(runId, commandKey)
    return commandResult(requireRun(runId), attempt, checkpoint)
  }

  async function cancelRun(runId: string, options: DeepResearchCommandOptions = {}): Promise<ResearchRunDto> {
    let observed = requireRun(runId)
    if (observed.status === 'cancelling' || observed.status === 'cancelled' || observed.cancellation) return commandResult(observed)
    if (!observed.capabilities?.canCancel) {
      throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run cannot be cancelled: ' + runId, false)
    }

    const commandKey = scopedCommandKey('cancel', observed, options.commandKey)
    if (!claimDeepResearchCommand(runId, commandKey)) return commandResult(requireRun(runId))

    // A state-version retry lets cancellation win against a concurrent non-terminal
    // state update, while completed/cancelled remains a truthful terminal response.
    for (let remaining = 1; remaining >= 0; remaining -= 1) {
      const cancelled = researchRunRepo.requestCancellationWithEventCas(runId, observed.stateVersion ?? 0, { reason: options.reason })
      if (cancelled) {
        // Durable state is the truth; this only makes the current process react
        // immediately instead of waiting for its next lease heartbeat.
        abortActiveDeepResearchExecution(runId)
        recordDeepResearchCancellation(telemetryContext(cancelled))
        return commandResult(cancelled)
      }
      observed = requireRun(runId)
      if (observed.status === 'cancelling' || observed.status === 'cancelled' || observed.cancellation) return commandResult(observed)
      if (!observed.capabilities?.canCancel) return commandResult(observed)
    }

    return commandResult(requireRun(runId))
  }

  return Object.freeze({
    async startResearch(input: StartResearchInput): Promise<ResearchRunDto> {
      const parsed = startResearchSchema.safeParse(input)
      if (!parsed.success) {
        throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid Deep Research input.', false)
      }

      const runtimeModel = await resolveResearchRuntimeModel({
        requestedModelId: parsed.data.model,
      })
      const run = researchRunRepo.create({
        input: parsed.data,
        budget: { ...getResearchBudget(parsed.data.depth) },
        modelSelectionSnapshot: runtimeModel.snapshot,
      })
      researchEventRepo.append({
        runId: run.id,
        type: 'research.run.created',
        phase: 'queued',
        payload: { id: run.id },
      })
      return startRun(run.id)
    },

    startRun,

    getRun(runId: string): ResearchRunDetailDto | undefined {
      const detail = researchRunRepo.getDetail(runId)
      return detail ? { ...detail, lifecycle: getLifecycle(detail) } : undefined
    },

    getRunDiagnostics(runId: string): ResearchRunDiagnosticsDto | undefined {
      // This service boundary deliberately aggregates all diagnostic dimensions in
      // one admin API request, without exposing source bodies or provider secrets.
      const detail = researchRunRepo.getDetail(runId)
      if (!detail) return undefined
      const attempts = researchAttemptRepo.listForRun(runId)
      return buildResearchRunDiagnostics({
        run: detail,
        questions: detail.questions,
        searchQueries: detail.searchQueries,
        sources: detail.sources,
        snapshots: detail.snapshots,
        evidence: detail.evidence,
        sections: detail.report?.sections ?? [],
        claims: detail.report?.claims ?? [],
        citations: detail.report?.citations ?? [],
        quality: detail.quality,
        candidateAssessments: researchSourceRepo.listCandidateAssessments(runId),
        events: detail.events,
        attempts,
        coverageAssessments: detail.coverageAssessments ?? [],
      })
    },

    listRuns(filter: ResearchRunFilter = {}): ResearchRunDto[] {
      return researchRunRepo.list(filter)
    },

    listAttemptHistory(runId: string, query: ResearchHistoryQuery = {}): ResearchHistoryPageDto<ResearchRunAttemptSummaryDto> {
      requireRun(runId)
      return pageHistory(researchAttemptRepo.listForRun(runId).map(attemptSummary), query, (item) => String(item.ordinal))
    },

    listCheckpointHistory(runId: string, query: ResearchHistoryQuery = {}): ResearchHistoryPageDto<ResearchRunCheckpointSummaryDto> {
      requireRun(runId)
      return pageHistory(researchCheckpointRepo.list(runId).map(checkpointSummary), query, (item) => String(item.sequence))
    },

    listIterationHistory(runId: string, query: ResearchHistoryQuery = {}): ResearchHistoryPageDto<ResearchIterationDto> {
      requireRun(runId)
      return pageHistory(researchIterationRepo.list(runId).slice().reverse(), query, (item) => String(item.ordinal))
    },

    listAssessmentHistory(runId: string, query: ResearchHistoryQuery = {}): ResearchHistoryPageDto<ResearchCoverageAssessmentDto> {
      requireRun(runId)
      return pageHistory(researchCoverageAssessmentRepo.list(runId), query, (item) => item.id)
    },

    listEvents(runId: string, afterSequence = 0): ResearchEventDto[] {
      requireRun(runId)
      return researchEventRepo.list(runId, afterSequence)
    },

    getArtifact(runId: string, artifactId: string): ResearchArtifactContent | undefined {
      const stored = researchReportRepo.getStoredArtifact(runId, artifactId)
      if (!stored || !fs.existsSync(stored.storagePath)) return undefined
      return { artifact: stored.artifact, content: fs.readFileSync(stored.storagePath, 'utf8') }
    },

    subscribeToEvents(runId: string, listener: (event: ResearchEventDto) => void): () => void {
      requireRun(runId)
      return subscribeToResearchEvents(runId, listener)
    },

    cancelRun,

    resumeRun,

    async answerClarification(runId: string, input: ResearchClarificationInput): Promise<ResearchRunDto> {
      const parsed = clarificationSchema.safeParse(input)
      if (!parsed.success) {
        throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid clarification answer.', false)
      }

      const run = requireRun(runId)
      if (run.status !== 'awaiting_input') {
        throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is not awaiting clarification: ' + runId, false)
      }

      researchEventRepo.append({
        runId,
        type: 'research.clarification.answered',
        phase: run.phase,
        payload: {
          clarificationId: parsed.data.clarificationId,
          answer: parsed.data.answer,
        },
      })
      schedule(() => runtime.resume(runId, parsed.data))
      return researchRunRepo.get(runId)!
    },

    async recoverInterruptedRuns(now = Date.now()): Promise<DeepResearchRecoveryResult> {
      const recovery = createDeepResearchRecoveryCoordinator({
        attemptRepo: researchAttemptRepo,
        getWorkflowRunState: runtime.getWorkflowRunState?.bind(runtime),
        // Recovery retains its persistent dispatch guard; the actual Run command
        // always enters through this same resume service path.
        enqueueResume: async (runId, commandKey) => resumeRun(runId, { trigger: 'auto_resume', commandKey }),
      })
      return recovery.recoverInterruptedRuns(now)
    },
  })
}
