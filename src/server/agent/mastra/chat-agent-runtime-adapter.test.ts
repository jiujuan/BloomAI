import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_MAX_STEPS } from './constants'
import { runChatAgentV1 } from './chat-agent-runtime-adapter'

const createChatAgentMock = vi.hoisted(() => vi.fn())

vi.mock('./chat-agent', () => ({
  createChatAgent: createChatAgentMock,
}))

let dataDir: string

describe('Mastra chat agent runtime adapter skeleton', () => {
  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-mastra-runtime-'))
    process.env.DATA_DIR = dataDir
    const client = await import('../../db/client')
    await client.runMigrations()
    createChatAgentMock.mockReset()
    createChatAgentMock.mockReturnValue({})
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.DATA_DIR
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('defines a max step default of 10', () => {
    expect(DEFAULT_AGENT_MAX_STEPS).toBe(10)
  })

  it('injects the session id when creating the Mastra chat agent', async () => {
    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'gpt-4o',
    })) {
      // consume stream
    }

    expect(createChatAgentMock).toHaveBeenCalledWith('openai/gpt-4o', { sessionId: 'session-1' })
  })

  it('emits an error event when the selected model is not configured', async () => {
    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'unknown-model',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'error', error: 'LLM model "unknown-model" is not configured' },
    ])
    expect(createChatAgentMock).not.toHaveBeenCalled()
  })
  it('maps Mastra stream chunks to BloomAI runtime events', async () => {
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => ({
        fullStream: asyncGenerator([
          { type: 'text-delta', textDelta: 'Searching...' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'web_search', args: { query: 'Mastra' } },
          { type: 'tool-result', toolCallId: 'call-1', toolName: 'web_search', result: { query: 'Mastra', results: [] } },
        ]),
      })),
    })

    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'gpt-4o',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'delta', text: 'Searching...' },
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'Mastra' },
        },
      },
      { type: 'tool_call_result', callId: 'call-1', output: { query: 'Mastra', results: [] } },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
        },
      },
    ])
  })

  it('returns a testable async event stream with a done trace', async () => {
    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'gpt-4o',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
        },
      },
    ])
  })
})

async function* asyncGenerator(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}
