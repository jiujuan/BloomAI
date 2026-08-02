import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../client')
  await client.runMigrations()
  return await import('./scheduled-task-run.repo')
}

const baseRun = {
  scheduleId: 'schedule-morning-brief',
  triggerFiredAt: 1_700_000_000_000,
  mastraRunId: 'mastra-run-1',
  triggerKind: 'cron' as const,
  status: 'succeeded' as const,
  outputText: 'Morning brief',
  usageJson: '{"totalTokens":42}',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
  createdAt: 1_700_000_001_000,
}

describe('scheduledTaskRunRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-scheduled-task-run-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates an isolated task run and returns the existing row for an idempotency conflict', async () => {
    const { scheduledTaskRunRepo } = await loadRepo()
    const created = scheduledTaskRunRepo.createOrGet(baseRun)
    const duplicate = scheduledTaskRunRepo.createOrGet({
      ...baseRun,
      status: 'failed',
      errorMessage: 'This must not replace the original create.',
    })

    expect(created).toMatchObject({
      scheduleId: baseRun.scheduleId,
      triggerFiredAt: baseRun.triggerFiredAt,
      status: 'succeeded',
      outputText: 'Morning brief',
      mastraRunId: 'mastra-run-1',
    })
    expect(duplicate).toEqual(created)
    expect(duplicate).not.toHaveProperty('sessionId')
    expect(duplicate).not.toHaveProperty('messageId')
    expect(duplicate).not.toHaveProperty('threadId')
  })

  it('updates lifecycle output and terminal status through the durable hook writer adapter', async () => {
    const { createScheduledTaskRunWriter, scheduledTaskRunRepo } = await loadRepo()
    const writer = createScheduledTaskRunWriter()

    await writer.upsert({
      ...baseRun,
      status: 'failed',
      outputText: undefined,
      errorMessage: 'Model unavailable',
      usageJson: undefined,
      finishedAt: 1_700_000_002_000,
    })
    await writer.upsert({
      ...baseRun,
      status: 'succeeded',
      outputText: 'Recovered morning brief',
      errorMessage: undefined,
      usageJson: '{"totalTokens":84}',
      finishedAt: 1_700_000_003_000,
    })

    expect(scheduledTaskRunRepo.getByScheduleAndTrigger(baseRun.scheduleId, baseRun.triggerFiredAt)).toMatchObject({
      status: 'succeeded',
      outputText: 'Recovered morning brief',
      errorMessage: 'Model unavailable',
      usageJson: '{"totalTokens":84}',
      finishedAt: 1_700_000_003_000,
    })
  })

  it('returns descending cursor pages for one schedule', async () => {
    const { scheduledTaskRunRepo } = await loadRepo()
    for (const triggerFiredAt of [100, 300, 200]) {
      scheduledTaskRunRepo.createOrGet({
        ...baseRun,
        triggerFiredAt,
        mastraRunId: `run-${triggerFiredAt}`,
        startedAt: triggerFiredAt,
        finishedAt: triggerFiredAt + 1,
      })
    }

    const firstPage = scheduledTaskRunRepo.listByScheduleId(baseRun.scheduleId, { limit: 2 })
    const secondPage = scheduledTaskRunRepo.listByScheduleId(baseRun.scheduleId, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    expect(firstPage.data.map((run) => run.triggerFiredAt)).toEqual([300, 200])
    expect(firstPage.nextCursor).toBe('200')
    expect(secondPage.data.map((run) => run.triggerFiredAt)).toEqual([100])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('gets each requested schedule latest run with one batched lookup and deletes all schedule runs', async () => {
    const { scheduledTaskRunRepo } = await loadRepo()
    scheduledTaskRunRepo.createOrGet({ ...baseRun, scheduleId: 'schedule-a', triggerFiredAt: 100, startedAt: 100 })
    scheduledTaskRunRepo.createOrGet({ ...baseRun, scheduleId: 'schedule-a', triggerFiredAt: 200, startedAt: 200 })
    scheduledTaskRunRepo.createOrGet({ ...baseRun, scheduleId: 'schedule-b', triggerFiredAt: 150, startedAt: 150 })

    const latest = scheduledTaskRunRepo.getLatestByScheduleIds(['schedule-a', 'schedule-b', 'missing', 'schedule-a'])
    expect([...latest.entries()].map(([scheduleId, run]) => [scheduleId, run.triggerFiredAt])).toEqual([
      ['schedule-a', 200],
      ['schedule-b', 150],
    ])
    expect(scheduledTaskRunRepo.deleteByScheduleId('schedule-a')).toBe(2)
    expect(scheduledTaskRunRepo.listByScheduleId('schedule-a').data).toEqual([])
    expect(scheduledTaskRunRepo.listByScheduleId('schedule-b').data).toHaveLength(1)
  })
})
