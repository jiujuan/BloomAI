import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartResearchInput } from '@shared/deepresearch/contracts'
import { createDeepResearchExecutor } from './executor'
import { createDeepResearchService } from './deep-research.service'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

const validInput: StartResearchInput = {
  topic: 'Enterprise AI assistant market',
  profile: 'market',
  depth: 'deep',
  objective: 'Compare the market and leading vendors.',
}

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../db/repositories/deepresearch/research-run.repo')
  const { researchEventRepo } = await import('../db/repositories/deepresearch/research-event.repo')

  return { client, researchRunRepo, researchEventRepo }
}

describe('Deep Research service and executor', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-service-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('persists a queued run and its creation event before scheduling it', async () => {
    const { researchRunRepo, researchEventRepo } = await loadTestContext()
    const runtime = {
      start: vi.fn(async (runId: string) => {
        expect(researchRunRepo.get(runId)).toMatchObject({ id: runId, status: 'queued' })
        expect(researchEventRepo.list(runId)).toMatchObject([
          expect.objectContaining({ type: 'research.run.created' }),
        ])
      }),
      resume: vi.fn(async () => undefined),
    }
    const service = createDeepResearchService({ runtime })

    const run = await service.startResearch(validInput)

    expect(run.status).toBe('queued')
    expect(runtime.start).toHaveBeenCalledWith(run.id)
  })

  it('marks stale active runs interrupted and preserves their resume phase during recovery', async () => {
    const { researchRunRepo } = await loadTestContext()
    const service = createDeepResearchService({ runtime: { start: vi.fn(), resume: vi.fn() } })
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(run.id, 'planning')
    researchRunRepo.transitionWithEvent(run.id, 'researching')
    expect(researchRunRepo.acquireLease(run.id, 'expired-worker', 1_000, 1_000)).toBe(true)

    await service.recoverInterruptedRuns(2_001)

    expect(service.getRun(run.id)).toMatchObject({
      status: 'interrupted',
      phase: 'interrupted',
      resumePhase: 'researching',
    })
  })

  it('requests cancellation, resumes interrupted or retryable failed runs, and clears retryable errors', async () => {
    const { researchRunRepo } = await loadTestContext()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = createDeepResearchService({ runtime })
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })

    await expect(service.cancelRun(run.id)).resolves.toMatchObject({ status: 'cancelling' })
    researchRunRepo.transitionWithEvent(run.id, 'interrupted', { resumePhase: 'queued' })
    const resumed = await service.resumeRun(run.id)

    expect(resumed).toMatchObject({ status: 'queued', error: null })
    expect(runtime.start).toHaveBeenCalledWith(run.id)

    const retryableRun = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(retryableRun.id, 'failed', {
      error: { code: 'PROVIDER_TIMEOUT', message: 'Timed out.', retryable: true },
    })
    await expect(service.resumeRun(retryableRun.id)).resolves.toMatchObject({ status: 'queued', error: null })
  })

  it('persists a clarification answer before resuming the runtime', async () => {
    const { researchRunRepo, researchEventRepo } = await loadTestContext()
    const runtime = {
      start: vi.fn(async () => undefined),
      resume: vi.fn(async (runId: string) => {
        expect(researchEventRepo.list(runId)).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'research.clarification.answered',
            payload: { clarificationId: 'scope', answer: 'Focus on the US market.' },
          }),
        ]))
      }),
    }
    const service = createDeepResearchService({ runtime })
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(run.id, 'planning')
    researchRunRepo.transitionWithEvent(run.id, 'awaiting_input')

    await service.answerClarification(run.id, {
      clarificationId: 'scope',
      answer: 'Focus on the US market.',
    })

    expect(runtime.resume).toHaveBeenCalledWith(run.id, {
      clarificationId: 'scope',
      answer: 'Focus on the US market.',
    })
  })

  it('leases execution, releases the lease, and preserves retryable runtime failures', async () => {
    const { researchRunRepo } = await loadTestContext()
    const successfulRun = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    const successRuntime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const executor = createDeepResearchExecutor({ runtime: successRuntime, executorId: 'executor-test' })

    await expect(executor.start(successfulRun.id)).resolves.toBe(true)
    expect(successRuntime.start).toHaveBeenCalledWith(successfulRun.id)
    expect(researchRunRepo.acquireLease(successfulRun.id, 'other-executor', 1_000, 2_000)).toBe(true)

    const failedRun = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    const retryableError = Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT', retryable: true })
    const failureRuntime = { start: vi.fn(async () => { throw retryableError }), resume: vi.fn(async () => undefined) }

    await expect(createDeepResearchExecutor({ runtime: failureRuntime, executorId: 'failure-test' }).start(failedRun.id)).resolves.toBe(true)
    expect(researchRunRepo.get(failedRun.id)).toMatchObject({
      status: 'failed',
      error: { code: 'PROVIDER_TIMEOUT', retryable: true },
    })
  })
})
