import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeepResearchExecutor } from './executor'
import { createDeepResearchService } from './deep-research.service'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../db/repositories/deepresearch/research-run.repo')
  const { researchAttemptRepo } = await import('../db/repositories/deepresearch/research-attempt.repo')
  const { researchEventRepo } = await import('../db/repositories/deepresearch/research-event.repo')
  return { client, researchRunRepo, researchAttemptRepo, researchEventRepo }
}

function createRun(researchRunRepo: Awaited<ReturnType<typeof loadTestContext>>['researchRunRepo']) {
  return researchRunRepo.create({
    input: {
      topic: 'Attempt-aware execution',
      profile: 'market',
      depth: 'deep',
      objective: 'Verify executor ownership.',
    },
    budget: {
      maxQuestions: 1,
      maxIterations: 1,
      maxSearchQueries: 1,
      maxNormalizedSources: 1,
      maxFetchedSources: 1,
      searchConcurrency: 1,
      fetchConcurrency: 1,
      maxDurationMs: 60_000,
    },
  })
}

describe('Deep Research attempt-aware executor', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-executor-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.useRealTimers()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('allows one executor to claim an attempt and gives the workflow an owned execution context', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const { attempt } = researchAttemptRepo.createWithInitialCheckpoint({
      runId: run.id,
      trigger: 'initial',
      createdAt: 1_000,
      checkpoint: {
        checkpointKey: 'run:queued',
        phase: 'queued',
        status: 'completed',
        resumeCursor: { version: 1, nextPhase: 'planning', iteration: 0 },
        inputFingerprint: 'executor-test',
        replayPolicy: 'reuse',
      },
    })
    let release!: () => void
    const started = new Promise<void>((resolve) => { release = resolve })
    const runtime = {
      start: vi.fn(async (context: unknown) => {
        expect(context).toMatchObject({
          runId: run.id,
          attemptId: attempt.id,
          ownershipToken: expect.any(String),
          resumeCursor: { version: 1, nextPhase: 'planning', iteration: 0 },
        })
        expect((context as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
        await started
      }),
      resume: vi.fn(async () => undefined),
    }
    const first = createDeepResearchExecutor({ runtime: runtime as any, executorId: 'executor-a', now: () => 1_000 } as any)
    const second = createDeepResearchExecutor({ runtime: runtime as any, executorId: 'executor-b', now: () => 1_000 } as any)

    const firstExecution = first.start(run.id)
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1))
    await expect(second.start(run.id)).resolves.toBe(false)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ executorId: 'executor-a', status: 'running' })

    release()
    await expect(firstExecution).resolves.toBe(true)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'succeeded', executorId: null })
  })

  it('renews an attempt lease through the injected heartbeat clock', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    let heartbeat: (() => void) | undefined
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const executor = createDeepResearchExecutor({
      executorId: 'heartbeat-worker',
      leaseMs: 100,
      leaseRenewalMs: 10,
      now: () => 1_050,
      setInterval: (callback: () => void) => {
        heartbeat = callback
        return 1 as any
      },
      clearInterval: () => undefined,
      runtime: { start: async () => blocked, resume: async () => undefined },
    } as any)

    const execution = executor.start(run.id)
    await vi.waitFor(() => expect(heartbeat).toBeTypeOf('function'))
    heartbeat!()
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ heartbeatAt: 1_050, leaseExpiresAt: 1_150, executorId: 'heartbeat-worker' })
    release()
    await execution
  })

  it('releases a suspended workflow lease without ending its active Attempt', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    const runtime = {
      start: vi.fn(async () => ({ status: 'suspended' })),
      resume: vi.fn(async () => undefined),
    }
    const executor = createDeepResearchExecutor({ runtime, executorId: 'suspension-worker', now: () => 1_000 })

    await expect(executor.start(run.id)).resolves.toBe(true)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({
      status: 'running',
      executorId: null,
      leaseExpiresAt: null,
    })

    await expect(executor.resume(run.id, { clarificationId: 'scope', answer: 'United States' })).resolves.toBe(true)
    expect(runtime.resume).toHaveBeenCalledWith(expect.objectContaining({ attemptId: attempt.id }), {
      clarificationId: 'scope',
      answer: 'United States',
    })
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'succeeded', executorId: null })
  })

  it('projects a cancellation requested during a suspended workflow result', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    const executor = createDeepResearchExecutor({
      executorId: 'cancelled-suspension-worker',
      now: () => 1_000,
      runtime: {
        start: async () => {
          const current = researchRunRepo.get(run.id)!
          researchRunRepo.requestCancellationWithEventCas(run.id, current.stateVersion!, { reason: 'user-cancelled' })
          return { status: 'suspended' }
        },
        resume: async () => undefined,
      },
    } as any)

    await expect(executor.start(run.id)).resolves.toBe(true)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'cancelled', executorId: null })
    expect(researchRunRepo.get(run.id)).toMatchObject({ status: 'cancelled' })
  })
  it('rejects old executor completion after a replacement ownership token takes over', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    expect((researchAttemptRepo.acquireLease as any)(attempt.id, 'executor-a', 'token-a', 100, 1_000)).toBe(true)
    expect((researchAttemptRepo.acquireLease as any)(attempt.id, 'executor-b', 'token-b', 100, 1_101)).toBe(true)

    expect((researchAttemptRepo.finishOwned as any)({
      attemptId: attempt.id,
      executorId: 'executor-a',
      ownershipToken: 'token-a',
      status: 'failed',
      now: 1_102,
    })).toBeNull()
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ executorId: 'executor-b', status: 'running' })
  })

  it('rejects missing or mismatched ownership tokens before a terminal attempt write', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    expect((researchAttemptRepo.acquireLease as any)(attempt.id, 'executor-a', 'token-a', 100, 1_000)).toBe(true)

    for (const ownershipToken of ['', 'token-b']) {
      expect((researchAttemptRepo.finishOwned as any)({
        attemptId: attempt.id,
        executorId: 'executor-a',
        ownershipToken,
        status: 'succeeded',
        now: 1_001,
      })).toBeNull()
    }
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'running', executorId: 'executor-a' })
  })

  it('aborts the active owner immediately and lets cancellation win a concurrent successful return', async () => {
    const { researchRunRepo, researchAttemptRepo, researchEventRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    let release!: () => void
    const returned = new Promise<void>((resolve) => { release = resolve })
    let activeSignal!: AbortSignal
    const runtime = {
      start: vi.fn(async ({ signal }: { signal: AbortSignal }) => {
        activeSignal = signal
        await returned
      }),
      resume: vi.fn(async () => undefined),
    }
    const executor = createDeepResearchExecutor({ runtime, executorId: 'cancel-race-worker', now: () => 1_000 } as any)
    const service = createDeepResearchService({ runtime: executor })

    const execution = executor.start(run.id)
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1))
    expect(activeSignal.aborted).toBe(false)

    const cancelling = await service.cancelRun(run.id, { reason: 'race-test' })
    expect(cancelling).toMatchObject({ status: 'cancelling', cancellation: { reason: 'race-test' } })
    expect(activeSignal.aborted).toBe(true)

    release()
    await expect(execution).resolves.toBe(true)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'cancelled', executorId: null })
    expect(researchRunRepo.get(run.id)).toMatchObject({ status: 'cancelled' })
    const terminalEvents = researchEventRepo.list(run.id).filter((event) => ['research.run.cancelled', 'research.run.completed', 'research.run.failed'].includes(event.type))
    expect(terminalEvents.map((event) => event.type)).toEqual(['research.run.cancelled'])
  })

  it('persists cancellation and retryable failure classifications on its owned attempt', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const failureRun = createRun(researchRunRepo)
    const failureAttempt = researchAttemptRepo.create({ runId: failureRun.id, trigger: 'initial', createdAt: 1_000 })
    const failed = createDeepResearchExecutor({
      executorId: 'failure-worker',
      now: () => 1_000,
      runtime: { start: async () => { const error = new Error('provider timed out'); ;(error as any).code = 'ETIMEDOUT'; throw error }, resume: async () => undefined },
    } as any)

    await expect(failed.start(failureRun.id)).resolves.toBe(true)
    expect(researchAttemptRepo.get(failureAttempt.id)).toMatchObject({
      status: 'failed',
      error: { code: 'RESEARCH_PROVIDER_TIMEOUT', retryable: true, category: 'timeout' },
    })

    const cancelledRun = createRun(researchRunRepo)
    const cancelledAttempt = researchAttemptRepo.create({ runId: cancelledRun.id, trigger: 'initial', createdAt: 1_000 })
    const cancelled = createDeepResearchExecutor({
      executorId: 'cancelled-worker',
      now: () => 1_000,
      runtime: { start: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error }, resume: async () => undefined },
    } as any)

    await expect(cancelled.start(cancelledRun.id)).resolves.toBe(true)
    expect(researchAttemptRepo.get(cancelledAttempt.id)).toMatchObject({ status: 'cancelled', error: null })
  })
  it('treats a failed Mastra workflow result as an attempt failure instead of success', async () => {
    const { researchRunRepo, researchAttemptRepo } = await loadTestContext()
    const run = createRun(researchRunRepo)
    const attempt = researchAttemptRepo.create({ runId: run.id, trigger: 'initial', createdAt: 1_000 })
    const timeout = Object.assign(new Error('RESEARCH_MODEL_TIMEOUT: brief_planning exceeded its configured timeout.'), {
      code: 'RESEARCH_MODEL_TIMEOUT',
    })
    const executor = createDeepResearchExecutor({
      executorId: 'workflow-failure-worker',
      now: () => 1_000,
      runtime: {
        start: async () => ({ status: 'failed', error: timeout }),
        resume: async () => undefined,
      },
    } as any)

    await expect(executor.start(run.id)).resolves.toBe(true)
    expect(researchAttemptRepo.get(attempt.id)).toMatchObject({
      status: 'failed',
      error: { code: 'RESEARCH_PROVIDER_TIMEOUT', retryable: true, category: 'timeout' },
    })
  })

})
