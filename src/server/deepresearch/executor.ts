import { v4 as uuidv4 } from 'uuid'
import type { ResearchClarificationInput, ResearchRunErrorDto } from '@shared/deepresearch/contracts'
import { isResearchDomainError } from './domain/errors'
import { researchRunRepo } from '../db/repositories/deepresearch/research-run.repo'

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_LEASE_RENEWAL_MS = 10_000

export interface DeepResearchRuntimeAdapter {
  start(runId: string): Promise<void>
  resume(runId: string, resumeData: ResearchClarificationInput): Promise<void>
}

export interface DeepResearchExecutor {
  start(runId: string): Promise<boolean>
  resume(runId: string, resumeData: ResearchClarificationInput): Promise<boolean>
  readonly executorId: string
}

export interface CreateDeepResearchExecutorOptions {
  runtime: DeepResearchRuntimeAdapter
  executorId?: string
  leaseMs?: number
  leaseRenewalMs?: number
}

function toResearchRunError(error: unknown): ResearchRunErrorDto {
  if (isResearchDomainError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }

  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown } | undefined
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'RESEARCH_EXECUTION_FAILED',
    message: typeof candidate?.message === 'string' ? candidate.message : 'Deep Research execution failed.',
    retryable: candidate?.retryable === true,
  }
}

export function createDeepResearchExecutor(options: CreateDeepResearchExecutorOptions): DeepResearchExecutor {
  const executorId = options.executorId ?? 'deepresearch-' + uuidv4()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const leaseRenewalMs = options.leaseRenewalMs ?? DEFAULT_LEASE_RENEWAL_MS

  async function execute(runId: string, invoke: () => Promise<void>): Promise<boolean> {
    if (!researchRunRepo.acquireLease(runId, executorId, leaseMs)) {
      return false
    }

    const renewalTimer = setInterval(() => {
      researchRunRepo.acquireLease(runId, executorId, leaseMs)
    }, leaseRenewalMs)

    try {
      await invoke()
    } catch (error) {
      const current = researchRunRepo.get(runId)
      if (current && current.status !== 'completed' && current.status !== 'completed_with_limitations' && current.status !== 'cancelled') {
        const runError = toResearchRunError(error)
        researchRunRepo.transitionWithEvent(runId, 'failed', {
          phase: current.phase,
          error: runError,
          eventType: 'research.run.failed',
          eventPayload: { errorCode: runError.code, retryable: runError.retryable },
        })
      }
    } finally {
      clearInterval(renewalTimer)
      researchRunRepo.releaseLease(runId, executorId)
    }

    return true
  }

  return Object.freeze({
    executorId,
    start(runId: string): Promise<boolean> {
      return execute(runId, () => options.runtime.start(runId))
    },
    resume(runId: string, resumeData: ResearchClarificationInput): Promise<boolean> {
      return execute(runId, () => options.runtime.resume(runId, resumeData))
    },
  })
}
