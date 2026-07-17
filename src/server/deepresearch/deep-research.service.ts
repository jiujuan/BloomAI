import fs from 'node:fs'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchArtifactContent, ResearchClarificationInput, ResearchEventDto, ResearchRunDetailDto, ResearchRunDto, ResearchRunFilter, ResearchRunStatus, StartResearchInput } from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { researchEventRepo } from '../db/repositories/deepresearch/research-event.repo'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'
import { researchReportRepo } from '../db/repositories/deepresearch/research-report.repo'
import { subscribeToResearchEvents } from './research-event-publisher'
import { getResearchBudget } from './domain/budgets'
import { ResearchDomainError } from './domain/errors'

export interface DeepResearchScheduler {
  start(runId: string): Promise<unknown>
  resume(runId: string, resumeData: ResearchClarificationInput): Promise<unknown>
}

export interface CreateDeepResearchServiceOptions {
  runtime: DeepResearchScheduler
}

const RECOVERY_LEASE_MS = 30_000
const RECOVERABLE_ACTIVE_STATUSES: ResearchRunStatus[] = ['planning', 'researching', 'synthesizing', 'verifying']

function requireRun(runId: string): ResearchRunDto {
  const run = researchRunRepo.get(runId)
  if (run) return run

  throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run not found: ' + runId, false)
}

function schedule(operation: () => Promise<unknown>): void {
  void operation().catch(() => undefined)
}

export function createDeepResearchService({ runtime }: CreateDeepResearchServiceOptions) {
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
      return researchRunRepo.transitionWithEvent(runId, 'cancelling', { phase: 'cancelling' })
    },

    async resumeRun(runId: string): Promise<ResearchRunDto> {
      const run = requireRun(runId)
      const canResume = run.status === 'interrupted' || (run.status === 'failed' && run.error?.retryable === true)
      if (!canResume) {
        throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run is not resumable: ' + runId, false)
      }

      const resumed = researchRunRepo.transitionWithEvent(runId, 'queued', {
        phase: 'queued',
        error: null,
      })
      schedule(() => runtime.start(runId))
      return resumed
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

    async recoverInterruptedRuns(now = Date.now()): Promise<ResearchRunDto[]> {
      const recoveryExecutorId = 'deepresearch-recovery-' + uuidv4()
      const interrupted: ResearchRunDto[] = []

      for (const run of researchRunRepo.list({ statuses: RECOVERABLE_ACTIVE_STATUSES })) {
        if (!researchRunRepo.acquireLease(run.id, recoveryExecutorId, RECOVERY_LEASE_MS, now)) continue

        try {
          interrupted.push(researchRunRepo.transitionWithEvent(run.id, 'interrupted', {
            phase: 'interrupted',
            resumePhase: run.phase,
          }))
        } finally {
          researchRunRepo.releaseLease(run.id, recoveryExecutorId)
        }
      }

      return interrupted
    },
  })
}
