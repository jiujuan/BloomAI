import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadMessageRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../client')
  await client.runMigrations()
  const { messageRepo } = await import('./message.repo')

  return { messageRepo, client }
}

describe('messageRepo parts persistence', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-message-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('round-trips the rich UI parts column for assistant messages', async () => {
    const { messageRepo } = await loadMessageRepo()
    const parts = [
      { type: 'tool-web_search', toolCallId: 'c1', state: 'output-available', input: { query: 'x' }, output: { total: 2, results: [{ title: 'A', url: 'https://a' }] } },
      { type: 'text', text: 'final answer' },
    ]

    messageRepo.save({ session_id: 's1', role: 'assistant', content: 'final answer', parts: JSON.stringify(parts) })

    const rows = messageRepo.list('s1')
    expect(rows).toHaveLength(1)
    expect(rows[0].parts).toBeTruthy()
    expect(JSON.parse(rows[0].parts as string)).toEqual(parts)
  })

  it('stores null parts for messages saved without them (legacy/user rows)', async () => {
    const { messageRepo } = await loadMessageRepo()
    messageRepo.save({ session_id: 's1', role: 'user', content: 'hello' })

    const rows = messageRepo.list('s1')
    expect(rows[0].parts ?? null).toBeNull()
  })
})
