import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchEvidenceCount } from '@server/telemetry/metrics'

const briefSchema = z.object({
  title: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  scope: z.string(),
  assumptions: z.array(z.string()),
  plannedSections: z.array(z.string()),
  criticalClarificationIds: z.array(z.string()),
})
const inputSchema = z.object({ runId: z.string().min(1), brief: briefSchema })

export function createExtractEvidenceStep({ repositories, evidenceService }: { repositories: DeepResearchRepositories; evidenceService: EvidenceService }) {
  return createStep({
    id: 'deep-research-extract-evidence',
    inputSchema,
    outputSchema: inputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      if (isReplayPastPhase(run.id, 'extracting_evidence')) {
        checkpointWorkflowPhase(repositories, run, 'extracting_evidence', 'assessing_coverage')
        return inputData
      }
      assertWorkflowNotCancelled(repositories, run.id)
      const result = await evidenceService.extract(run, repositories.researchQuestionRepo.list(run.id), { signal: getWorkflowExecution(run.id)?.signal, isCancelled: () => { const current = repositories.researchRunRepo.get(run.id); return current?.status === 'cancelling' || current?.status === 'cancelled' || current?.cancellation?.requestedAt != null } })
      assertWorkflowNotCancelled(repositories, run.id)
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.evidence.extracted',
        phase: 'extracting_evidence',
        payload: { count: result.createdCount },
      })
      recordDeepResearchEvidenceCount(result.createdCount, deepResearchTelemetryContext(run, { evidence: result.createdCount }))
      checkpointWorkflowPhase(repositories, run, 'extracting_evidence', 'assessing_coverage')
      return inputData
    },
  })
}
