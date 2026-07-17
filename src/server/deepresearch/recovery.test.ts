import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto, ResearchRunFilter, ResearchRunStatus } from '@shared/deepresearch/contracts'
import { createDeepResearchRecoveryCoordinator } from './recovery'
import { deepResearchTraceAttributes, traceDeepResearchPhase } from '../telemetry/metrics'

const budget = {
  maxQuestions: 1,
  maxIterations: 1,
  maxSearchQueries: 1,
  maxNormalizedSources: 1,
  maxFetchedSources: 1,
  searchConcurrency: 1,
  fetchConcurrency: 1,
  maxDurationMs: 1_000,
}

function run(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: overrides.id ?? 'run-1',
    sessionId: null,
    topic: 'Private topic must never be emitted in telemetry',
    profile: 'general',
    depth: 'standard',
    status: overrides.status ?? 'researching',
    phase: overrides.phase ?? 'researching',
    progress: 25,
    brief: null,
    workflowRunId: overrides.workflowRunId ?? 'workflow-1',
    budget,
    usage: {
      questions: 0,
      iterations: 0,
      searchQueries: 0,
      normalizedSources: 0,
      fetchedSources: 0,
      tokens: 0,
      providerCostUsd: 0,
      startedAt: null,
      deadlineAt: null,
    },
    quality: null,
    reportArtifactId: null,
    resumePhase: overrides.resumePhase ?? null,
    error: overrides.error ?? null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    ...overrides,
  }
}

class MemoryResearchRunRepo {
  readonly runs = new Map<string, ResearchRunDto>()
  readonly leases = new Map<string, { executorId: string; expiresAt: number }>()
  readonly transitions: Array<{ runId: string; from: ResearchRunStatus; to: ResearchRunStatus }> = []

  constructor(runs: ResearchRunDto[]) {
    for (const current of runs) this.runs.set(current.id, current)
  }

  list(filter: ResearchRunFilter = {}): ResearchRunDto[] {
    return [...this.runs.values()].filter((current) => !filter.statuses || filter.statuses.includes(current.status))
  }

  get(id: string): ResearchRunDto | undefined {
    return this.runs.get(id)
  }

  getRecoverySnapshot(id: string) {
    const current = this.runs.get(id)
    if (!current) return undefined
    const lease = this.leases.get(id)
    return {
      run: current,
      executorId: lease?.executorId ?? null,
      leaseExpiresAt: lease?.expiresAt ?? null,
      workflowRunId: current.workflowRunId,
    }
  }

  acquireLease(id: string, executorId: string, leaseMs: number, now: number): boolean {
    const lease = this.leases.get(id)
    if (lease && lease.expiresAt > now && lease.executorId !== executorId) return false
    this.leases.set(id, { executorId, expiresAt: now + leaseMs })
    return true
  }

  releaseLease(id: string, executorId: string): boolean {
    const lease = this.leases.get(id)
    if (!lease || lease.executorId !== executorId) return false
    this.leases.delete(id)
    return true
  }

  transitionWithEvent(id: string, to: ResearchRunStatus, options: { phase?: string; resumePhase?: string | null } = {}): ResearchRunDto {
    const current = this.runs.get(id)
    if (!current) throw new Error('missing run')
    const next = { ...current, status: to, phase: options.phase ?? to, resumePhase: options.resumePhase ?? current.resumePhase, updatedAt: current.updatedAt + 1 }
    this.runs.set(id, next)
    this.transitions.push({ runId: id, from: current.status, to })
    return next
  }
}

describe('Deep Research startup recovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('marks expired active runs interrupted after comparing a matching suspended Mastra Run', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'expired', workflowRunId: 'workflow-expired' })])
    repo.leases.set('expired', { executorId: 'dead-worker', expiresAt: 1_000 })
    const getWorkflowRunState = vi.fn(async () => ({ status: 'suspended' as const }))

    const result = await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState,
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(getWorkflowRunState).toHaveBeenCalledWith('workflow-expired')
    expect(repo.get('expired')).toMatchObject({ status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })
    expect(repo.transitions).toEqual([{ runId: 'expired', from: 'researching', to: 'interrupted' }])
    expect(result.interrupted.map((current) => current.id)).toEqual(['expired'])
    expect(result.corrections).toMatchObject([{
      runId: 'expired',
      fromStatus: 'researching',
      toStatus: 'interrupted',
      leaseExpired: true,
      leaseExpiresAt: 1_000,
      executorId: 'dead-worker',
      workflowRunId: 'workflow-expired',
      workflowStatus: 'suspended',
    }])
  })

  it('marks an expired active Run interrupted when no Mastra state exists', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'missing-state', workflowRunId: 'workflow-missing' })])
    repo.leases.set('missing-state', { executorId: 'dead-worker', expiresAt: 1_000 })

    const result = await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => null),
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('missing-state')).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
    expect(result.corrections).toMatchObject([{ workflowRunId: 'workflow-missing', workflowStatus: null }])
  })

  it('leaves active runs without an original lease untouched', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'no-lease', workflowRunId: 'workflow-no-lease' })])
    const getWorkflowRunState = vi.fn(async () => ({ status: 'suspended' as const }))

    const result = await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState,
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('no-lease')).toMatchObject({ status: 'researching', phase: 'researching' })
    expect(getWorkflowRunState).not.toHaveBeenCalled()
    expect(repo.transitions).toEqual([])
    expect(result.corrections).toEqual([])
  })

  it('leaves still-valid leases running and only interrupts expired active leases', async () => {
    const repo = new MemoryResearchRunRepo([
      run({ id: 'expired' }),
      run({ id: 'valid', workflowRunId: 'workflow-valid' }),
    ])
    repo.leases.set('expired', { executorId: 'dead-worker', expiresAt: 1_000 })
    repo.leases.set('valid', { executorId: 'live-worker', expiresAt: 3_000 })

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async (workflowRunId: string) => workflowRunId === 'workflow-valid' ? { status: 'running' as const } : null),
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('expired')).toMatchObject({ status: 'interrupted' })
    expect(repo.get('valid')).toMatchObject({ status: 'researching' })
    expect(repo.transitions).toHaveLength(1)
    expect(repo.transitions).toEqual([{ runId: 'expired', from: 'researching', to: 'interrupted' }])
  })

  it('preserves expired active runs when Mastra reports an active workflow state', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'conflict', workflowRunId: 'workflow-conflict' })])
    repo.leases.set('conflict', { executorId: 'dead-worker', expiresAt: 1_000 })
    const getWorkflowRunState = vi.fn(async () => ({ status: 'running' as const }))

    const result = await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState,
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(getWorkflowRunState).toHaveBeenCalledWith('workflow-conflict')
    expect(repo.get('conflict')).toMatchObject({ status: 'researching', phase: 'researching' })
    expect(repo.transitions).toEqual([])
    expect(result.interrupted).toEqual([])
    expect(result.corrections).toEqual([])
    expect(result.skipped).toMatchObject([{
      runId: 'conflict',
      reason: 'workflow-active',
      workflowRunId: 'workflow-conflict',
      workflowStatus: 'running',
    }])
  })

  it('records terminal Mastra workflow states without blindly interrupting the domain run', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'terminal', workflowRunId: 'workflow-terminal' })])
    repo.leases.set('terminal', { executorId: 'dead-worker', expiresAt: 1_000 })

    const result = await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => ({ status: 'completed' as const })),
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('terminal')).toMatchObject({ status: 'researching', phase: 'researching' })
    expect(repo.transitions).toEqual([])
    expect(result.skipped).toMatchObject([{
      runId: 'terminal',
      reason: 'workflow-terminal',
      workflowStatus: 'completed',
    }])
  })

  it('is idempotent and emits no duplicate status changes during reconciliation', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'expired' })])
    repo.leases.set('expired', { executorId: 'dead-worker', expiresAt: 1_000 })
    const coordinator = createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => null),
      enqueueResume: vi.fn(async () => undefined),
      isAutoResumeEnabled: () => false,
    })

    await coordinator.recoverInterruptedRuns(2_000)
    await coordinator.recoverInterruptedRuns(2_000)

    expect(repo.transitions).toEqual([{ runId: 'expired', from: 'researching', to: 'interrupted' }])
  })

  it('leaves interrupted runs resumable when DEEP_RESEARCH_AUTO_RESUME is false', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'interrupted', status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })])
    const enqueueResume = vi.fn(async () => undefined)

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => null),
      enqueueResume,
      isAutoResumeEnabled: () => false,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('interrupted')).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
    expect(enqueueResume).not.toHaveBeenCalled()
  })

  it('queues eligible interrupted runs once with an idempotent recovery command key when auto-resume is true', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'interrupted', status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })])
    const enqueueResume = vi.fn(async (runId: string) => {
      repo.transitionWithEvent(runId, 'queued', { phase: 'queued' })
    })
    const coordinator = createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => null),
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimedCommandKeys: new Set<string>(),
    })

    await coordinator.recoverInterruptedRuns(2_000)
    await coordinator.recoverInterruptedRuns(2_000)

    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(enqueueResume).toHaveBeenCalledWith('interrupted', 'deepresearch:auto-resume:v1:interrupted')
    expect(repo.get('interrupted')).toMatchObject({ status: 'queued', phase: 'queued' })
  })

  it('claims the auto-resume command key before enqueueing duplicate interrupted runs', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'interrupted', status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })])
    const enqueueResume = vi.fn(async () => undefined)
    const coordinator = createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      getWorkflowRunState: vi.fn(async () => null),
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimedCommandKeys: new Set<string>(),
    })

    await coordinator.recoverInterruptedRuns(2_000)
    await coordinator.recoverInterruptedRuns(2_000)

    expect(repo.get('interrupted')).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(enqueueResume).toHaveBeenCalledWith('interrupted', 'deepresearch:auto-resume:v1:interrupted')
  })

  it('uses a shared command-key claim to prevent duplicate auto-resume across coordinator restarts', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'interrupted', status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })])
    const enqueueResume = vi.fn(async () => undefined)
    const claimed = new Set<string>()
    const claimCommandKey = vi.fn(async (runId: string, commandKey: string) => {
      const key = runId + '\u0000' + commandKey
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    })

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimCommandKey,
    }).recoverInterruptedRuns(2_000)
    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimCommandKey,
    }).recoverInterruptedRuns(2_000)

    expect(repo.get('interrupted')).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
    expect(claimCommandKey).toHaveBeenCalledTimes(2)
    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(enqueueResume).toHaveBeenCalledWith('interrupted', 'deepresearch:auto-resume:v1:interrupted')
  })

  it('retries a persisted claimed auto-resume command that crashed before dispatch', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'interrupted', status: 'interrupted', phase: 'interrupted', resumePhase: 'researching' })])
    const commandKey = 'deepresearch:auto-resume:v1:interrupted'
    const commands = new Map([[commandKey, 'claimed']])
    const claimCommandKey = vi.fn(async (_runId: string, key: string) => {
      if (commands.get(key) === 'dispatching') return false
      commands.set(key, 'dispatching')
      return true
    })
    const markCommandDispatched = vi.fn(async (_runId: string, key: string) => {
      commands.set(key, 'dispatched')
    })
    const enqueueResume = vi.fn(async (runId: string) => {
      repo.transitionWithEvent(runId, 'queued', { phase: 'queued' })
    })

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimCommandKey,
      markCommandDispatched,
    }).recoverInterruptedRuns(2_000)

    expect(enqueueResume).toHaveBeenCalledWith('interrupted', commandKey)
    expect(repo.get('interrupted')).toMatchObject({ status: 'queued' })
    expect(commands.get(commandKey)).toBe('dispatched')
  })

  it('re-dispatches a queued run with a pending recovery command after restart', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'queued', status: 'queued', phase: 'queued', resumePhase: 'researching' })])
    const commandKey = 'deepresearch:auto-resume:v1:queued'
    const commands = new Map([[commandKey, 'claimed']])
    const enqueueResume = vi.fn(async () => undefined)

    await createDeepResearchRecoveryCoordinator({
      researchRunRepo: repo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimCommandKey: vi.fn(async (_runId: string, key: string) => {
        if (commands.get(key) === 'dispatching') return false
        commands.set(key, 'dispatching')
        return true
      }),
      markCommandDispatched: vi.fn(async (_runId: string, key: string) => {
        commands.set(key, 'dispatched')
      }),
    }).recoverInterruptedRuns(2_000)

    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(enqueueResume).toHaveBeenCalledWith('queued', commandKey)
    expect(repo.get('queued')).toMatchObject({ status: 'queued' })
    expect(commands.get(commandKey)).toBe('dispatched')
  })

  it('keeps duplicate concurrent recovery claims to exactly one execution attempt', async () => {
    const repo = new MemoryResearchRunRepo([run({ id: 'queued', status: 'queued', phase: 'queued' })])
    const commandKey = 'deepresearch:auto-resume:v1:queued'
    const commands = new Map([[commandKey, 'claimed']])
    const executed = vi.fn()
    const claimCommandKey = vi.fn(async (_runId: string, key: string) => {
      if (commands.get(key) !== 'claimed') return false
      commands.set(key, 'dispatching')
      return true
    })
    const enqueueResume = vi.fn(async (runId: string) => {
      if (repo.acquireLease(runId, 'runtime-worker', 30_000, 2_000)) executed(runId)
    })
    const options = {
      researchRunRepo: repo,
      enqueueResume,
      isAutoResumeEnabled: () => true,
      claimCommandKey,
      markCommandDispatched: vi.fn(async (_runId: string, key: string) => {
        commands.set(key, 'dispatched')
      }),
    }

    await Promise.all([
      createDeepResearchRecoveryCoordinator(options).recoverInterruptedRuns(2_000),
      createDeepResearchRecoveryCoordinator(options).recoverInterruptedRuns(2_000),
    ])

    expect(enqueueResume).toHaveBeenCalledTimes(1)
    expect(executed).toHaveBeenCalledTimes(1)
    expect(executed).toHaveBeenCalledWith('queued')
  })
})

describe('Deep Research telemetry helpers', () => {
  it('sanitizes trace attributes to Deep Research ids, shape, phase, and numeric counts only', () => {
    const attributes = deepResearchTraceAttributes({
      researchRunId: 'run-1',
      workflowRunId: 'workflow-1',
      profile: 'general',
      depth: 'standard',
      phase: 'researching',
      counts: {
        sources: 3,
        evidence: 5,
        skipped: Number.NaN,
        'bad key': 10,
      },
      topic: 'private topic',
      query: 'private query',
      url: 'https://example.invalid/private',
      error: 'private error payload',
    } as Parameters<typeof deepResearchTraceAttributes>[0] & Record<string, unknown>)

    expect(attributes).toEqual({
      'research.run.id': 'run-1',
      'workflow.run.id': 'workflow-1',
      profile: 'general',
      depth: 'standard',
      phase: 'researching',
      'research.count.sources': 3,
      'research.count.evidence': 5,
    })
  })

  it('wraps a Deep Research phase in a privacy-safe tracing helper', async () => {
    await expect(traceDeepResearchPhase('researching', {
      researchRunId: 'run-1',
      workflowRunId: 'workflow-1',
      phase: 'researching',
      counts: { selected: 2 },
    }, async (span) => {
      expect(span).toBeTruthy()
      return 'ok'
    })).resolves.toBe('ok')
  })

  it('emits the explicit operation phase even when context carries a stale phase', async () => {
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = []
    vi.resetModules()
    vi.doMock('../telemetry/tracer', () => ({
      SpanStatusCode: { ERROR: 2 },
      getTracer: () => ({
        startActiveSpan: async (name: string, options: { attributes: Record<string, unknown> }, operation: (span: unknown) => unknown) => {
          spans.push({ name, attributes: options.attributes })
          return operation({ setStatus: vi.fn(), end: vi.fn() })
        },
      }),
    }))
    const { traceDeepResearchPhase: tracePhase } = await import('../telemetry/metrics')

    await tracePhase('fetching', {
      researchRunId: 'run-1',
      workflowRunId: 'workflow-1',
      phase: 'planning',
      counts: { sources: 2 },
    }, async () => undefined)

    expect(spans).toEqual([{
      name: 'deepresearch.fetching',
      attributes: {
        'research.run.id': 'run-1',
        'workflow.run.id': 'workflow-1',
        phase: 'fetching',
        'research.count.sources': 2,
      },
    }])
    vi.doUnmock('../telemetry/tracer')
  })
})

describe('DEEP_RESEARCH_AUTO_RESUME config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('strictly accepts only 1, true, or on from process.env', async () => {
    const { isDeepResearchAutoResumeEnabled } = await import('../config/config')

    for (const value of ['1', 'true', 'on', 'TRUE', ' On ']) {
      process.env.DEEP_RESEARCH_AUTO_RESUME = value
      expect(isDeepResearchAutoResumeEnabled()).toBe(true)
    }

    for (const value of ['0', 'false', 'yes', 'enabled', '']) {
      process.env.DEEP_RESEARCH_AUTO_RESUME = value
      expect(isDeepResearchAutoResumeEnabled()).toBe(false)
    }
  })
})
