import type { ResearchEvidenceDto, ResearchQuestionDto, ResearchReportSectionDto } from '@shared/deepresearch/contracts'

const SECTION_INTENT_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'executive-summary': ['current-state', 'market-sizing', 'positioning', 'recent-work'],
  'findings-by-question': ['definition', 'history', 'mechanism', 'stakeholders', 'evidence'],
  'alternative-explanations': ['disagreement'],
  implications: ['impacts'],
  limitations: ['open-questions', 'research-gaps'],
  'growth-and-drivers': ['growth', 'demand-drivers'],
  'risks-and-opportunities': ['risks', 'opportunities'],
  'capability-comparison': ['product-capabilities'],
  'pricing-and-packaging': ['pricing'],
  'channels-and-partners': ['channels', 'partners'],
  'strengths-and-weaknesses': ['strengths', 'weaknesses'],
  'literature-review': ['theoretical-lineage', 'foundational-work', 'recent-work'],
  'methodology-review': ['methods', 'datasets'],
  'consensus-and-controversies': ['consensus', 'controversies'],
  'limitations-and-gaps': ['limitations', 'research-gaps'],
})

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Routes section work to the evidence for the questions that section covers.
 * A section without a semantic match intentionally receives no evidence: using
 * every run's first passages is what caused different sections to repeat.
 */
export function selectEvidenceForSection(
  section: ResearchReportSectionDto,
  questions: ResearchQuestionDto[],
  evidence: ResearchEvidenceDto[],
): ResearchEvidenceDto[] {
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
