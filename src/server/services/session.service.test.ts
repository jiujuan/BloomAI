import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadSessionService() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { messageRepo } = await import('../db/repositories/message.repo')
  const { sessionService } = await import('./session.service')
  return { client, messageRepo, sessionService }
}

describe('sessionService', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-session-service-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('returns stable paged message DTOs with the total preserved', async () => {
    const { messageRepo, sessionService } = await loadSessionService()
    const session = sessionService.create({ title: 'Pagination' })
    messageRepo.save({ session_id: session.id, role: 'user', content: 'first' })
    messageRepo.save({ session_id: session.id, role: 'assistant', content: 'second' })

    const page = sessionService.listMessages(session.id, { limit: 1, offset: 0 })

    expect(page.data).toHaveLength(1)
    expect(page.meta).toEqual({ total: 2, limit: 1, offset: 0 })
    expect(page.data[0]).toMatchObject({ session_id: session.id })
  })

  it('rejects invalid pagination and missing sessions with domain errors', async () => {
    const { sessionService } = await loadSessionService()
    const session = sessionService.create()

    expect(() => sessionService.listMessages(session.id, { limit: -1, offset: 0 })).toThrowError('limit must be a non-negative integer')
    expect(() => sessionService.get('missing')).toThrowError('Session not found')
    expect(() => sessionService.listMessages('missing', { limit: 1, offset: 0 })).toThrowError('Session not found')
    try {
      sessionService.update('missing', { title: 'Nope' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  it('archives an existing session and deliberately retains its messages', async () => {
    const { messageRepo, sessionService } = await loadSessionService()
    const session = sessionService.create({ title: 'Archive me' })
    messageRepo.save({ session_id: session.id, role: 'user', content: 'retain this' })

    sessionService.remove(session.id)

    expect(sessionService.list().map((item) => item.id)).not.toContain(session.id)
    expect(messageRepo.list(session.id).map((message) => message.content)).toEqual(['retain this'])
  })
})