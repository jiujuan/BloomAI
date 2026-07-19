import { createHash } from 'node:crypto'
import { createStep } from '@mastra/core/workflows'
import { ResearchDomainError } from '@server/deepresearch/domain/errors'
import type { CitationService } from '@server/services/deepresearch/citation-service'
import type { SectionDraft, SectionWriter } from '../agents/section-writer'
import { reportSectionJobSchema } from './build-outline'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'
import { selectEvidenceForSection } from './section-evidence'

const OVERLAP_THRESHOLD = 0.82
const REQUIRED_HEADINGS = ['Direct answer', 'Comparison or classification', 'Evidence basis', 'Conditions and limitations'] as const

function normalizedTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/```[\s\S]*?```/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const words = normalized.split(/\s+/).filter((token) => token.length > 1)
  const cjk = [...normalized.replace(/[^\u3400-\u9fff]/g, '')].map((character, index, characters) => characters.slice(index, index + 2).join('')).filter((token) => token.length > 1)
  return new Set([...words, ...cjk])
}

function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = normalizedTokens(left)
  const rightTokens = normalizedTokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared++
  return shared / (leftTokens.size + rightTokens.size - shared)
}

function hasHeading(bodyMarkdown: string, heading: string): boolean {
  return new RegExp('^#{1,6}\\s+' + heading + '\\s*$', 'im').test(bodyMarkdown)
}

function headingContent(bodyMarkdown: string, heading: string): string {
  const headingMatch = new RegExp('^#{1,6}\\s+' + heading + '\\s*$', 'im').exec(bodyMarkdown)
  if (!headingMatch || headingMatch.index === undefined) return ''
  const start = headingMatch.index + headingMatch[0].length
  const nextHeading = /^#{1,6}\s+/gm
  nextHeading.lastIndex = start
  const next = nextHeading.exec(bodyMarkdown)
  return bodyMarkdown.slice(start, next?.index ?? bodyMarkdown.length).trim()
}

function isControlledSection(sectionKey: string | null | undefined): boolean {
  return sectionKey === 'scope-and-method' || sectionKey === 'references'
}

function validateDraft(draft: SectionDraft, allowedEvidenceIds: Set<string>, sectionKey?: string | null): SectionDraft {
  const checkIds = (ids: string[], label: string) => {
    if (ids.some((id) => !allowedEvidenceIds.has(id))) throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Section draft referenced out-of-scope evidence.', false, { label })
    return [...new Set(ids)]
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!hasHeading(draft.bodyMarkdown, heading) || !headingContent(draft.bodyMarkdown, heading)) {
      throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Section draft must include each required argument structure heading with content.', false, { heading })
    }
  }
  if (allowedEvidenceIds.size > 0 && headingContent(draft.bodyMarkdown, 'Direct answer').length < 12) {
    throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Section draft must provide a substantive direct answer when routed evidence exists.', false)
  }
  if (allowedEvidenceIds.size === 0 && !isControlledSection(sectionKey) && (!draft.limitations.length || !draft.missingEvidence.length)) {
    throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Evidence-insufficient sections must disclose limitations and missing evidence.', false)
  }
  const claims = draft.claims.map((claim) => {
    const evidenceIds = checkIds(claim.evidenceIds, 'claim')
    if (claim.kind === 'factual' && evidenceIds.length === 0) throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Factual section claims require routed evidence.', false, { text: claim.text })
    if (claim.kind === 'factual' && !draft.bodyMarkdown.includes(claim.text)) throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Factual section claims must appear verbatim in the body for citation rendering.', false, { text: claim.text })
    const isInference = /^(?:inference\s*\/\s*synthesis judgment|推断|综合判断)\s*:/i.test(claim.text)
    if (claim.kind === 'analysis' && (!isInference || !draft.bodyMarkdown.includes(claim.text))) {
      throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Analysis section claims must be explicitly labeled as an inference in the body.', false, { text: claim.text })
    }
    return { ...claim, evidenceIds }
  })
  return { ...draft, evidenceIds: checkIds(draft.evidenceIds, 'section'), claims }
}

async function hasExcessiveOverlap(writer: SectionWriter, draft: SectionDraft, prior: NonNullable<Parameters<SectionWriter['draft']>[0]['priorSectionDrafts']>, signal?: AbortSignal): Promise<boolean> {
  if (prior.some((item) => lexicalSimilarity(draft.bodyMarkdown, item.bodyMarkdown) >= OVERLAP_THRESHOLD)) return true
  return (await writer.semanticSimilarity?.({ draft, priorSectionDrafts: prior }, { signal }) ?? 0) >= OVERLAP_THRESHOLD
}

export function createDraftSectionsStep({ repositories, writer }: { repositories: DeepResearchRepositories; writer: SectionWriter; citationService?: CitationService }) {
  return createStep({
    id: 'deep-research-draft-sections',
    inputSchema: reportSectionJobSchema,
    outputSchema: reportSectionJobSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['researching'])
      const section = repositories.researchReportRepo.listSections(run.id).find((item) => item.id === inputData.sectionId)
      if (!section) throw new Error('Deep Research section not found: ' + inputData.sectionId)
      if (isReplayPastPhase(run.id, 'drafting_sections') || section.status !== 'planned') return inputData
      const allQuestions = repositories.researchQuestionRepo.list(run.id)
      const mappedQuestionIds = (repositories.researchReportRepo as Partial<typeof repositories.researchReportRepo>).listQuestionIdsForSection?.(section.id)
      const questions = mappedQuestionIds === undefined
        ? allQuestions.filter((question) => question.sectionKey === section.sectionKey)
        : allQuestions.filter((question) => mappedQuestionIds.includes(question.id))
      const evidence = selectEvidenceForSection(section, allQuestions, repositories.researchEvidenceRepo.list(run.id), mappedQuestionIds)
      const priorSectionDrafts = repositories.researchReportRepo.listSections(run.id)
        .filter((item) => item.id !== section.id && (item.verifiedText ?? item.draft))
        .map((item) => ({ sectionId: item.id, title: item.title, bodyMarkdown: item.verifiedText ?? item.draft! }))
      const input = { run, section, questions, evidence, sectionGoal: section.purpose, priorSectionDrafts }
      const signal = getWorkflowExecution(run.id)?.signal
      assertWorkflowNotCancelled(repositories, run.id)
      let draft = validateDraft(await writer.draft(input, { signal }), new Set(evidence.map((item) => item.id)), section.sectionKey)
      assertWorkflowNotCancelled(repositories, run.id)
      if (await hasExcessiveOverlap(writer, draft, priorSectionDrafts, signal)) {
        draft = validateDraft(await writer.draft({ ...input, priorSectionDrafts: [...priorSectionDrafts, { sectionId: section.id, title: section.title, bodyMarkdown: draft.bodyMarkdown }] }, { signal }), new Set(evidence.map((item) => item.id)), section.sectionKey)
        assertWorkflowNotCancelled(repositories, run.id)
        if (await hasExcessiveOverlap(writer, draft, priorSectionDrafts, signal)) {
          draft = {
            summary: 'The routed evidence did not support an independent section conclusion.',
            bodyMarkdown: '### Direct answer\n\nThe available routed evidence is insufficient to produce an independent answer for this section.\n\n### Comparison or classification\n\nNo distinct comparison can be made without additional section-specific evidence.\n\n### Evidence basis\n\nThe duplicate draft was withheld rather than repeating another section.\n\n### Conditions and limitations\n\nAdditional routed evidence is required before this section can make a separate finding.',
            claims: [{ text: 'Limitation: The routed evidence did not support an independent section conclusion.', kind: 'limitation', importance: 'high', confidence: 1, evidenceIds: [] }],
            evidenceIds: [], limitations: ['A duplicate section draft was withheld.'], missingEvidence: [section.title],
          }
        }
      }
      repositories.researchReportRepo.updateSection(section.id, { draft: draft.bodyMarkdown, draftPayload: draft, status: 'drafted' })
      repositories.researchEventRepo.append({ runId: run.id, type: 'research.section.drafted', phase: 'drafting_sections', payload: { id: section.id, evidenceCount: draft.evidenceIds.length, claimCount: draft.claims.length, fingerprint: createHash('sha256').update(draft.bodyMarkdown).digest('hex') } })
      return inputData
    },
  })
}