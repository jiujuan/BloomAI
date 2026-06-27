import { classifyIntentWithLlm, createSafeAnswerOnlyDecision } from './llm-intent-classifier'
import type { IntentClassifierDependencies } from './llm-intent-classifier'
import { PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD, detectProgrammaticIntent } from './programmatic-intent-detector'
import type { ChatIntentDecision, ChatIntentInput, ChatIntentMode } from './types'
import { validateChatIntentDecision } from './types'

export type ChatIntentRouterDependencies = {
  detectProgrammaticIntent?: (input: ChatIntentInput) => ChatIntentDecision
  classifyIntentWithLlm?: (
    input: ChatIntentInput,
    programmaticDecision?: ChatIntentDecision,
    dependencies?: IntentClassifierDependencies,
  ) => Promise<ChatIntentDecision>
  classifierDependencies?: IntentClassifierDependencies
}

export async function resolveChatIntent(
  input: ChatIntentInput,
  dependencies: ChatIntentRouterDependencies = {},
): Promise<ChatIntentDecision> {
  const runProgrammatic = dependencies.detectProgrammaticIntent ?? detectProgrammaticIntent
  const runClassifier = dependencies.classifyIntentWithLlm ?? classifyIntentWithLlm
  const programmaticDecision = normalizeIntentDecision(runProgrammatic(input), input)

  if (isHighConfidenceProgrammaticDecision(programmaticDecision)) {
    return programmaticDecision
  }

  try {
    const classifierDecision = await runClassifier(input, programmaticDecision, dependencies.classifierDependencies)
    return normalizeIntentDecision(classifierDecision, input)
  } catch {
    return createSafeAnswerOnlyDecision('Intent classifier failed')
  }
}

export function normalizeIntentDecision(decision: ChatIntentDecision, input: ChatIntentInput): ChatIntentDecision {
  if (decision.mode === 'answer_only') {
    return {
      ...decision,
      selectedTools: [],
      selectedSkills: [],
    }
  }

  const selectedTools = filterEnabledIds(decision.selectedTools, input.availableTools)
  const selectedSkills = filterEnabledIds(decision.selectedSkills, input.availableSkills)
  const mode = normalizeMode(decision.mode, selectedTools, selectedSkills)

  if (requiresCapability(mode) && selectedTools.length === 0 && selectedSkills.length === 0) {
    return createSafeAnswerOnlyDecision('Intent decision selected no enabled capabilities')
  }

  const normalized: ChatIntentDecision = {
    ...decision,
    mode,
    selectedTools: mode === 'answer_only' ? [] : selectedTools,
    selectedSkills: mode === 'answer_only' ? [] : selectedSkills,
  }

  const validation = validateChatIntentDecision(normalized)
  if (!validation.ok) return createSafeAnswerOnlyDecision(validation.error)

  return normalized
}

export function isHighConfidenceProgrammaticDecision(decision: ChatIntentDecision): boolean {
  return decision.source === 'programmatic'
    && decision.mode !== 'unknown'
    && decision.confidence >= PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD
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