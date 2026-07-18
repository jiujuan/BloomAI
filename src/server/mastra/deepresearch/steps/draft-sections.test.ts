import { describe, expect, it, vi } from 'vitest'
import type { ResearchEvidenceDto, ResearchQuestionDto, ResearchReportSectionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createDraftSectionsStep } from './draft-sections'

const run: ResearchRunDto = {
  id: 'run-1',
  sessionId: null,
  topic: 'Example topic',
  profile: 'general',
  depth: 'standard',
  status: 'researching',
  phase: 'drafting_sections',
  progress: 72,
  brief: null,
  workflowRunId: 'workflow-1',
  budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 2, iterations: 1, searchQueries: 2, normalizedSources: 2, fetchedSources: 2, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null,
  reportArtifactId: null,
  resumePhase: null,
  error: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
}

const section: ResearchReportSectionDto = {
  id: 'section-implications',
  runId: run.id,
  ordinal: 5,
  title: 'implications',
  purpose: 'Required by the frozen general profile.',
  draft: null,
  verifiedText: null,
  status: 'planned',
}

const questions: ResearchQuestionDto[] = [
  { id: 'question-definition', runId: run.id, parentQuestionId: null, ordinal: 1, question: 'Example topic: definition', intent: 'definition', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null },
  { id: 'question-impacts', runId: run.id, parentQuestionId: null, ordinal: 2, question: 'Example topic: impacts', intent: 'impacts', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null },
]

const evidence: ResearchEvidenceDto[] = [
  { id: 'evidence-definition', runId: run.id, questionId: 'question-definition', snapshotId: 'snapshot-1', passage: 'Definition evidence', summary: 'Definition', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 19 },
  { id: 'evidence-impacts', runId: run.id, questionId: 'question-impacts', snapshotId: 'snapshot-2', passage: 'Impacts evidence', summary: 'Impacts', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 16 },
]

describe('createDraftSectionsStep', () => {
  it('selects evidence for the related question when a section title differs from its question intent', async () => {
    const writer = { draft: vi.fn(async () => 'draft text') }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchReportRepo: { listSections: vi.fn(() => [section]), updateSection: vi.fn() },
      researchQuestionRepo: { list: vi.fn(() => questions) },
      researchEvidenceRepo: { list: vi.fn(() => evidence) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const step = createDraftSectionsStep({ repositories, writer })

    await (step as any).execute({ inputData: { runId: run.id, sectionId: section.id } })

    expect(writer.draft).toHaveBeenCalledWith(expect.objectContaining({
      section,
      evidence: [evidence[1]],
    }), { signal: undefined })
  })
})
