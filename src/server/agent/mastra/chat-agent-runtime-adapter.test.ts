import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizedChatPrompt } from '../../prompts/types'
import { DEFAULT_AGENT_MAX_STEPS } from './constants'
import type { ChatAgentRuntimeEvent } from './types'
import { runChatAgentV1 } from './chat-agent-runtime-adapter'

const createChatAgentMock = vi.hoisted(() => vi.fn())
const resolveCapabilitiesMock = vi.hoisted(() => vi.fn())
const resolveIntentMock = vi.hoisted(() => vi.fn())

vi.mock('./chat-agent', () => ({
  createChatAgent: createChatAgentMock,
}))

vi.mock('../runtime/capabilities', () => ({
  resolveChatCapabilities: resolveCapabilitiesMock,
}))

vi.mock('../runtime/intent/chat-intent-router', () => ({
  resolveChatIntent: resolveIntentMock,
}))

let dataDir: string

function createPrompt(content = 'hello'): OrganizedChatPrompt {
  return {
    system: 'Persona prompt\n\n---\nActive app: Editor\nClipboard:\nCopied context',
    messages: [
      { role: 'user', content: 'What did I ask earlier?' },
      { role: 'assistant', content: 'You asked about agents.' },
      { role: 'user', content },
    ],
    maxTokens: 4096,
  }
}

describe('Mastra chat agent runtime adapter skeleton', () => {
  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-mastra-runtime-'))
    process.env.DATA_DIR = dataDir
    const client = await import('../../db/client')
    await client.runMigrations()
    createChatAgentMock.mockReset()
    createChatAgentMock.mockReturnValue({})
    resolveCapabilitiesMock.mockReset()
    resolveCapabilitiesMock.mockReturnValue({
      tools: [{ kind: 'tool', id: 'web_search', name: 'Web search', description: 'Search the web', enabled: true, paramsSchema: { type: 'object' } }],
      skills: [],
    })
    resolveIntentMock.mockReset()
    resolveIntentMock.mockResolvedValue({
      mode: 'answer_only',
      source: 'programmatic',
      confidence: 0.95,
      reason: 'plain answer',
      selectedTools: [],
      selectedSkills: [],
    })
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
      prompt: createPrompt(),
      model: 'gpt-4o',
    })) {
      // consume stream
    }

    expect(createChatAgentMock).toHaveBeenCalledWith('openai/gpt-4o', {
      sessionId: 'session-1',
      prompt: createPrompt(),
      intent: expect.objectContaining({ mode: 'answer_only' }),
      enabledTools: expect.any(Array),
      enabledSkills: [],
      selectedTools: [],
      selectedSkills: [],
    })
  })

  it('passes Agnes to Mastra as an OpenAI-compatible custom endpoint config', async () => {
    const { settingsRepo } = await import('../../db/repositories/settings.repo')
    settingsRepo.setMany({ agnes_api_key: 'test-agnes-key' })

    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
      model: 'agnes-2.0-flash',
    })) {
      // consume stream
    }

    expect(createChatAgentMock).toHaveBeenCalledWith({
      id: 'agnes/agnes-2.0-flash',
      url: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'test-agnes-key',
    }, expect.objectContaining({ sessionId: 'session-1', prompt: createPrompt(), selectedTools: [] }))
  })

  it('resolves capabilities and intent before creating the Mastra chat agent', async () => {
    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
      model: 'gpt-4o',
    })) {
      // consume stream
    }

    expect(resolveCapabilitiesMock).toHaveBeenCalledOnce()
    expect(resolveIntentMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
      availableTools: [{ kind: 'tool', id: 'web_search', name: 'Web search', description: 'Search the web', enabled: true, paramsSchema: { type: 'object' } }],
      availableSkills: [],
    })
  })

  it('passes selected tools from intent into createChatAgent', async () => {
    resolveIntentMock.mockResolvedValue({
      mode: 'tool',
      source: 'programmatic',
      confidence: 0.95,
      reason: 'needs search',
      selectedTools: ['web_search'],
      selectedSkills: [],
    })

    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'latest docs',
      prompt: createPrompt('latest docs'),
      model: 'gpt-4o',
    })) {
      // consume stream
    }

    expect(createChatAgentMock).toHaveBeenCalledWith('openai/gpt-4o', expect.objectContaining({
      intent: expect.objectContaining({ mode: 'tool' }),
      selectedTools: ['web_search'],
      selectedSkills: [],
    }))
  })
  it('emits the no-tool runtime path as answer deltas followed by done', async () => {
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => ({
        fullStream: asyncGenerator([
          { type: 'text-delta', textDelta: 'Direct answer.' },
          { type: 'finish', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } },
        ]),
      })),
    })

    const events = await collectEvents(runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
      model: 'gpt-4o',
    }))

    expect(events).toEqual([
      { type: 'delta', text: 'Direct answer.' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
          tokens: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        },
      },
    ])
  })

  it('emits the web_search runtime path and records the completed tool trace', async () => {
    resolveIntentMock.mockResolvedValue({
      mode: 'tool',
      source: 'programmatic',
      confidence: 0.95,
      reason: 'needs search',
      selectedTools: ['web_search'],
      selectedSkills: [],
    })
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => ({
        fullStream: asyncGenerator([
          { type: 'tool-call', toolCallId: 'search-1', toolName: 'web_search', args: { query: 'Mastra' } },
          { type: 'tool-result', toolCallId: 'search-1', toolName: 'web_search', result: { results: [{ title: 'Mastra docs' }] } },
          { type: 'text-delta', textDelta: 'Search says Mastra has docs.' },
        ]),
      })),
    })

    const events = await collectEvents(runChatAgentV1({
      sessionId: 'session-1',
      content: 'latest Mastra docs',
      prompt: createPrompt('latest Mastra docs'),
      model: 'gpt-4o',
    }))

    expect(events).toEqual([
      {
        type: 'tool_call_start',
        call: {
          callId: 'search-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'Mastra' },
        },
      },
      { type: 'tool_call_result', callId: 'search-1', output: { results: [{ title: 'Mastra docs' }] } },
      { type: 'delta', text: 'Search says Mastra has docs.' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [
            {
              callId: 'search-1',
              toolId: 'web_search',
              status: 'success',
              input: { query: 'Mastra' },
              outputSummary: '{"results":[{"title":"Mastra docs"}]}',
            },
          ],
        },
      },
    ])
  })

  it('emits the skill runtime path as ordinary tool events with a skill tool id', async () => {
    resolveCapabilitiesMock.mockReturnValue({
      tools: [],
      skills: [{
        kind: 'skill',
        id: 'summarizer',
        name: 'Summarizer',
        description: 'Summarize text',
        type: 'prompt-template',
        enabled: true,
        paramsSchema: { type: 'object' },
      }],
    })
    resolveIntentMock.mockResolvedValue({
      mode: 'skill',
      source: 'programmatic',
      confidence: 0.95,
      reason: 'explicit skill request',
      selectedTools: [],
      selectedSkills: ['summarizer'],
    })
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => ({
        fullStream: asyncGenerator([
          { type: 'tool-call', toolCallId: 'skill-1', toolName: 'skill:summarizer', args: { text: 'Long note' } },
          { type: 'tool-result', toolCallId: 'skill-1', toolName: 'skill:summarizer', result: { summary: 'Short note' } },
          { type: 'text-delta', textDelta: 'Short note' },
        ]),
      })),
    })

    const events = await collectEvents(runChatAgentV1({
      sessionId: 'session-1',
      content: 'run summarizer',
      prompt: createPrompt('run summarizer'),
      model: 'gpt-4o',
    }))

    expect(createChatAgentMock).toHaveBeenCalledWith('openai/gpt-4o', expect.objectContaining({
      selectedTools: [],
      selectedSkills: ['summarizer'],
    }))
    expect(events).toEqual([
      {
        type: 'tool_call_start',
        call: {
          callId: 'skill-1',
          toolId: 'skill:summarizer',
          category: 'tool',
          status: 'running',
          input: { text: 'Long note' },
        },
      },
      { type: 'tool_call_result', callId: 'skill-1', output: { summary: 'Short note' } },
      { type: 'delta', text: 'Short note' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [
            {
              callId: 'skill-1',
              toolId: 'skill:summarizer',
              status: 'success',
              input: { text: 'Long note' },
              outputSummary: '{"summary":"Short note"}',
            },
          ],
        },
      },
    ])
  })

  it('emits tool failure events and records an error tool trace without falling back', async () => {
    resolveIntentMock.mockResolvedValue({
      mode: 'tool',
      source: 'programmatic',
      confidence: 0.95,
      reason: 'needs search',
      selectedTools: ['web_search'],
      selectedSkills: [],
    })
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => ({
        fullStream: asyncGenerator([
          { type: 'tool-call', toolCallId: 'search-1', toolName: 'web_search', args: { query: 'Mastra' } },
          { type: 'tool-error', toolCallId: 'search-1', toolName: 'web_search', error: new Error('search failed') },
        ]),
      })),
    })

    const events = await collectEvents(runChatAgentV1({
      sessionId: 'session-1',
      content: 'latest Mastra docs',
      prompt: createPrompt('latest Mastra docs'),
      model: 'gpt-4o',
    }))

    expect(events).toEqual([
      {
        type: 'tool_call_start',
        call: {
          callId: 'search-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'Mastra' },
        },
      },
      { type: 'tool_call_error', callId: 'search-1', error: 'search failed' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [
            {
              callId: 'search-1',
              toolId: 'web_search',
              status: 'error',
              input: { query: 'Mastra' },
              outputSummary: 'search failed',
            },
          ],
        },
      },
    ])
  })

  it('emits a response failure event when agent startup fails', async () => {
    createChatAgentMock.mockReturnValue({
      stream: vi.fn(async () => {
        throw new Error('agent failed to start')
      }),
    })

    const events = await collectEvents(runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
      model: 'gpt-4o',
    }))

    expect(events).toEqual([{ type: 'error', error: 'agent failed to start' }])
  })
  it('emits an error event when the selected model is not configured', async () => {
    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
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
      prompt: createPrompt(),
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
          toolCalls: [
            {
              callId: 'call-1',
              toolId: 'web_search',
              status: 'success',
              input: { query: 'Mastra' },
              outputSummary: '{"query":"Mastra","results":[]}',
            },
          ],
        },
      },
    ])
  })

  it('streams the organized prompt messages instead of only the latest content', async () => {
    const streamMock = vi.fn(async () => ({ fullStream: asyncGenerator([]) }))
    createChatAgentMock.mockReturnValue({ stream: streamMock })

    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'Summarize it again.',
      prompt: createPrompt('Summarize it again.'),
      model: 'gpt-4o',
      maxSteps: 4,
    })) {
      // consume stream
    }

    expect(streamMock).toHaveBeenCalledWith([
      { role: 'system', content: 'Persona prompt\n\n---\nActive app: Editor\nClipboard:\nCopied context' },
      { role: 'user', content: 'What did I ask earlier?' },
      { role: 'assistant', content: 'You asked about agents.' },
      { role: 'user', content: 'Summarize it again.' },
    ], { maxSteps: 4 })
  })

  it('returns a testable async event stream with a done trace', async () => {
    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      prompt: createPrompt(),
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

async function collectEvents(stream: AsyncGenerator<ChatAgentRuntimeEvent>): Promise<ChatAgentRuntimeEvent[]> {
  const events: ChatAgentRuntimeEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}
async function* asyncGenerator(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}
