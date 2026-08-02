import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getOrmDb, closeDb, runMigrations } from '../db/client'
import { messages, sessions } from '../db/schema'
import { createScheduledTaskRunWriter, scheduledTaskRunRepo } from '../db/repositories/scheduled-task-run.repo'
import {
  SCHEDULE_TASK_SCHEMA_VERSION,
  SCHEDULE_TASK_SURFACE,
  createScheduleHooks,
} from '../mastra/schedules/hooks'
import { SCHEDULED_TASK_AGENT_ID } from '../mastra/schedules/scheduled-task-agent'
import { createScheduleTaskService } from './schedule-task.service'

const MODEL_OUTPUT = 'Deterministic scheduled-task integration output.'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
const runtimes: Array<{ mastra: Mastra; storage: LibSQLStore }> = []

function createDeterministicModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: MODEL_OUTPUT }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 7, text: 7, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

async function createRuntime() {
  const storage = new LibSQLStore({
    id: 'scheduled-task-integration',
    url: pathToFileURL(path.join(dataDir, 'mastra-runtime.db')).href,
  })
  await storage.init()

  const scheduledTaskAgent = new Agent({
    id: SCHEDULED_TASK_AGENT_ID,
    name: 'Scheduled task integration agent',
    instructions: 'Return the deterministic test result.',
    model: createDeterministicModel(),
    tools: {},
  })
  const mastra = new Mastra({
    storage,
    schedules: createScheduleHooks({
      taskRunWriter: createScheduledTaskRunWriter(),
      isDefaultModelAvailable: async () => true,
    }),
    agents: { [SCHEDULED_TASK_AGENT_ID]: scheduledTaskAgent },
  })
  await mastra.startWorkers()

  const runtime = { mastra, storage }
  runtimes.push(runtime)
  return runtime
}

async function removeTemporaryDataDir() {
  try {
    await fs.promises.rm(dataDir, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // @libsql/client may retain a Windows file handle until the Vitest fork exits,
    // even after LibSQLStore.close() has completed. This disposable directory can
    // remain in the OS temp area; all functional cleanup has already completed.
    if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY')) throw error
  }
}

async function waitForSuccessfulRun(scheduleId: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const page = scheduledTaskRunRepo.listByScheduleId(scheduleId)
    if (page.data.length === 1 && page.data[0]?.status === 'succeeded') return page.data[0]
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for scheduled task ${scheduleId} to finish.`)
}

describe('scheduled task runtime integration', () => {
  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-scheduled-task-integration-'))
    originalEnv = { ...process.env }
    process.env.DATA_DIR = dataDir
    await runMigrations()
  })

  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
      await runtime.mastra.shutdown()
      await runtime.storage.close()
    }
    closeDb()
    process.env = originalEnv
    await removeTemporaryDataDir()
  })

  it('persists an isolated task schedule, records deterministic output, and never writes Chat data', async () => {
    const firstRuntime = await createRuntime()
    const firstService = createScheduleTaskService({
      gateway: firstRuntime.mastra,
      taskRunRepository: scheduledTaskRunRepo,
    })

    const created = await firstService.createTask({
      name: 'Integration daily brief',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      prompt: 'Produce the integration brief.',
    })
    expect(created).toMatchObject({
      agentId: SCHEDULED_TASK_AGENT_ID,
      status: 'active',
    })

    await firstRuntime.mastra.shutdown()
    await firstRuntime.storage.close()
    runtimes.splice(runtimes.indexOf(firstRuntime), 1)

    const secondRuntime = await createRuntime()
    const secondService = createScheduleTaskService({
      gateway: secondRuntime.mastra,
      taskRunRepository: scheduledTaskRunRepo,
    })
    await expect(secondService.getTask(created.id)).resolves.toMatchObject({ id: created.id, name: created.name })

    await expect(secondService.runTaskNow(created.id)).resolves.toMatchObject({ id: created.id })
    const run = await waitForSuccessfulRun(created.id)
    expect(run).toMatchObject({
      scheduleId: created.id,
      triggerKind: 'manual',
      status: 'succeeded',
      outputText: MODEL_OUTPUT,
    })
    expect(scheduledTaskRunRepo.listByScheduleId(created.id).data).toHaveLength(1)

    await expect(secondService.pauseTask(created.id)).resolves.toMatchObject({ status: 'paused' })
    await expect(secondService.resumeTask(created.id)).resolves.toMatchObject({ status: 'active' })
    await expect(secondService.deleteTask(created.id)).resolves.toBeUndefined()
    await expect(secondService.listTasks()).resolves.toEqual([])
    expect(scheduledTaskRunRepo.listByScheduleId(created.id).data).toEqual([])

    expect(getOrmDb().select().from(sessions).all()).toEqual([])
    expect(getOrmDb().select().from(messages).all()).toEqual([])

    const persistedSchedules = await secondRuntime.mastra.schedules.list({ agentId: SCHEDULED_TASK_AGENT_ID })
    expect(persistedSchedules).toEqual([])
  })

  it('keeps the controlled schedule metadata and the runtime free of Chat thread identifiers', async () => {
    const { mastra } = await createRuntime()
    const service = createScheduleTaskService({ gateway: mastra, taskRunRepository: scheduledTaskRunRepo })
    const task = await service.createTask({
      name: 'Metadata boundary',
      cron: '0 12 * * *',
      timezone: 'UTC',
      prompt: 'Return a harmless task result.',
    })
    const schedule = await mastra.schedules.get(task.id)

    expect(schedule).toMatchObject({
      agentId: SCHEDULED_TASK_AGENT_ID,
      metadata: { surface: SCHEDULE_TASK_SURFACE, schemaVersion: SCHEDULE_TASK_SCHEMA_VERSION },
    })
    expect(schedule).not.toHaveProperty('threadId')
    expect(schedule).not.toHaveProperty('resourceId')
  })
})
