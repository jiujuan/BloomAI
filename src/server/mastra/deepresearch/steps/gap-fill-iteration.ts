import { createStep } from '@mastra/core/workflows'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { GapAnalyst } from '../agents/gap-analyst'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './types'
import { researchIterationRepo } from '@server/db/repositories/deepresearch/research-iteration.repo'
import type { DeepResearchRepositories } from '../workflow-context'
import { iterationContextSchema } from './iteration-context'
import { planIteration } from './plan-iteration'
import { executeIterationRetrieval } from './execute-iteration-retrieval'
import { assessIteration } from './assess-iteration'
import { checkpointWorkflowPhase } from './checkpoint-replay'

export interface GapFillStopState {
  coverageComplete: boolean
  marginalNewEvidenceCount: number
  cancelled: boolean
  iterations: number
  maxIterations: number
  stopDecision?: 'stop_covered' | 'stop_budget' | 'stop_no_material_gain' | 'stop_no_actionable_gaps' | 'stop_cancelled' | 'stop_max_iterations' | 'stop_blocked' | null
  limitations?: string[]
}

/** Retained only as the DR2-09 workflow-compatible facade over the recoverable DR2-08 steps. */
/**
 * The database-backed decision is the only loop terminator.  In particular,
 * evidence count is deliberately not a stop heuristic: repeated or same-domain
 * evidence is evaluated by Coverage Policy V2 and becomes a durable no-gain
 * decision only after the policy's threshold is reached.
 */
export function shouldStopGapFill(state: GapFillStopState): boolean {
  return state.stopDecision != null
}

export function createBoundedPersistentIterationStep(dependencies: {
  repositories: DeepResearchRepositories
  gapAnalyst: GapAnalyst
  searchService: ReturnTypeOfSearchService
  sourceCurator: SourceCurator
  contentService: ReturnTypeOfContentService
  evidenceService: EvidenceService
}) {
  return createStep({
    id: 'deep-research-bounded-persistent-iteration',
    inputSchema: iterationContextSchema,
    outputSchema: iterationContextSchema,
    execute: async ({ inputData }) => {
      // Existing callers may inject pre-DR2-08 repository bundles. Keep this facade
      // backward-compatible while the workflow itself remains unchanged until DR2-09.
      const durableDependencies = dependencies.repositories.researchIterationRepo
        ? dependencies
        : { ...dependencies, repositories: { ...dependencies.repositories, researchIterationRepo } }
      const planned = await planIteration(inputData, durableDependencies)
      const retrieved = await executeIterationRetrieval(planned, durableDependencies)
      // Cancellation is checked at the durable retrieval boundary; do not start extraction
      // after cancellation was observed. The next plan pass records the stop audit.
      if (retrieved.cancelled) return retrieved
      const assessed = await assessIteration(retrieved, durableDependencies)
      if (assessed.stopDecision) {
        const run = durableDependencies.repositories.researchRunRepo.get(assessed.runId)
        if (run) checkpointWorkflowPhase(durableDependencies.repositories, run, 'gap_filling', 'building_outline', { iteration: assessed.iterations })
      }
      return assessed
    },
  })
}

/** @deprecated DR2-08 compatibility name; DR2-09 uses the bounded persistent step. */
export const createGapFillIterationStep = createBoundedPersistentIterationStep
