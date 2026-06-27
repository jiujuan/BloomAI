import type { OrganizedChatPrompt } from '../../../prompts/types'

export type ChatIntentMode = 'answer_only' | 'tool' | 'skill' | 'tool_and_skill' | 'unknown'

export type ChatIntentSource = 'programmatic' | 'llm_classifier' | 'fallback'

export type JsonObject = Record<string, unknown>

export type ToolCapability = {
  kind: 'tool'
  id: string
  name: string
  description: string
  enabled: boolean
  paramsSchema: JsonObject
  disabledReason?: string
}

export type SkillCapability = {
  kind: 'skill'
  id: string
  name: string
  description: string
  type: string
  enabled: boolean
  paramsSchema: JsonObject
  disabledReason?: string
}

export type ChatIntentInput = {
  sessionId: string
  content: string
  prompt: OrganizedChatPrompt
  availableTools: ToolCapability[]
  availableSkills: SkillCapability[]
}

export type ChatIntentDecision = {
  mode: ChatIntentMode
  source: ChatIntentSource
  confidence: number
  reason: string
  selectedTools: string[]
  selectedSkills: string[]
}

export type ChatIntentValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export function createAnswerOnlyDecision(reason: string, source: ChatIntentSource = 'programmatic'): ChatIntentDecision {
  return {
    mode: 'answer_only',
    source,
    confidence: 1,
    reason,
    selectedTools: [],
    selectedSkills: [],
  }
}

export function validateChatIntentDecision(decision: ChatIntentDecision): ChatIntentValidationResult {
  if (decision.mode === 'answer_only' && (decision.selectedTools.length > 0 || decision.selectedSkills.length > 0)) {
    return { ok: false, error: 'answer_only decisions cannot select tools or skills' }
  }

  if (decision.confidence < 0 || decision.confidence > 1) {
    return { ok: false, error: 'confidence must be between 0 and 1' }
  }

  return { ok: true }
}
