import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchReportSectionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createBuildBriefStep } from './build-brief'
import { createDraftSectionsStep } from './draft-sections'
import { createFinalizeArtifactsStep } from './finalize-artifacts'
import { bindWorkflowExecution, clearWorkflowExecution } from './checkpoint-replay'

function createRun(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: 'cancel-step-run', sessionId: null, topic: 'Cancellation boundary', profile: 'general', depth: 'standard',
    status: 'planning', phase: 'planning', progress: 10, brief: null, workflowRunId: null,
    budget: { maxQuestions: 10, maxIterations: 1, maxSearchQueries: 10, maxNormalizedSources: 10, maxFetchedSources: 10, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
    usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
    quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 0, updatedAt: 0, completedAt: null,
    ...overrides,
  }
}

function bindCancelledSignal(runId: string, controller: AbortController): void {
  bindWorkflowExecution(runId, { attemptId: 'attempt-' + runId, ownershipToken: 'owner-' + runId, signal: controller.signal, resumeCursor: null })
}

afterEach(() => clearWorkflowExecution('cancel-step-run'))

describe('Deep Research cancellation step boundaries', () => {
  it('planning stops after an aborted planner return without persisting a brief or starting queries', async () => {
    const controller = new AbortController()
    const run = createRun()
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setBrief: vi.fn() },
      researchQuestionRepo: { create: vi.fn() },
      researchEventRepo: { append: vi.fn() },
    } as any
    const planner = {
      plan: vi.fn(async (_run: ResearchRunDto, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return { title: 'Cancelled plan', objective: null, audience: null, scope: 'scope', assumptions: [], plannedSections: ['summary'], criticalClarifications: [] }
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createBuildBriefStep({ repositories, planner })
    await expect((step as any).execute({ inputData: { runId: run.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchRunRepo.setBrief).not.toHaveBeenCalled()
    expect(repositories.researchQuestionRepo.create).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })

  it('drafting stops after an aborted writer return without saving a section or invoking another provider', async () => {
    const controller = new AbortController()
    const run = createRun({ status: 'researching', phase: 'drafting_sections' })
    const section: ResearchReportSectionDto = { id: 'section-1', runId: run.id, ordinal: 1, title: 'summary', purpose: 'summary', draft: null, verifiedText: null, status: 'planned' }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchReportRepo: { listSections: vi.fn(() => [section]), updateSection: vi.fn() },
      researchQuestionRepo: { list: vi.fn(() => []) },
      researchEvidenceRepo: { list: vi.fn(() => []) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const writer = {
      draft: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return 'must not persist'
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createDraftSectionsStep({ repositories, writer })
    await expect((step as any).execute({ inputData: { runId: run.id, sectionId: section.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(writer.draft).toHaveBeenCalledTimes(1)
    expect(repositories.researchReportRepo.updateSection).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })

  it('finalization stops after an aborted translator return without writing artifacts or completing the run', async () => {
    const controller = new AbortController()
    const run = createRun({
      status: 'verifying', phase: 'finalizing_artifacts',
      quality: { releaseStatus: 'completed', highPriorityQuestionCoverage: 1, factualClaimCitationCoverage: 1, supportedCitationCoverage: 1, independentCitedDomainCount: 1, contradictionDisclosureCoverage: 1, requiredSectionCoverage: 1, limitations: [], assessorVersion: 'test' },
    })
    const markdownArtifact = { id: 'report-en', runId: run.id, type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown', content: '# English report', createdAt: 0 }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setReportArtifactId: vi.fn(), transitionWithEvent: vi.fn() },
      researchQuestionRepo: { list: vi.fn(() => []) },
      researchEvidenceRepo: { list: vi.fn(() => []) },
      researchSourceRepo: { listSources: vi.fn(() => []), listSnapshots: vi.fn(() => []) },
      researchReportRepo: { listArtifacts: vi.fn(() => [markdownArtifact]), listSections: vi.fn(() => []), listClaims: vi.fn(() => []), listCitations: vi.fn(() => []) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const artifactService = { write: vi.fn(), writeChineseMarkdown: vi.fn() }
    const reportTranslator = {
      translate: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return '# 不应写入'
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createFinalizeArtifactsStep({ repositories, artifactService: artifactService as any, reportTranslator })
    await expect((step as any).execute({ inputData: { runId: run.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(reportTranslator.translate).toHaveBeenCalledTimes(1)
    expect(artifactService.write).not.toHaveBeenCalled()
    expect(artifactService.writeChineseMarkdown).not.toHaveBeenCalled()
    expect(repositories.researchRunRepo.setReportArtifactId).not.toHaveBeenCalled()
    expect(repositories.researchRunRepo.transitionWithEvent).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })
})