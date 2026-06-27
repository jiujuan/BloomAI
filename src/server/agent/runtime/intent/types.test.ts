import { describe, expect, it } from 'vitest'
import type { OrganizedChatPrompt } from '../../../prompts/types'
import type { ChatIntentInput } from './types'
import { createAnswerOnlyDecision, validateChatIntentDecision } from './types'

function createPrompt(): OrganizedChatPrompt {
  return {
    system: 'System prompt',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 4096,
  }
}

describe('chat intent contract', () => {
  it('models intent input around an organized chat prompt and available capabilities', () => {
    const input: ChatIntentInput = {
      sessionId: 'session-1',
      content: 'search the web',
      prompt: createPrompt(),
      availableTools: [
        {
          kind: 'tool',
          id: 'web_search',
          name: 'Web search',
          description: 'Search the web',
          enabled: true,
          paramsSchema: { type: 'object' },
        },
      ],
      availableSkills: [],
    }

    expect(input.prompt.messages[0]).toEqual({ role: 'user', content: 'hello' })
    expect(input.availableTools[0].id).toBe('web_search')
  })

  it('validates that answer_only decisions do not select tools or skills', () => {
    expect(validateChatIntentDecision(createAnswerOnlyDecision('plain answer'))).toEqual({ ok: true })

    expect(validateChatIntentDecision({
      mode: 'answer_only',
      source: 'programmatic',
      confidence: 1,
      reason: 'invalid selection',
      selectedTools: ['web_search'],
      selectedSkills: [],
    })).toEqual({
      ok: false,
      error: 'answer_only decisions cannot select tools or skills',
    })
  })
})
