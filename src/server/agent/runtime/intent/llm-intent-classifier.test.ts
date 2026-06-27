import { describe, expect, it, vi } from 'vitest'
import type { LlmMessage } from '../../../llm/types'
import type { OrganizedChatPrompt } from '../../../prompts/types'
import type { ChatIntentDecision, ChatIntentInput, SkillCapability, ToolCapability } from './types'
import {
  buildIntentClassificationPrompt,
  classifyIntentWithLlm,
  createSafeAnswerOnlyDecision,
  parseIntentClassifierOutput,
} from './llm-intent-classifier'

const webSearchTool: ToolCapability = {
  kind: 'tool',
  id: 'web_search',
  name: 'Web search',
  description: 'Search the web',
  enabled: true,
  paramsSchema: { type: 'object' },
}

const disabledTool: ToolCapability = {
  ...webSearchTool,
  id: 'disabled_search',
  enabled: false,
}

const summarizerSkill: SkillCapability = {
  kind: 'skill',
  id: 'summarizer',
  name: 'Summarizer',
  description: 'Summarize provided text',
  type: 'prompt-template',
  enabled: true,
  paramsSchema: { type: 'object' },
}

function createPrompt(content: string): OrganizedChatPrompt {
  return {
    system: 'System prompt',
    messages: [{ role: 'user', content }],
    maxTokens: 4096,
  }
}

function createInput(content = 'Help me decide what capability is needed'): ChatIntentInput {
  return {
    sessionId: 'session-1',
    content,
    prompt: createPrompt(content),
    availableTools: [webSearchTool, disabledTool],
    availableSkills: [summarizerSkill],
  }
}

describe('LLM chat intent classifier', () => {
  it('builds a JSON-only classifier prompt that does not answer the user question', () => {
    const messages = buildIntentClassificationPrompt(createInput('What is the weather today?'))

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual(expect.objectContaining({ role: 'system' }))
    expect(messages[0].content).toContain('Return JSON only')
    expect(messages[0].content).toContain('Do not answer the user')
    expect(messages[1]).toEqual(expect.objectContaining({ role: 'user' }))
    expect(messages[1].content).toContain('web_search')
    expect(messages[1].content).toContain('summarizer')
    expect(messages[1].content).not.toContain('disabled_search')
  })

  it('parses legal JSON into an LLM classifier decision', () => {
    const decision = parseIntentClassifierOutput(JSON.stringify({
      mode: 'skill',
      confidence: 0.72,
      reason: 'The user explicitly wants a summarization skill.',
      selectedTools: [],
      selectedSkills: ['summarizer'],
    }), createInput())

    expect(decision).toEqual({
      mode: 'skill',
      source: 'llm_classifier',
      confidence: 0.72,
      reason: 'The user explicitly wants a summarization skill.',
      selectedTools: [],
      selectedSkills: ['summarizer'],
    })
  })

  it('falls back to answer_only for non-JSON classifier output', () => {
    const decision = parseIntentClassifierOutput('I would search the web.', createInput())

    expect(decision).toEqual(createSafeAnswerOnlyDecision('Invalid classifier JSON'))
  })

  it('filters disabled or unknown selected capabilities', () => {
    const decision = parseIntentClassifierOutput(JSON.stringify({
      mode: 'tool_and_skill',
      confidence: 0.9,
      reason: 'Needs multiple capabilities.',
      selectedTools: ['web_search', 'disabled_search', 'unknown_tool'],
      selectedSkills: ['summarizer', 'unknown_skill'],
    }), createInput())

    expect(decision).toEqual({
      mode: 'tool_and_skill',
      source: 'llm_classifier',
      confidence: 0.9,
      reason: 'Needs multiple capabilities.',
      selectedTools: ['web_search'],
      selectedSkills: ['summarizer'],
    })
  })

  it('falls back when classifier selects no valid capability for a capability mode', () => {
    const decision = parseIntentClassifierOutput(JSON.stringify({
      mode: 'tool',
      confidence: 0.8,
      reason: 'Invalid tool only.',
      selectedTools: ['unknown_tool'],
      selectedSkills: [],
    }), createInput())

    expect(decision).toEqual(createSafeAnswerOnlyDecision('Classifier selected no enabled capabilities'))
  })

  it('calls the injected LLM completion function and parses its result', async () => {
    const completeText = vi.fn(async (_messages: LlmMessage[]) => JSON.stringify({
      mode: 'tool',
      confidence: 0.67,
      reason: 'Needs current information.',
      selectedTools: ['web_search'],
      selectedSkills: [],
    }))

    await expect(classifyIntentWithLlm(createInput('Find current docs'), undefined, { completeText })).resolves.toEqual({
      mode: 'tool',
      source: 'llm_classifier',
      confidence: 0.67,
      reason: 'Needs current information.',
      selectedTools: ['web_search'],
      selectedSkills: [],
    })
    expect(completeText).toHaveBeenCalledOnce()
  })

  it('falls back to answer_only when LLM completion throws', async () => {
    const completeText = vi.fn(async () => {
      throw new Error('provider unavailable')
    })

    await expect(classifyIntentWithLlm(createInput(), undefined, { completeText })).resolves.toEqual(
      createSafeAnswerOnlyDecision('Intent classifier failed'),
    )
  })

  it('includes the low-confidence programmatic decision when provided', () => {
    const programmaticDecision: ChatIntentDecision = {
      mode: 'unknown',
      source: 'programmatic',
      confidence: 0.2,
      reason: 'Ambiguous request',
      selectedTools: [],
      selectedSkills: [],
    }

    const messages = buildIntentClassificationPrompt(createInput(), programmaticDecision)

    expect(messages[1].content).toContain('Ambiguous request')
    expect(messages[1].content).toContain('0.2')
  })
})