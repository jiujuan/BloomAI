import fs from 'node:fs'
import type {
  ResearchArtifactContent,
  ResearchAttemptTrigger,
  ResearchCheckpointCursorDto,
  ResearchClarificationInput,
  ResearchEventDto,
  ResearchRunAttemptDto,
  ResearchRunCheckpointDto,
  ResearchRunDetailDto,
  ResearchRunDto,
  ResearchRunFilter,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { researchAttemptRepo } from '../db/repositories/deepresearch/research-attempt.repo'
import { researchCheckpointRepo } from '../db/repositories/deepresearch/research-checkpoint.repo'
import { researchEventRepo } from '../db/repositories/deepresearch/research-event.repo'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import { researchReportRepo } from '../db/repositories/deepresearch/research-report.repo'
import { subscribeToResearchEvents } from './research-event-publisher'
import { claimDeepResearchCommand, deepResearchCommandKey, markDeepResearchCommandDispatched } from './commands'
import { getResearchBudget } from './domain/budgets'
import { createCheckpointCursor, createCheckpointReplayFingerprint } from './domain/checkpoint-replay'
import { ResearchDomainError } from './domain/errors'
import { createDeepResearchRecoveryCoordinator, type DeepResearchRecoveryResult, type DeepResearchWorkflowRunState } from './recovery'
import { recordDeepResearchCancellation, recordDeepResearchResume, type DeepResearchTelemetryContext } from '../telemetry/metrics'

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
      throw new ResearchDomainError('RESEARCH_CANCELLED', 'Cancelled Deep Research Runs cannot be resumed: ' + runId, false)
    }
    if (observed.status === 'cancelling') {
      throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is cancelling: ' + runId, false)
    }
    const canResume = observed.status === 'interrupted' || (observed.status === 'failed' && observed.error?.retryable === true)
    if (!canResume) {
      throw new ResearchDomainError('RESEARCH_NOT_RESUMABLE', 'Deep Research Run is not resumable: ' + runId, false)
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
      throw new ResearchDomainError('RESEARCH_NOT_RESUMABLE', 'Deep Research Run changed before it could resume: ' + runId, false)
    }

    const checkpoint = researchCheckpointRepo.findLatestCompatibleCursor(runId, commandFingerprint(observed))
    const attempt = researchAttemptRepo.create({
      runId,
      trigger,
      startCheckpointKey: checkpoint?.checkpointKey ?? (observed.resumePhase ? 'legacy:resume_from_planning' : null),
    })
    recordDeepResearchResume(telemetryContext(resumed))
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

      const run = researchRunRepo.create({
        input: parsed.data,
        budget: { ...getResearchBudget(parsed.data.depth) },
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
      return researchRunRepo.getDetail(runId)
    },

    listRuns(filter: ResearchRunFilter = {}): ResearchRunDto[] {
      return researchRunRepo.list(filter)
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
        getWorkflowRunState: runtime.getWorkflowRunState?.bind(runtime),
        // Recovery retains its persistent dispatch guard; the actual Run command
        // always enters through this same resume service path.
        enqueueResume: async (runId) => resumeRun(runId, { trigger: 'auto_resume' }),
      })
      return recovery.recoverInterruptedRuns(now)
    },
  })
}