import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { createReportMarkdown, type ArtifactService } from '@server/services/deepresearch/artifact-service'
import { isPredominantlyEnglish, type ReportTranslator } from '../agents/report-translator'
import { serverLogger } from '@server/logger/logger'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchCompletion, recordDeepResearchE2EDuration, recordDeepResearchFailure, traceDeepResearchPhase } from '@server/telemetry/metrics'
import { recordProductionRunDiagnosticEvents } from '@server/deepresearch/run-diagnostics'

export function createFinalizeArtifactsStep({ repositories, artifactService, reportTranslator }: { repositories: DeepResearchRepositories; artifactService: ArtifactService; reportTranslator: ReportTranslator }) {
  return createStep({
    id: 'deep-research-finalize-artifacts',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1), artifactId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['verifying'])
      assertWorkflowNotCancelled(repositories, run.id)
      return traceDeepResearchPhase('finalizing_artifacts', deepResearchTelemetryContext(run), async () => {
        const quality = run.quality
        if (!quality) throw new Error('Deep Research quality assessment is missing.')
        const existing = new Set(repositories.researchReportRepo.listArtifacts(run.id).map((artifact) => artifact.type))
        const artifactInput = {
          run,
          questions: repositories.researchQuestionRepo.list(run.id),
          sections: repositories.researchReportRepo.listSections(run.id),
          claims: repositories.researchReportRepo.listClaims(run.id),
          citations: repositories.researchReportRepo.listCitations(run.id),
          evidence: repositories.researchEvidenceRepo.list(run.id),
          sources: repositories.researchSourceRepo.listSources(run.id),
          snapshots: repositories.researchSourceRepo.listSnapshots(run.id),
          quality,
        }
        const existingReport = repositories.researchReportRepo.listArtifacts(run.id).find((artifact) => artifact.type === 'report_markdown')
        assertWorkflowNotCancelled(repositories, run.id)
        const artifacts = existingReport ? repositories.researchReportRepo.listArtifacts(run.id) : artifactService.write(artifactInput)
        assertWorkflowNotCancelled(repositories, run.id)
        if (!existing.has('report_markdown_zh_cn')) {
          const englishMarkdown = createReportMarkdown(artifactInput)
          if (isPredominantlyEnglish(englishMarkdown)) {
            try {
              const chineseMarkdown = await reportTranslator.translate({ markdown: englishMarkdown }, { signal: getWorkflowExecution(run.id)?.signal })
              assertWorkflowNotCancelled(repositories, run.id)
              const chineseArtifact = artifactService.writeChineseMarkdown(run.id, chineseMarkdown)
              artifacts.push(chineseArtifact)
            } catch (error) {
              assertWorkflowNotCancelled(repositories, run.id)
              serverLogger.warn('Deep Research Chinese report translation failed; keeping the original report available.', { runId: run.id, error: error instanceof Error ? error.message : String(error) })
            }
          }
        }
        for (const artifact of artifacts) if (!existing.has(artifact.type)) repositories.researchEventRepo.append({ runId: run.id, type: 'research.artifact.created', phase: 'finalizing_artifacts', payload: { id: artifact.id } })
        const report = artifacts.find((artifact) => artifact.type === 'report_markdown')
        if (!report) throw new Error('Deep Research Markdown artifact is missing.')
        repositories.researchRunRepo.setReportArtifactId(run.id, report.id)
        const currentRun = repositories.researchRunRepo.get(run.id) ?? run
        if (currentRun.usage.tokens === 0) {
          recordProductionRunDiagnosticEvents(repositories, currentRun, 'finalizing_artifacts', [{ kind: 'tokens_zero' }])
        }
        checkpointWorkflowPhase(repositories, run, 'finalizing_artifacts', 'completed')
        if (quality.releaseStatus === 'failed') {
          repositories.researchRunRepo.transitionWithEvent(run.id, 'failed', { phase: 'report_failed', progress: 100, error: { code: 'RESEARCH_QUALITY_FAILED', message: 'Report quality gates failed.', retryable: false }, eventType: 'research.run.failed', eventPayload: { errorCode: 'RESEARCH_QUALITY_FAILED', retryable: false } })
          recordDeepResearchFailure(deepResearchTelemetryContext(run, { limitations: quality.limitations.length }))
        } else {
          repositories.researchRunRepo.transitionWithEvent(run.id, quality.releaseStatus, { phase: 'report_complete', progress: 100, eventType: 'research.run.completed', eventPayload: { releaseStatus: quality.releaseStatus } })
          recordDeepResearchCompletion(quality.releaseStatus, deepResearchTelemetryContext(run, { limitations: quality.limitations.length }))
        }
        recordDeepResearchE2EDuration(Date.now() - run.createdAt, deepResearchTelemetryContext(run))
        return { runId: run.id, artifactId: report.id }
      })
    },
  })
}
