import { describe, expect, it, vi } from 'vitest'
import type { ResearchEvidenceDto, ResearchQuestionDto, ResearchReportSectionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createExtractClaimsStep } from './extract-claims'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: null, topic: 'Example topic', profile: 'general', depth: 'standard', status: 'researching', phase: 'extracting_claims', progress: 76, brief: null, workflowRunId: 'workflow-1',
  budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 2, iterations: 1, searchQueries: 2, normalizedSources: 2, fetchedSources: 2, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

const section: ResearchReportSectionDto = {
  id: 'section-implications', runId: run.id, ordinal: 5, title: 'implications', purpose: 'Required by the frozen general profile.', draft: 'Draft', verifiedText: null, status: 'drafted',
}

const questions: ResearchQuestionDto[] = [
  { id: 'question-definition', runId: run.id, parentQuestionId: null, ordinal: 1, question: 'Example topic: definition', intent: 'definition', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null },
  { id: 'question-impacts', runId: run.id, parentQuestionId: null, ordinal: 2, question: 'Example topic: impacts', intent: 'impacts', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null },
]

const evidence: ResearchEvidenceDto[] = [
  { id: 'evidence-definition', runId: run.id, questionId: 'question-definition', snapshotId: 'snapshot-1', passage: 'Definition evidence', summary: 'Definition', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 19 },
  { id: 'evidence-impacts', runId: run.id, questionId: 'question-impacts', snapshotId: 'snapshot-2', passage: 'Impacts evidence', summary: 'Impacts', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 16 },
]

describe('createExtractClaimsStep', () => {
  it('extracts claims from evidence matched to the section intent instead of the global leading evidence', async () => {
    const extractor = { extract: vi.fn(async ({ evidence: suppliedEvidence }: { evidence: ResearchEvidenceDto[] }) => [{ text: suppliedEvidence[0]?.summary ?? 'No evidence', kind: 'factual' as const, importance: 'medium' as const, confidence: 0.9, evidenceIds: suppliedEvidence.map((item) => item.id) }]) }
    const citationService = { bind: vi.fn() }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), transitionWithEvent: vi.fn() },
      researchReportRepo: { listSections: vi.fn(() => [section]), upsertClaim: vi.fn(() => ({ id: 'claim-1' })) },
      researchQuestionRepo: { list: vi.fn(() => questions) },
      researchEvidenceRepo: { list: vi.fn(() => evidence) },
      researchCheckpointRepo: { get: vi.fn(() => null), upsert: vi.fn() },
    } as any
    const step = createExtractClaimsStep({ repositories, extractor, citationService: citationService as any })

    await (step as any).execute({ inputData: [{ runId: run.id, sectionId: section.id, ordinal: section.ordinal }] })

    expect(extractor.extract).toHaveBeenCalledWith(expect.objectContaining({ section, evidence: [evidence[1]] }), { signal: undefined })
    expect(citationService.bind).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: evidence[1].id }))
  })
})

  it('falls back to extraction when a structured draft has no declared claims', async () => {
    const structuredSection = {
      ...section,
      draftPayload: {
        summary: 'A bounded finding is present.', bodyMarkdown: '### Direct answer\n\nA bounded finding is present.',
        claims: [], evidenceIds: ['evidence-impacts'], limitations: [], missingEvidence: [],
      },
    }
    const extractor = { extract: vi.fn(async () => [{ text: 'The bounded finding is supported.', kind: 'factual' as const, importance: 'medium' as const, confidence: 0.8, evidenceIds: ['evidence-impacts'] }]) }
    const citationService = { bind: vi.fn() }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), transitionWithEvent: vi.fn() },
      researchReportRepo: { listSections: vi.fn(() => [structuredSection]), upsertClaim: vi.fn(() => ({ id: 'claim-from-extractor' })) },
      researchQuestionRepo: { list: vi.fn(() => questions) }, researchEvidenceRepo: { list: vi.fn(() => evidence) }, researchCheckpointRepo: { get: vi.fn(() => null), upsert: vi.fn() },
    } as any

    await (createExtractClaimsStep({ repositories, extractor, citationService: citationService as any }) as any).execute({ inputData: [{ runId: run.id, sectionId: section.id }] })

    expect(extractor.extract).toHaveBeenCalledWith(expect.objectContaining({ evidence: [evidence[1]] }), { signal: undefined })
    expect(citationService.bind).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: 'evidence-impacts' }))
  })
  it('persists claims and citations directly from the replayable structured section draft', async () => {
    const structuredSection = {
      ...section,
      draftPayload: {
        summary: 'Impacts are documented.', bodyMarkdown: '### Direct answer\n\nImpacts are documented.',
        claims: [{ text: 'The documented impact is supported.', kind: 'factual' as const, importance: 'high' as const, confidence: 0.9, evidenceIds: ['evidence-impacts'] }],
        evidenceIds: ['evidence-impacts'], limitations: [], missingEvidence: [],
      },
    }
    const extractor = { extract: vi.fn() }
    const citationService = { bind: vi.fn() }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), transitionWithEvent: vi.fn() },
      researchReportRepo: { listSections: vi.fn(() => [structuredSection]), upsertClaim: vi.fn(() => ({ id: 'claim-from-draft' })) },
      researchQuestionRepo: { list: vi.fn(() => questions) }, researchEvidenceRepo: { list: vi.fn(() => evidence) }, researchCheckpointRepo: { get: vi.fn(() => null), upsert: vi.fn() },
    } as any

    await (createExtractClaimsStep({ repositories, extractor, citationService: citationService as any }) as any).execute({ inputData: [{ runId: run.id, sectionId: section.id }] })

    expect(extractor.extract).not.toHaveBeenCalled()
    expect(repositories.researchReportRepo.upsertClaim).toHaveBeenCalledWith(expect.objectContaining({ text: 'The documented impact is supported.' }))
    expect(citationService.bind).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'claim-from-draft', evidenceId: 'evidence-impacts' }))
  })
