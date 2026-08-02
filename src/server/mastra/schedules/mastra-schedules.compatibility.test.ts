import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'

let storage: LibSQLStore | undefined
let mastra: Mastra | undefined

describe('Mastra schedules compatibility', () => {
  beforeEach(async () => {
    storage = new LibSQLStore({
      id: 'mastra-schedules-compatibility',
      url: ':memory:',
    })
    await storage.init()
  })

  afterEach(async () => {
    await mastra?.shutdown()
    mastra = undefined
    await storage?.close()
    storage = undefined
  })

  it('creates and manages a threadless schedule through the LibSQL-backed API', async () => {
    mastra = new Mastra({ storage })

    expect(mastra.schedules).toBeDefined()
    expect(mastra.schedules.create).toBeTypeOf('function')
    expect(mastra.schedules.list).toBeTypeOf('function')
    expect(mastra.schedules.pause).toBeTypeOf('function')
    expect(mastra.schedules.resume).toBeTypeOf('function')
    expect(mastra.schedules.run).toBeTypeOf('function')

    const created = await mastra.schedules.create({
      id: 'compatibility',
      agentId: 'scheduled-task',
      cron: '0 9 * * *',
      prompt: 'Generate the scheduled task result.',
    })

    expect(created).toMatchObject({
      id: 'agent_compatibility',
      agentId: 'scheduled-task',
      status: 'active',
    })
    expect(created.threadId).toBeUndefined()
    expect(created.resourceId).toBeUndefined()
    await expect(mastra.schedules.list({ agentId: 'scheduled-task' })).resolves.toEqual([created])

    await expect(mastra.schedules.pause(created.id)).resolves.toMatchObject({ status: 'paused' })
    await expect(mastra.schedules.resume(created.id)).resolves.toMatchObject({ status: 'active' })
    await expect(mastra.schedules.run(created.id)).resolves.toMatchObject({ scheduleId: created.id })
  })
})
