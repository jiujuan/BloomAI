import type { ChatIntentDecision, ChatIntentInput, SkillCapability, ToolCapability } from './types'

export const PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD = 0.8

const HIGH_CONFIDENCE = 0.95
const LOW_CONFIDENCE = 0.2

const WEB_SEARCH_SIGNALS = [
  /\b(latest|current|today|news|recent|up[-\s]?to[-\s]?date|look up|search|web|online|docs?|documentation|price|version)\b/i,
  /(\u6700\u65b0|\u4eca\u5929|\u65b0\u95fb|\u5f53\u524d|\u73b0\u5728|\u8fd1\u671f|\u67e5\u4e00\u4e0b|\u641c\u7d22|\u8054\u7f51|\u7f51\u4e0a|\u6587\u6863|\u4ef7\u683c|\u7248\u672c)/,
]

const ANSWER_ONLY_SIGNALS = [
  /\b(translate|rewrite|explain|summari[sz]e|proofread|polish)\b/i,
  /(\u7ffb\u8bd1|\u6539\u5199|\u89e3\u91ca|\u8bf4\u660e|\u603b\u7ed3|\u6da6\u8272|\u6821\u5bf9)/,
]

const SKILL_REQUEST_SIGNALS = [
  /\b(use|run|execute|call|invoke)\s+(?:the\s+)?skill\b/i,
  /\b(use|run|execute|call|invoke)\b/i,
  /\bskill\b/i,
  /(\u8fd0\u884c|\u6267\u884c|\u8c03\u7528|\u4f7f\u7528).{0,8}skill/i,
  /(\u8fd0\u884c|\u6267\u884c|\u8c03\u7528|\u4f7f\u7528)/,
]

export function detectProgrammaticIntent(input: ChatIntentInput): ChatIntentDecision {
  const selectedTools = findExplicitToolSignals(input.content, input.availableTools)
  const selectedSkills = findExplicitSkillSignals(input.content, input.availableSkills)

  if (selectedTools.length > 0 && selectedSkills.length > 0) {
    return createDecision('tool_and_skill', HIGH_CONFIDENCE, 'Explicit tool and skill request', selectedTools, selectedSkills)
  }

  if (selectedTools.length > 0) {
    return createDecision('tool', HIGH_CONFIDENCE, 'Explicit current or external information request', selectedTools, [])
  }

  if (selectedSkills.length > 0) {
    return createDecision('skill', HIGH_CONFIDENCE, 'Explicit skill request', [], selectedSkills)
  }

  if (hasAnswerOnlySignal(input.content)) {
    return createDecision('answer_only', HIGH_CONFIDENCE, 'Plain answer request without external capabilities', [], [])
  }

  return createDecision('unknown', LOW_CONFIDENCE, 'Programmatic rules could not determine intent', [], [])
}

export function findExplicitToolSignals(content: string, availableTools: ToolCapability[]): string[] {
  const webSearch = availableTools.find((tool) => tool.id === 'web_search' && tool.enabled)
  if (!webSearch) return []

  return hasAnySignal(content, WEB_SEARCH_SIGNALS) ? [webSearch.id] : []
}

export function findExplicitSkillSignals(content: string, availableSkills: SkillCapability[]): string[] {
  if (!hasAnySignal(content, SKILL_REQUEST_SIGNALS)) return []

  const normalizedContent = normalizeForMatching(content)
  const explicitSkills = availableSkills
    .filter((skill) => skill.enabled)
    .filter((skill) => {
      const id = normalizeForMatching(skill.id)
      const name = normalizeForMatching(skill.name)
      return normalizedContent.includes(id) || normalizedContent.includes(name)
    })
    .map((skill) => skill.id)

  return Array.from(new Set(explicitSkills))
}

function hasAnswerOnlySignal(content: string): boolean {
  return hasAnySignal(content, ANSWER_ONLY_SIGNALS)
}

function hasAnySignal(content: string, signals: RegExp[]): boolean {
  return signals.some((signal) => signal.test(content))
}

function normalizeForMatching(value: string): string {
  return value.trim().toLowerCase()
}

function createDecision(
  mode: ChatIntentDecision['mode'],
  confidence: number,
  reason: string,
  selectedTools: string[],
  selectedSkills: string[],
): ChatIntentDecision {
  return {
    mode,
    source: 'programmatic',
    confidence,
    reason,
    selectedTools,
    selectedSkills,
  }
}