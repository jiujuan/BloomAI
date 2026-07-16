import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { ArtifactService } from '@server/services/deepresearch/artifact-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

export function createFinalizeArtifactsStep({ repositories, artifactService }: { repositories: DeepResearchRepositories; artifactService: ArtifactService }) {
  return createStep({
    id: 'deep-research-finalize-artifacts',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1), artifactId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['verifying'])
      const quality = run.quality
      if (!quality) throw new Error('Deep Research quality assessment is missing.')
      const existing = new Set(repositories.researchReportRepo.listArtifacts(run.id).map((artifact) => artifact.type))
      const artifacts = artifactService.write({
        run,
        questions: repositories.researchQuestionRepo.list(run.id),
        sections: repositories.researchReportRepo.listSections(run.id),
        claims: repositories.researchReportRepo.listClaims(run.id),
        citations: repositories.researchReportRepo.listCitations(run.id),
        evidence: repositories.researchEvidenceRepo.list(run.id),
        sources: repositories.researchSourceRepo.listSources(run.id),
        snapshots: repositories.researchSourceRepo.listSnapshots(run.id),
        quality,
      })
      for (const artifact of artifacts) if (!existing.has(artifact.type)) repositories.researchEventRepo.append({ runId: run.id, type: 'research.artifact.created', phase: 'finalizing_artifacts', payload: { id: artifact.id } })
      const report = artifacts.find((artifact) => artifact.type === 'report_markdown')
      if (!report) throw new Error('Deep Research Markdown artifact is missing.')
      repositories.researchRunRepo.setReportArtifactId(run.id, report.id)
      if (quality.releaseStatus === 'failed') {
        repositories.researchRunRepo.transitionWithEvent(run.id, 'failed', { phase: 'report_failed', progress: 100, error: { code: 'RESEARCH_QUALITY_FAILED', message: 'Report quality gates failed.', retryable: false }, eventType: 'research.run.failed', eventPayload: { errorCode: 'RESEARCH_QUALITY_FAILED', retryable: false } })
      } else {
        repositories.researchRunRepo.transitionWithEvent(run.id, quality.releaseStatus, { phase: 'report_complete', progress: 100, eventType: 'research.run.completed', eventPayload: { releaseStatus: quality.releaseStatus } })
      }
      return { runId: run.id, artifactId: report.id }
    },
  })
}
