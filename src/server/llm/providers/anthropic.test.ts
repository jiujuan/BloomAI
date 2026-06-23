import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ResolvedLlmModel } from '../types'

const anthropicMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  stream: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicMock.constructor,
}))

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

function createResolved(): ResolvedLlmModel {
  return {
    provider: {
      id: 'anthropic',
      name: 'Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKeySettingKey: 'anthropic_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: 'claude-3-5-sonnet-20241022',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 10,
    },
  }
}

async function loadProvider() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  return import('./anthropic')
}

function createSdkStream(): { on: any; finalMessage: any } {
  const handlers: Record<string, (value: any) => void> = {}
  const sdkStream: { on: any; finalMessage: any } = {
    on: vi.fn((event: string, handler: (value: any) => void) => {
      handlers[event] = handler
      return sdkStream
    }),
    finalMessage: vi.fn(async () => {
      handlers.text?.('Hello')
      handlers.text?.(' world')
      handlers.message?.({ usage: { input_tokens: 7, output_tokens: 9 } })
      return { usage: { input_tokens: 7, output_tokens: 9 } }
    }),
  }
  return sdkStream
}

async function collectEvents(generator: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

describe('Anthropic provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-anthropic-provider-'))
    originalEnv = { ...process.env }
    anthropicMock.constructor.mockReset()
    anthropicMock.stream.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('sends the expected Anthropic request shape', async () => {
    const sdkStream = createSdkStream()
    anthropicMock.stream.mockReturnValue(sdkStream)
    anthropicMock.constructor.mockImplementation(() => ({ messages: { stream: anthropicMock.stream } }))
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

    const { createAnthropicProvider } = await loadProvider()
    const provider = createAnthropicProvider(createResolved())

    await collectEvents(
      provider.streamChat({
        model: 'claude-3-5-sonnet-20241022',
        system: 'System prompt',
        messages: [
          { role: 'system', content: 'Skip me' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
        maxTokens: 123,
      })
    )

    expect(anthropicMock.constructor).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' })
    expect(anthropicMock.stream).toHaveBeenCalledWith({
      model: 'claude-3-5-sonnet-20241022',
      system: 'System prompt',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
      max_tokens: 123,
    })
  })

  it('emits delta, usage, and done events', async () => {
    anthropicMock.stream.mockReturnValue(createSdkStream())
    anthropicMock.constructor.mockImplementation(() => ({ messages: { stream: anthropicMock.stream } }))
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

    const { createAnthropicProvider } = await loadProvider()
    const provider = createAnthropicProvider(createResolved())

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'usage', input: 7, output: 9 },
      { type: 'done' },
    ])
  })

  it('throws a typed config error when the API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const { createAnthropicProvider } = await loadProvider()
    const { LlmConfigError } = await import('../errors')
    const provider = createAnthropicProvider(createResolved())

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      )
    ).rejects.toBeInstanceOf(LlmConfigError)
  })
})
