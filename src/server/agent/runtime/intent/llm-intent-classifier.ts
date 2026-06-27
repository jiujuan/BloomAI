import type { LlmMessage } from '../../../llm/types'
import type { ChatIntentDecision, ChatIntentInput, ChatIntentMode } from './types'
import { createAnswerOnlyDecision, validateChatIntentDecision } from './types'

export type IntentClassifierDependencies = {
  completeText?: (messages: LlmMessage[]) => Promise<string>
}

const VALID_MODES = new Set<ChatIntentMode>(['answer_only', 'tool', 'skill', 'tool_and_skill', 'unknown'])

export async function classifyIntentWithLlm(
  input: ChatIntentInput,
  programmaticDecision?: ChatIntentDecision,
  dependencies: IntentClassifierDependencies = {},
): Promise<ChatIntentDecision> {
  if (!dependencies.completeText) {
    return createSafeAnswerOnlyDecision('Intent classifier unavailable')
  }

  try {
    const raw = await dependencies.completeText(buildIntentClassificationPrompt(input, programmaticDecision))
    return parseIntentClassifierOutput(raw, input)
  } catch {
    return createSafeAnswerOnlyDecision('Intent classifier failed')
  }
}

export function buildIntentClassificationPrompt(
  input: ChatIntentInput,
  programmaticDecision?: ChatIntentDecision,
): LlmMessage[] {
  const enabledTools = input.availableTools.filter((tool) => tool.enabled)
  const enabledSkills = input.availableSkills.filter((skill) => skill.enabled)
  const programmaticContext = programmaticDecision
    ? `\nProgrammatic first-pass decision:\n${JSON.stringify(programmaticDecision)}`
    : ''

  return [
    {
      role: 'system',
      content: [
        'You are an intent classifier for an internal chat agent runtime.',
        'Return JSON only. Do not answer the user question.',
        'Choose whether the chat runtime should answer directly, use tools, use skills, use both, or mark intent unknown.',
        'Allowed modes: answer_only, tool, skill, tool_and_skill, unknown.',
        'Only select tools and skills from the enabled capability lists provided by the user message.',
        'Return this exact JSON shape: {"mode":"answer_only|tool|skill|tool_and_skill|unknown","confidence":0.0,"reason":"short reason","selectedTools":[],"selectedSkills":[]}.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Session: ${input.sessionId}`,
        `User content: ${input.content}`,
        `Enabled tools: ${JSON.stringify(enabledTools.map((tool) => ({ id: tool.id, name: tool.name, description: tool.description, paramsSchema: tool.paramsSchema })))}`,
        `Enabled skills: ${JSON.stringify(enabledSkills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, type: skill.type, paramsSchema: skill.paramsSchema })))}`,
        programmaticContext,
      ].join('\n'),
    },
  ]
}

export function parseIntentClassifierOutput(raw: string, input: ChatIntentInput): ChatIntentDecision {
  const parsed = parseJsonObject(raw)
  if (!parsed) return createSafeAnswerOnlyDecision('Invalid classifier JSON')

  const mode = typeof parsed.mode === 'string' && VALID_MODES.has(parsed.mode as ChatIntentMode)
    ? parsed.mode as ChatIntentMode
    : 'unknown'
  const confidence = normalizeConfidence(parsed.confidence)
  const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
    ? parsed.reason.trim()
    : 'Classified by LLM intent classifier'
  const selectedTools = filterEnabledIds(toStringArray(parsed.selectedTools), input.availableTools)
  const selectedSkills = filterEnabledIds(toStringArray(parsed.selectedSkills), input.availableSkills)

  const normalizedMode = normalizeMode(mode, selectedTools, selectedSkills)
  if (requiresCapability(normalizedMode) && selectedTools.length === 0 && selectedSkills.length === 0) {
    return createSafeAnswerOnlyDecision('Classifier selected no enabled capabilities')
  }

  const decision: ChatIntentDecision = {
    mode: normalizedMode,
    source: 'llm_classifier',
    confidence,
    reason,
    selectedTools: normalizedMode === 'answer_only' ? [] : selectedTools,
    selectedSkills: normalizedMode === 'answer_only' ? [] : selectedSkills,
  }

  const validation = validateChatIntentDecision(decision)
  if (!validation.ok) return createSafeAnswerOnlyDecision(validation.error)

  return decision
}

export function createSafeAnswerOnlyDecision(reason: string): ChatIntentDecision {
  return createAnswerOnlyDecision(reason, 'fallback')
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function filterEnabledIds<T extends { id: string; enabled: boolean }>(ids: string[], capabilities: T[]): string[] {
  const enabledIds = new Set(capabilities.filter((capability) => capability.enabled).map((capability) => capability.id))
  return Array.from(new Set(ids.filter((id) => enabledIds.has(id))))
}

function normalizeMode(mode: ChatIntentMode, selectedTools: string[], selectedSkills: string[]): ChatIntentMode {
  if (mode === 'answer_only') return 'answer_only'
  if (mode === 'tool_and_skill') {
    if (selectedTools.length > 0 && selectedSkills.length > 0) return 'tool_and_skill'
    if (selectedTools.length > 0) return 'tool'
    if (selectedSkills.length > 0) return 'skill'
    return 'tool_and_skill'
  }
  if (mode === 'tool' && selectedTools.length === 0 && selectedSkills.length > 0) return 'skill'
  if (mode === 'skill' && selectedSkills.length === 0 && selectedTools.length > 0) return 'tool'
  return mode
}

function requiresCapability(mode: ChatIntentMode): boolean {
  return mode === 'tool' || mode === 'skill' || mode === 'tool_and_skill'
}