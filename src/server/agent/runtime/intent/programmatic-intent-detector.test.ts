import { describe, expect, it } from 'vitest'
import type { OrganizedChatPrompt } from '../../../prompts/types'
import type { ChatIntentInput, SkillCapability, ToolCapability } from './types'
import { PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD, detectProgrammaticIntent } from './programmatic-intent-detector'

const webSearchTool: ToolCapability = {
  kind: 'tool',
  id: 'web_search',
  name: 'Web search',
  description: 'Search the web',
  enabled: true,
  paramsSchema: { type: 'object' },
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

function createInput(
  content: string,
  overrides: Partial<Pick<ChatIntentInput, 'availableTools' | 'availableSkills'>> = {},
): ChatIntentInput {
  return {
    sessionId: 'session-1',
    content,
    prompt: createPrompt(content),
    availableTools: overrides.availableTools ?? [webSearchTool],
    availableSkills: overrides.availableSkills ?? [summarizerSkill],
  }
}

describe('programmatic chat intent detector', () => {
  it('selects web_search for high-confidence current information requests', () => {
    const decision = detectProgrammaticIntent(createInput('今天 OpenAI 有什么新闻？'))

    expect(decision).toEqual(expect.objectContaining({
      mode: 'tool',
      source: 'programmatic',
      selectedTools: ['web_search'],
      selectedSkills: [],
    }))
    expect(decision.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('selects web_search for high-confidence latest docs requests in English', () => {
    const decision = detectProgrammaticIntent(createInput('Look up the latest React 19 docs'))

    expect(decision.mode).toBe('tool')
    expect(decision.selectedTools).toEqual(['web_search'])
    expect(decision.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('selects answer_only for ordinary translation, rewrite, explain, and summarize requests', () => {
    const translation = detectProgrammaticIntent(createInput('把这段话翻译成英文：你好'))
    const summary = detectProgrammaticIntent(createInput('总结我刚才问过什么'))

    expect(translation).toEqual(expect.objectContaining({
      mode: 'answer_only',
      selectedTools: [],
      selectedSkills: [],
    }))
    expect(summary).toEqual(expect.objectContaining({
      mode: 'answer_only',
      selectedTools: [],
      selectedSkills: [],
    }))
    expect(translation.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
    expect(summary.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('selects an explicitly requested enabled skill by id or name', () => {
    const byId = detectProgrammaticIntent(createInput('运行 skill summarizer 处理这段内容'))
    const byName = detectProgrammaticIntent(createInput('Use Summarizer on this note'))

    expect(byId).toEqual(expect.objectContaining({
      mode: 'skill',
      selectedTools: [],
      selectedSkills: ['summarizer'],
    }))
    expect(byName.selectedSkills).toEqual(['summarizer'])
    expect(byId.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('selects tool_and_skill when both web search and a skill are explicit', () => {
    const decision = detectProgrammaticIntent(createInput('查一下 React 19 最新文档，然后运行 skill summarizer 总结'))

    expect(decision).toEqual(expect.objectContaining({
      mode: 'tool_and_skill',
      selectedTools: ['web_search'],
      selectedSkills: ['summarizer'],
    }))
    expect(decision.confidence).toBeGreaterThanOrEqual(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('returns a low-confidence unknown decision for ambiguous requests', () => {
    const decision = detectProgrammaticIntent(createInput('帮我处理这个任务'))

    expect(decision).toEqual(expect.objectContaining({
      mode: 'unknown',
      source: 'programmatic',
      selectedTools: [],
      selectedSkills: [],
    }))
    expect(decision.confidence).toBeLessThan(PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD)
  })

  it('only selects enabled capabilities', () => {
    const disabledTool = { ...webSearchTool, enabled: false }
    const disabledSkill = { ...summarizerSkill, enabled: false }

    const searchDecision = detectProgrammaticIntent(createInput('查一下 React 19 最新文档', {
      availableTools: [disabledTool],
    }))
    const skillDecision = detectProgrammaticIntent(createInput('运行 skill summarizer', {
      availableSkills: [disabledSkill],
    }))

    expect(searchDecision).toEqual(expect.objectContaining({
      mode: 'unknown',
      selectedTools: [],
      selectedSkills: [],
    }))
    expect(skillDecision).toEqual(expect.objectContaining({
      mode: 'unknown',
      selectedTools: [],
      selectedSkills: [],
    }))
  })
})
