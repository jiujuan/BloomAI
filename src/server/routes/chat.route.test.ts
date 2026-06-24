import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ChatStreamRequest } from '../llm'

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
}))

vi.mock('../llm', () => ({
  streamChatCompletion: llmMock.streamChatCompletion,
}))

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let consoleErrorSpy: { mockRestore(): void }

async function* events(items: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const item of items) {
    yield item
  }
}

async function* failingEvents(): AsyncGenerator<ChatStreamEvent> {
  yield { type: 'delta', text: 'partial' }
  throw new Error('stream failed')
}

async function loadApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const { createApp } = await import('../app')
  const { sessionRepo } = await import('../db/repositories/session.repo')
  const { personaRepo } = await import('../db/repositories/persona.repo')
  const { messageRepo } = await import('../db/repositories/message.repo')
  const { settingsRepo } = await import('../db/repositories/settings.repo')
  const app = await createApp()

  return { app, sessionRepo, personaRepo, messageRepo, settingsRepo }
}

async function postSse(app: Awaited<ReturnType<typeof loadApp>>['app'], body: object): Promise<string> {
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening))
  })
  const address = server.address() as AddressInfo

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await response.text()
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

function parseSse(text: string): any[] {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.replace(/^data: /, ''))
    .filter((chunk) => chunk !== '[DONE]')
    .map((chunk) => JSON.parse(chunk))
}

describe('chat stream route', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-chat-route-'))
    originalEnv = { ...process.env }
    llmMock.streamChatCompletion.mockReset()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('forwards model, system, and messages to the LLM runtime and persists the response', async () => {
    llmMock.streamChatCompletion.mockReturnValue(
      events([
        { type: 'delta', text: 'Hello' },
        { type: 'usage', input: 3, output: 5 },
        { type: 'done' },
      ])
    )
    const { app, messageRepo, sessionRepo } = await loadApp()
    const session = sessionRepo.create({ model: 'gpt-4o' })
    messageRepo.save({ session_id: session.id, role: 'assistant', content: 'Earlier answer' })

    const responseText = await postSse(app, {
      sessionId: session.id,
      content: 'Hi there',
      contextOverride: { activeApp: 'Editor' },
    })

    expect(llmMock.streamChatCompletion).toHaveBeenCalledWith({
      model: 'gpt-4o',
      system: expect.stringContaining('Active app: Editor'),
      messages: [
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Hi there' },
      ],
      maxTokens: 4096,
    } satisfies ChatStreamRequest)
    expect(parseSse(responseText)).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'done', tokens: { input: 3, output: 5 } },
    ])
    expect(messageRepo.list(session.id).map((message) => [message.role, message.content, message.tokens])).toEqual([
      ['assistant', 'Earlier answer', null],
      ['user', 'Hi there', null],
      ['assistant', 'Hello', 8],
    ])
    expect(sessionRepo.get(session.id)?.title).toBe('New Chat')
  })

  it('uses persona model override before the session model', async () => {
    llmMock.streamChatCompletion.mockReturnValue(events([{ type: 'done' }]))
    const { app, personaRepo, sessionRepo } = await loadApp()
    const persona = personaRepo.create({
      name: 'GPT persona',
      system_prompt: 'Persona prompt',
      model_override: 'gpt-4o-mini',
    })
    const session = sessionRepo.create({ persona_id: persona.id, model: 'claude-3-haiku-20240307' })

    await postSse(app, { sessionId: session.id, content: 'Use override' })

    expect(llmMock.streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        system: 'Persona prompt',
      })
    )
  })

  it('uses settings.model when the session has no model value', async () => {
    llmMock.streamChatCompletion.mockReturnValue(events([{ type: 'done' }]))
    const { app, sessionRepo, settingsRepo } = await loadApp()
    const session = sessionRepo.create({ model: 'claude-3-haiku-20240307' })
    settingsRepo.setMany({ model: 'gpt-4o' })
    sessionRepo.update(session.id, { model: '' })

    await postSse(app, { sessionId: session.id, content: 'Use setting' })

    expect(llmMock.streamChatCompletion).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }))
  })

  it('uses settings.model when the default built-in persona still has the legacy model override', async () => {
    llmMock.streamChatCompletion.mockReturnValue(events([{ type: 'done' }]))
    const { app, sessionRepo, settingsRepo } = await loadApp()
    const session = sessionRepo.create({ persona_id: 'developer', model: 'agnes-2.0-flash' })
    settingsRepo.setMany({ model: 'agnes-2.0-flash' })

    await postSse(app, { sessionId: session.id, content: 'Use Agnes with the default persona' })

    expect(llmMock.streamChatCompletion).toHaveBeenCalledWith(expect.objectContaining({ model: 'agnes-2.0-flash' }))
  })

  it('saves partial assistant text when streaming fails', async () => {
    llmMock.streamChatCompletion.mockReturnValue(failingEvents())
    const { app, messageRepo, sessionRepo } = await loadApp()
    const session = sessionRepo.create({ model: 'gpt-4o' })

    const responseText = await postSse(app, { sessionId: session.id, content: 'Break please' })

    expect(parseSse(responseText)).toEqual([
      { type: 'delta', text: 'partial' },
      { type: 'error', error: 'stream failed' },
    ])
    expect(messageRepo.list(session.id).map((message) => [message.role, message.content])).toEqual([
      ['user', 'Break please'],
      ['assistant', 'partial'],
    ])
  })
})

