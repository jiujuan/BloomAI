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
    const writer = { draft: vi.fn(async () => ({ summary: 'Summary', bodyMarkdown: '### Direct answer\n\nThe routed impact evidence provides a direct answer.\n\n### Comparison or classification\n\nClassified answer.\n\n### Evidence basis\n\nBound fact.\n\n### Conditions and limitations\n\nLimited.', claims: [{ text: 'Bound fact.', kind: 'factual' as const, importance: 'medium' as const, confidence: 0.9, evidenceIds: ['evidence-impacts'] }], evidenceIds: ['evidence-impacts'], limitations: [], missingEvidence: [] })) }
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

  it('rejects an out-of-scope evidence id returned by a structured writer', async () => {
    const writer = { draft: vi.fn(async () => ({ summary: 'Summary', bodyMarkdown: '## Direct answer\n\nBounded answer.\n\n## Comparison or classification\n\nClassified answer.\n\n## Evidence basis\n\nUnsupported cross-section fact.\n\n## Conditions and limitations\n\nLimited.', claims: [{ text: 'Unsupported cross-section fact.', kind: 'factual', importance: 'high', confidence: 0.9, evidenceIds: ['evidence-definition'] }], evidenceIds: ['evidence-definition'], limitations: [], missingEvidence: [] })) }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchReportRepo: { listSections: vi.fn(() => [section]), updateSection: vi.fn(), listQuestionIdsForSection: vi.fn(() => ['question-impacts']) },
      researchQuestionRepo: { list: vi.fn(() => questions) },
      researchEvidenceRepo: { list: vi.fn(() => evidence) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const step = createDraftSectionsStep({ repositories, writer: writer as any })

    await expect((step as any).execute({ inputData: { runId: run.id, sectionId: section.id } })).rejects.toThrow('out-of-scope evidence')
  })


  it('fills limitations and missing evidence for evidence-insufficient sections before saving', async () => {
    const bodyMarkdown = '### Direct answer\n\nThe available routed evidence is insufficient to answer this section.\n\n### Comparison or classification\n\nNo reliable comparison can be made without section-specific evidence.\n\n### Evidence basis\n\nNo qualifying evidence passage was routed to this section.\n\n### Conditions and limitations\n\nThe section must be treated as evidence-insufficient.'
    const writer = { draft: vi.fn(async () => ({ summary: 'Insufficient evidence', bodyMarkdown, claims: [], evidenceIds: [], limitations: [], missingEvidence: [] })) }
    const updateSection = vi.fn()
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchReportRepo: { listSections: vi.fn(() => [section]), updateSection, listQuestionIdsForSection: vi.fn(() => []) },
      researchQuestionRepo: { list: vi.fn(() => questions) },
      researchEvidenceRepo: { list: vi.fn(() => evidence) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const step = createDraftSectionsStep({ repositories, writer: writer as any })

    await (step as any).execute({ inputData: { runId: run.id, sectionId: section.id } })

    expect(updateSection).toHaveBeenCalledWith(section.id, expect.objectContaining({
      draft: expect.stringContaining('Limitation: No qualifying routed evidence was available for this section.'),
      draftPayload: expect.objectContaining({
        limitations: ['No qualifying routed evidence was available for this section.'],
        missingEvidence: ['Section-specific evidence for this section'],
        bodyMarkdown: expect.stringContaining('Missing evidence: Section-specific evidence for this section'),
      }),
      status: 'drafted',
    }))
  })


  it('rewrites a later section when its body is too similar to an earlier drafted section', async () => {
    const earlier = { ...section, id: 'section-earlier', title: 'market-definition', draft: '### Direct answer\n\nThe market is defined by routed evidence.\n\n### Comparison or classification\n\nThe market is classified by routed evidence.\n\n### Evidence basis\n\nEvidence supports the conclusion.\n\n### Conditions and limitations\n\nCoverage is limited.', status: 'drafted' as const }
    const duplicate = earlier.draft!
    const rewritten = '### Direct answer\n\nThis section answers impacts rather than repeating the market definition.\n\n### Comparison or classification\n\nImpacts are classified separately.\n\n### Evidence basis\n\nOnly impact evidence is used.\n\n### Conditions and limitations\n\nCoverage is limited.'
    const writer = { draft: vi.fn().mockResolvedValueOnce({ summary: 'Duplicate', bodyMarkdown: duplicate, claims: [], evidenceIds: [], limitations: ['No evidence selected.'], missingEvidence: ['Impacts evidence'] }).mockResolvedValueOnce({ summary: 'Rewritten', bodyMarkdown: rewritten, claims: [], evidenceIds: [], limitations: ['No evidence selected.'], missingEvidence: ['Impacts evidence'] }) }
    const updateSection = vi.fn()
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) }, researchReportRepo: { listSections: vi.fn(() => [earlier, section]), updateSection, listQuestionIdsForSection: vi.fn(() => []) },
      researchQuestionRepo: { list: vi.fn(() => questions) }, researchEvidenceRepo: { list: vi.fn(() => evidence) }, researchEventRepo: { append: vi.fn() },
    } as any

    await (createDraftSectionsStep({ repositories, writer: writer as any }) as any).execute({ inputData: { runId: run.id, sectionId: section.id } })

    expect(writer.draft).toHaveBeenCalledTimes(2)
    expect(updateSection).toHaveBeenCalledWith(section.id, expect.objectContaining({ draft: rewritten }))
  })
