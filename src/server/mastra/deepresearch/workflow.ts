import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import type { BriefPlanner } from './agents/brief-planner'
import type { DeepResearchRepositories } from './workflow-context'
import { createBuildBriefStep } from './steps/build-brief'
import { createFinalizeSkeletonStep } from './steps/finalize-skeleton'
import { createLoadRunStep } from './steps/load-run'

const workflowInputSchema = z.object({ runId: z.string().min(1) })
const workflowOutputSchema = z.object({ runId: z.string().min(1), artifactId: z.string().min(1) })

export function createDeepResearchWorkflow({
  repositories,
  planner,
  dataDir,
}: {
  repositories: DeepResearchRepositories
  planner: BriefPlanner
  dataDir?: string
}) {
  const loadRun = createLoadRunStep(repositories)
  const buildBrief = createBuildBriefStep({ repositories, planner })
  const finalizeSkeleton = createFinalizeSkeletonStep(repositories, dataDir)

  return createWorkflow({
    id: 'deep-research-v1',
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
  })
    .then(loadRun)
    .then(buildBrief)
    .then(finalizeSkeleton)
    .commit()
}
