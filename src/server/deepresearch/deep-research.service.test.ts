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

  it('inspects Mastra workflow state through the executor during recovery', async () => {
    const { researchRunRepo } = await loadTestContext()
    const getWorkflowRunState = vi.fn(async () => ({ status: 'suspended' as const }))
    const executor = createDeepResearchExecutor({
      runtime: {
        start: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        getWorkflowRunState,
      },
      executorId: 'recovery-executor-test',
    })
    const service = createDeepResearchService({ runtime: executor })
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.setWorkflowRunId(run.id, 'workflow-through-executor')
    researchRunRepo.transitionWithEvent(run.id, 'planning')
    researchRunRepo.transitionWithEvent(run.id, 'researching')
    expect(researchRunRepo.acquireLease(run.id, 'expired-worker', 1_000, 1_000)).toBe(true)

    await service.recoverInterruptedRuns(2_001)

    expect(getWorkflowRunState).toHaveBeenCalledWith('workflow-through-executor')
    expect(researchRunRepo.get(run.id)).toMatchObject({ status: 'interrupted' })
  })

  it('persists auto-resume recovery command keys across coordinator instances', async () => {
    const { client, researchRunRepo } = await loadTestContext()
    const { createDeepResearchRecoveryCoordinator } = await import('./recovery')
    const { research_recovery_commands } = await import('../db/schema')
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(run.id, 'interrupted', { resumePhase: 'researching' })
    const enqueueResume = vi.fn(async () => undefined)

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
    }).recoverInterruptedRuns(2_001)
    await createDeepResearchRecoveryCoordinator({
      researchRunRepo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
    }).recoverInterruptedRuns(2_001)

    expect(researchRunRepo.get(run.id)).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(client.getOrmDb().select().from(research_recovery_commands).all()).toMatchObject([
      { run_id: run.id, command_key: 'deepresearch:auto-resume:v1:' + run.id },
    ])
  })

  it('retries durable recovery commands left claimed before dispatch and re-dispatches queued runs', async () => {
    const { client, researchRunRepo } = await loadTestContext()
    const { research_recovery_commands } = await import('../db/schema')
    process.env.DEEP_RESEARCH_AUTO_RESUME = 'true'
    const now = Date.now()
    const interrupted = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(interrupted.id, 'interrupted', { resumePhase: 'researching' })
    const queued = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    client.getOrmDb().insert(research_recovery_commands).values([
      { id: 'claimed-before-dispatch', run_id: interrupted.id, command_key: 'deepresearch:auto-resume:v1:' + interrupted.id, status: 'claimed', created_at: now, updated_at: now },
      { id: 'queued-before-runtime', run_id: queued.id, command_key: 'deepresearch:auto-resume:v1:' + queued.id, status: 'claimed', created_at: now, updated_at: now },
    ]).run()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = createDeepResearchService({ runtime })

    await service.recoverInterruptedRuns(now + 1)

    expect(researchRunRepo.get(interrupted.id)).toMatchObject({ status: 'queued' })
    expect(runtime.start).toHaveBeenCalledWith(interrupted.id)
    expect(runtime.start).toHaveBeenCalledWith(queued.id)
    expect(client.getOrmDb().select().from(research_recovery_commands).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: interrupted.id, command_key: 'deepresearch:auto-resume:v1:' + interrupted.id, status: 'dispatched' }),
      expect.objectContaining({ run_id: queued.id, command_key: 'deepresearch:auto-resume:v1:' + queued.id, status: 'dispatched' }),
    ]))
  })

  it('reclaims fresh dispatching recovery commands on startup', async () => {
    const { client, researchRunRepo } = await loadTestContext()
    const { research_recovery_commands } = await import('../db/schema')
    process.env.DEEP_RESEARCH_AUTO_RESUME = 'true'
    const now = Date.now()
    const interrupted = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(interrupted.id, 'interrupted', { resumePhase: 'researching' })
    client.getOrmDb().insert(research_recovery_commands).values({
      id: 'fresh-dispatching-before-restart',
      run_id: interrupted.id,
      command_key: 'deepresearch:auto-resume:v1:' + interrupted.id,
      status: 'dispatching',
      created_at: now,
      updated_at: now,
    }).run()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = createDeepResearchService({ runtime })

    await service.recoverInterruptedRuns(now + 1)

    expect(researchRunRepo.get(interrupted.id)).toMatchObject({ status: 'queued' })
    expect(runtime.start).toHaveBeenCalledWith(interrupted.id)
    expect(client.getOrmDb().select().from(research_recovery_commands).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: interrupted.id, command_key: 'deepresearch:auto-resume:v1:' + interrupted.id, status: 'dispatched' }),
    ]))
  })

  it('uses durable dispatch token ownership when coordinators concurrently reclaim dispatching commands', async () => {
    const { client, researchRunRepo } = await loadTestContext()
    const { createDeepResearchRecoveryCoordinator } = await import('./recovery')
    const { research_recovery_commands } = await import('../db/schema')
    const now = Date.now()
    const queued = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    client.getOrmDb().insert(research_recovery_commands).values({
      id: 'concurrent-reclaim',
      run_id: queued.id,
      command_key: 'deepresearch:auto-resume:v1:' + queued.id,
      status: 'dispatching',
      dispatch_token: 'previous-process-token',
      created_at: now,
      updated_at: now,
    }).run()
    const enqueueResume = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const options = {
      researchRunRepo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
    }

    await Promise.all([
      createDeepResearchRecoveryCoordinator(options).recoverInterruptedRuns(now + 1),
      createDeepResearchRecoveryCoordinator(options).recoverInterruptedRuns(now + 1),
    ])

    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(client.getOrmDb().select().from(research_recovery_commands).all()).toMatchObject([{
      run_id: queued.id,
      command_key: 'deepresearch:auto-resume:v1:' + queued.id,
      status: 'dispatched',
      dispatch_token: null,
    }])
  })

  it('requests cancellation, resumes interrupted or retryable failed runs, and clears retryable errors', async () => {
    const { researchRunRepo } = await loadTestContext()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = createDeepResearchService({ runtime })
    const run = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })

    await expect(service.cancelRun(run.id)).resolves.toMatchObject({ status: 'cancelling' })
    await expect(service.resumeRun(run.id)).rejects.toMatchObject({ code: 'RESEARCH_NOT_RUNNABLE' })

    const interruptedRun = researchRunRepo.create({ input: validInput, budget: { maxQuestions: 1, maxIterations: 1, maxSearchQueries: 1, maxNormalizedSources: 1, maxFetchedSources: 1, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 1_000 } })
    researchRunRepo.transitionWithEvent(interruptedRun.id, 'interrupted', { resumePhase: 'queued' })
    const resumed = await service.resumeRun(interruptedRun.id)

    expect(resumed).toMatchObject({ status: 'queued', error: null })
    expect(runtime.start).toHaveBeenCalledWith(interruptedRun.id)

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
