import type { ResearchEvidenceDto, ResearchQuestionDto, ResearchReportSectionDto } from '@shared/deepresearch/contracts'

const SECTION_INTENT_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'executive-summary': ['current-state', 'market-sizing', 'positioning', 'recent-work'],
  'findings-by-question': ['definition', 'history', 'mechanism', 'stakeholders', 'evidence'],
  'alternative-explanations': ['disagreement'],
  implications: ['impacts', 'opportunities'],
  limitations: ['risks', 'open-questions'],
  'market-definition': ['market-definition'],
  'market-sizing': ['market-sizing'],
  'growth-and-drivers': ['growth', 'demand-drivers'],
  'customer-segments': ['customer-segments'],
  'competitive-structure': ['competitive-structure'],
  'risks-and-opportunities': ['risks', 'opportunities'],
  positioning: ['positioning', 'target-customers'],
  'capability-comparison': ['product-capabilities', 'technical-approach'],
  'pricing-and-packaging': ['pricing'],
  'channels-and-partners': ['channels', 'partners'],
  'strengths-and-weaknesses': ['strengths', 'weaknesses'],
  'strategic-risks': ['strategic-risks'],
  terminology: ['terminology'],
  'literature-review': ['theoretical-lineage', 'foundational-work', 'recent-work'],
  'methodology-review': ['methods', 'datasets'],
  findings: ['findings'],
  'consensus-and-controversies': ['consensus', 'controversies'],
  'limitations-and-gaps': ['limitations', 'research-gaps'],
})

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function selectMappedEvidence(questionIds: readonly string[], evidence: ResearchEvidenceDto[]): ResearchEvidenceDto[] {
  const byQuestion = new Map<string, ResearchEvidenceDto[]>()
  for (const item of evidence) {
    const items = byQuestion.get(item.questionId) ?? []
    items.push(item)
    byQuestion.set(item.questionId, items)
  }
  // Preserve mapping order and reserve room for every mapped question; do not let
  // the first question's passages starve the rest of a one-to-many section.
  return questionIds.flatMap((questionId) => (byQuestion.get(questionId) ?? []).slice(0, 2))
}

/**
 * Routes section work to its explicitly persisted questions. New DRQ-03 sections
 * receive no evidence when their mapping is empty; legacy title/intent routing is
 * retained only for sections without a stable key, and never broadcasts all Run evidence.
 */
export function selectEvidenceForSection(
  section: ResearchReportSectionDto,
  questions: ResearchQuestionDto[],
  evidence: ResearchEvidenceDto[],
  mappedQuestionIds?: readonly string[],
): ResearchEvidenceDto[] {
  if (mappedQuestionIds !== undefined) return selectMappedEvidence(mappedQuestionIds, evidence)
  if (section.sectionKey) return []

  const title = normalize(section.title)
  const aliases = new Set(SECTION_INTENT_ALIASES[title] ?? [])
  const matchingQuestionIds = new Set(
    questions
      .filter((question) => {
        const intent = normalize(question.intent)
        return aliases.has(intent) || title === intent || title.includes(intent) || intent.includes(title)
      })
      .map((question) => question.id),
  )

  if (matchingQuestionIds.size === 0) return []

  const questionOrdinals = new Map(questions.map((question) => [question.id, question.ordinal]))
  return evidence
    .filter((item) => matchingQuestionIds.has(item.questionId))
    .sort((left, right) => (questionOrdinals.get(left.questionId) ?? Number.MAX_SAFE_INTEGER) - (questionOrdinals.get(right.questionId) ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 3)
}
