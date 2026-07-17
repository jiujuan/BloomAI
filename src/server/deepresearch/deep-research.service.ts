import fs from 'node:fs'
import type { ResearchArtifactContent, ResearchClarificationInput, ResearchEventDto, ResearchRunDetailDto, ResearchRunDto, ResearchRunFilter, StartResearchInput } from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { researchEventRepo } from '../db/repositories/deepresearch/research-event.repo'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import { researchReportRepo } from '../db/repositories/deepresearch/research-report.repo'
import { subscribeToResearchEvents } from './research-event-publisher'
import { getResearchBudget } from './domain/budgets'
import { ResearchDomainError } from './domain/errors'
import { projectResearchRunCapabilities } from './domain/state-machine'
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

export function createDeepResearchService({ runtime }: CreateDeepResearchServiceOptions) {
  async function enqueueResume(runId: string, commandKey?: string): Promise<ResearchRunDto> {
    const run = requireRun(runId)
    if (run.status === 'queued') {
      if (commandKey) schedule(() => runtime.start(runId))
      return run
    }
    const resumed = researchRunRepo.transitionWithEvent(runId, 'queued', {
      phase: 'queued',
      error: null,
    })
    recordDeepResearchResume(telemetryContext(resumed))
    schedule(() => runtime.start(runId))
    return resumed
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
      schedule(() => runtime.start(run.id))
      return run
    },

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

    async cancelRun(runId: string): Promise<ResearchRunDto> {
      requireRun(runId)
      const cancelling = researchRunRepo.transitionWithEvent(runId, 'cancelling', { phase: 'cancelling' })
      recordDeepResearchCancellation(telemetryContext(cancelling))
      return cancelling
    },

    async resumeRun(runId: string): Promise<ResearchRunDto> {
      const run = requireRun(runId)
      if (!projectResearchRunCapabilities({ status: run.status, error: run.error }).canResume) {
        throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is not resumable: ' + runId, false)
      }

      return enqueueResume(runId)
    },

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
        enqueueResume: async (runId, commandKey) => enqueueResume(runId, commandKey),
      })
      return recovery.recoverInterruptedRuns(now)
    },
  })
}
