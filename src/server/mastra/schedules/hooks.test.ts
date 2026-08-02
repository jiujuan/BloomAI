import type {
  ScheduleAbortContext,
  ScheduleErrorContext,
  ScheduleFinishContext,
  SchedulePrepareContext,
} from '@mastra/core/schedules'
import { describe, expect, it, vi } from 'vitest'
import {
  createScheduleHooks,
  type ScheduleTaskRunRecord,
  type ScheduleTaskRunWriter,
  SCHEDULE_TASK_SCHEMA_VERSION,
  SCHEDULE_TASK_SURFACE,
} from './hooks'
import { SCHEDULED_TASK_AGENT_ID } from './scheduled-task-agent'

class InMemoryRunWriter implements ScheduleTaskRunWriter {
  readonly runs = new Map<string, ScheduleTaskRunRecord>()

  async upsert(record: ScheduleTaskRunRecord): Promise<void> {
    this.runs.set(`${record.scheduleId}:${record.triggerFiredAt}`, record)
  }
}

const firedAt = new Date('2026-08-02T00:00:00.000Z')
const bloomaiSchedule = {
  id: 'agent_daily-summary',
  agentId: SCHEDULED_TASK_AGENT_ID,
  metadata: {
    surface: SCHEDULE_TASK_SURFACE,
    schemaVersion: SCHEDULE_TASK_SCHEMA_VERSION,
  },
}

function prepareContext(overrides: Partial<SchedulePrepareContext> = {}): SchedulePrepareContext {
  return {
    mastra: { getAgentById: () => ({ id: SCHEDULED_TASK_AGENT_ID }) },
    agentId: SCHEDULED_TASK_AGENT_ID,
    schedule: bloomaiSchedule,
    trigger: { kind: 'manual', firedAt },
    ...overrides,
  }
}

function finishContext(overrides: Partial<ScheduleFinishContext> = {}): ScheduleFinishContext {
  return {
    ...prepareContext(),
    outcome: 'succeeded',
    runId: 'mastra-run-1',
    result: { text: 'A complete task result.', usage: { totalTokens: 7 } },
    effective: { prompt: 'Summarize today.' },
    ...overrides,
  }
}

describe('createScheduleHooks', () => {
  it('writes a successful task output through the idempotent run writer', async () => {
    const writer = new InMemoryRunWriter()
    const hooks = createScheduleHooks({
      taskRunWriter: writer,
      isDefaultModelAvailable: async () => true,
      now: () => 1234,
    })

    await expect(hooks.prepare!(prepareContext())).resolves.toBeUndefined()
    await hooks.onFinish!(finishContext())

    expect([...writer.runs.values()]).toEqual([{
      scheduleId: 'agent_daily-summary',
      triggerFiredAt: firedAt.getTime(),
      mastraRunId: 'mastra-run-1',
      triggerKind: 'manual',
      status: 'succeeded',
      outputText: 'A complete task result.',
      usageJson: JSON.stringify({ totalTokens: 7 }),
      startedAt: firedAt.getTime(),
      finishedAt: 1234,
    }])
  })

  it('skips rejected preflight executions and records a skipped run', async () => {
    const writer = new InMemoryRunWriter()
    const hooks = createScheduleHooks({
      taskRunWriter: writer,
      isDefaultModelAvailable: async () => false,
      now: () => 1234,
    })

    await expect(hooks.prepare!(prepareContext())).resolves.toBeNull()
    await hooks.onFinish!(finishContext({ outcome: 'skipped', result: undefined, runId: undefined }))

    expect([...writer.runs.values()]).toMatchObject([{
      status: 'skipped',
      errorMessage: 'No enabled default model is available.',
    }])
  })

  it('redacts sensitive values before persisting execution errors', async () => {
    const writer = new InMemoryRunWriter()
    const hooks = createScheduleHooks({ taskRunWriter: writer, now: () => 1234 })
    const errorContext: ScheduleErrorContext = {
      ...prepareContext(),
      phase: 'run',
      runId: 'mastra-run-2',
      error: new Error('provider rejected bearer secret-token and api_key=abc123'),
      effective: { prompt: 'Summarize today.' },
    }

    await hooks.onError!(errorContext)

    const record = [...writer.runs.values()][0]
    expect(record).toMatchObject({ status: 'failed', mastraRunId: 'mastra-run-2' })
    expect(record.errorMessage).toContain('[REDACTED]')
    expect(record.errorMessage).not.toContain('secret-token')
    expect(record.errorMessage).not.toContain('abc123')
  })

  it('delegates duplicate callbacks for the same schedule fire to the idempotent writer key', async () => {
    const writer = new InMemoryRunWriter()
    const hooks = createScheduleHooks({ taskRunWriter: writer, now: () => 1234 })
    const context = finishContext()

    await hooks.onFinish!(context)
    await hooks.onFinish!(context)

    expect(writer.runs).toHaveLength(1)
  })

  it('does not treat schedules outside the BloomAI metadata namespace as application tasks', async () => {
    const writer = new InMemoryRunWriter()
    const isDefaultModelAvailable = vi.fn(async () => true)
    const hooks = createScheduleHooks({ taskRunWriter: writer, isDefaultModelAvailable })
    const externalContext = finishContext({
      schedule: { id: 'agent_external', agentId: SCHEDULED_TASK_AGENT_ID, metadata: { surface: 'external' } },
    })

    await expect(hooks.prepare!(externalContext)).resolves.toBeNull()
    await hooks.onFinish!(externalContext)
    await hooks.onAbort!({
      ...prepareContext({ schedule: externalContext.schedule }),
      runId: 'mastra-run-3',
      effective: { prompt: 'External work.' },
    } as ScheduleAbortContext)

    expect(isDefaultModelAvailable).not.toHaveBeenCalled()
    expect(writer.runs).toHaveLength(0)
  })

  it('logs but suppresses task-run writer failures', async () => {
    const logger = { warn: vi.fn() }
    const hooks = createScheduleHooks({
      taskRunWriter: { upsert: async () => { throw new Error('database is unavailable') } },
      logger,
    })

    await expect(hooks.onFinish!(finishContext())).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Scheduled task lifecycle hook failed.', expect.objectContaining({ hook: 'onFinish' }))
  })
})
