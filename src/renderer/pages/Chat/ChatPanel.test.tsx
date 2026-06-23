import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmModelSummary } from '@renderer/api'
import { AVAILABLE_MODELS } from '@shared/constants'

const platformMock = vi.hoisted(() => ({
  getLlmModels: vi.fn(),
  updateSession: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  platform: platformMock,
}))

function textModel(id: string, providerId: string, label = id): LlmModelSummary {
  return {
    id,
    providerId,
    modelId: id,
    label,
    modality: 'text',
    capabilities: {},
    isEnabled: true,
    isBuiltin: true,
    sortOrder: 0,
  }
}

describe('chat model dropdown data', () => {
  beforeEach(() => {
    vi.resetModules()
    platformMock.getLlmModels.mockReset()
    platformMock.updateSession.mockReset()
  })

  it('builds dropdown options from backend text models', async () => {
    const { getChatModelOptions } = await import('./ChatPanel')

    const options = getChatModelOptions([
      textModel('gpt-4o', 'openai'),
      textModel('agnes-2.0-flash', 'agnes', 'Agnes 2.0 Flash'),
      textModel('deepseek-chat', 'deepseek', 'DeepSeek Chat'),
      textModel('claude-3-5-sonnet-20241022', 'anthropic', 'Claude 3.5 Sonnet'),
    ])

    expect(options.map(option => option.id)).toEqual([
      'gpt-4o',
      'agnes-2.0-flash',
      'deepseek-chat',
      'claude-3-5-sonnet-20241022',
    ])
    expect(options.map(option => option.provider)).toEqual(['OpenAI', 'Agnes', 'DeepSeek', 'Anthropic'])
  })

  it('falls back to bundled chat models when backend models are unavailable', async () => {
    const { getChatModelOptions } = await import('./ChatPanel')

    const options = getChatModelOptions([])

    expect(options.map(option => option.id)).toEqual(AVAILABLE_MODELS.map(model => model.id))
  })

  it('loads only backend text models for chat', async () => {
    platformMock.getLlmModels.mockResolvedValue([textModel('gpt-4o', 'openai')])
    const { useLlmStore } = await import('@renderer/store')

    await useLlmStore.getState().loadTextModels()

    expect(platformMock.getLlmModels).toHaveBeenCalledWith('text')
    expect(useLlmStore.getState().textModels.map(model => model.id)).toEqual(['gpt-4o'])
  })

  it('uses the settings model for legacy default session models', async () => {
    const { resolveDisplayedChatModel } = await import('./ChatPanel')

    expect(resolveDisplayedChatModel('claude-3-5-sonnet-20241022', 'agnes-2.0-flash')).toBe('agnes-2.0-flash')
    expect(resolveDisplayedChatModel('gpt-4o', 'agnes-2.0-flash')).toBe('gpt-4o')
  })

  it('shows the streaming assistant bubble before the first response token arrives', async () => {
    const { shouldShowStreamingBubble } = await import('./Timeline')

    expect(shouldShowStreamingBubble(true, '')).toBe(true)
    expect(shouldShowStreamingBubble(true, 'Hello')).toBe(true)
    expect(shouldShowStreamingBubble(false, '')).toBe(false)
  })

  it('persists a selected model and reloads sessions', async () => {
    const loadSessions = vi.fn()
    const { useSessionStore } = await import('@renderer/store')
    const { persistChatModelSelection } = await import('./ChatPanel')
    useSessionStore.setState({ loadSessions })

    await persistChatModelSelection('session-1', 'agnes-2.0-flash')

    expect(platformMock.updateSession).toHaveBeenCalledWith('session-1', { model: 'agnes-2.0-flash' })
    expect(loadSessions).toHaveBeenCalled()
  })
})
