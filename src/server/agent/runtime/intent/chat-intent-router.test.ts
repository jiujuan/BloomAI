import { describe, expect, it, vi } from 'vitest'
import type { OrganizedChatPrompt } from '../../../prompts/types'
import type { ChatIntentDecision, ChatIntentInput, SkillCapability, ToolCapability } from './types'
import {
  isHighConfidenceProgrammaticDecision,
  normalizeIntentDecision,
  resolveChatIntent,
} from './chat-intent-router'

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
  description: 'Summarize selected text',
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

function createInput(content = 'help me decide'): ChatIntentInput {
  return {
    sessionId: 'session-1',
    content,
    prompt: createPrompt(content),
    availableTools: [webSearchTool, disabledTool],
    availableSkills: [summarizerSkill],
  }
}

function decision(overrides: Partial<ChatIntentDecision>): ChatIntentDecision {
  return {
    mode: 'unknown',
    source: 'programmatic',
    confidence: 0.2,
    reason: 'default test decision',
    selectedTools: [],
    selectedSkills: [],
    ...overrides,
  }
}

describe('two-layer chat intent router', () => {
  it('returns a high-confidence programmatic decision without calling the LLM classifier', async () => {
    const programmaticDecision = decision({
      mode: 'tool',
      confidence: 0.95,
      selectedTools: ['web_search'],
    })
    const detectProgrammaticIntent = vi.fn(() => programmaticDecision)
    const classifyIntentWithLlm = vi.fn()

    await expect(resolveChatIntent(createInput('latest news'), {
      detectProgrammaticIntent,
      classifyIntentWithLlm,
    })).resolves.toEqual(programmaticDecision)
    expect(detectProgrammaticIntent).toHaveBeenCalledOnce()
    expect(classifyIntentWithLlm).not.toHaveBeenCalled()
  })

  it('calls the LLM classifier for low-confidence programmatic decisions', async () => {
    const programmaticDecision = decision({ reason: 'Ambiguous request' })
    const classifierDecision = decision({
      mode: 'skill',
      source: 'llm_classifier',
      confidence: 0.72,
      selectedSkills: ['summarizer'],
    })
    const detectProgrammaticIntent = vi.fn(() => programmaticDecision)
    const classifyIntentWithLlm = vi.fn(async () => classifierDecision)

    await expect(resolveChatIntent(createInput(), {
      detectProgrammaticIntent,
      classifyIntentWithLlm,
    })).resolves.toEqual(classifierDecision)
    expect(classifyIntentWithLlm).toHaveBeenCalledWith(createInput(), programmaticDecision, undefined)
  })

  it('falls back to safe answer_only when the LLM classifier throws', async () => {
    const detectProgrammaticIntent = vi.fn(() => decision({ confidence: 0.1 }))
    const classifyIntentWithLlm = vi.fn(async () => {
      throw new Error('classifier failed')
    })

    await expect(resolveChatIntent(createInput(), {
      detectProgrammaticIntent,
      classifyIntentWithLlm,
    })).resolves.toEqual(expect.objectContaining({
      mode: 'answer_only',
      source: 'fallback',
      selectedTools: [],
      selectedSkills: [],
    }))
  })

  it('normalizes answer_only decisions by clearing selected capabilities', () => {
    expect(normalizeIntentDecision(decision({
      mode: 'answer_only',
      confidence: 0.9,
      selectedTools: ['web_search'],
      selectedSkills: ['summarizer'],
    }), createInput())).toEqual(expect.objectContaining({
      mode: 'answer_only',
      selectedTools: [],
      selectedSkills: [],
    }))
  })

  it('filters disabled and unknown capabilities from final decisions', () => {
    expect(normalizeIntentDecision(decision({
      mode: 'tool_and_skill',
      confidence: 0.9,
      selectedTools: ['web_search', 'disabled_search', 'unknown_tool'],
      selectedSkills: ['summarizer', 'unknown_skill'],
    }), createInput())).toEqual(expect.objectContaining({
      mode: 'tool_and_skill',
      selectedTools: ['web_search'],
      selectedSkills: ['summarizer'],
    }))
  })

  it('falls back when a capability mode has no valid selected capability after filtering', () => {
    expect(normalizeIntentDecision(decision({
      mode: 'tool',
      confidence: 0.9,
      selectedTools: ['unknown_tool'],
    }), createInput())).toEqual(expect.objectContaining({
      mode: 'answer_only',
      source: 'fallback',
      selectedTools: [],
      selectedSkills: [],
    }))
  })

  it('uses the documented high-confidence threshold', () => {
    expect(isHighConfidenceProgrammaticDecision(decision({ mode: 'tool', confidence: 0.8, selectedTools: ['web_search'] }))).toBe(true)
    expect(isHighConfidenceProgrammaticDecision(decision({ mode: 'unknown', confidence: 1 }))).toBe(false)
    expect(isHighConfidenceProgrammaticDecision(decision({ mode: 'tool', confidence: 0.79, selectedTools: ['web_search'] }))).toBe(false)
  })
})