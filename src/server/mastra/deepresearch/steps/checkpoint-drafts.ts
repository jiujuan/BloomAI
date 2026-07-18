import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { reportSectionJobSchema } from './build-outline'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'
import { checkpointWorkflowPhase } from './checkpoint-replay'

export function createCheckpointDraftsStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-checkpoint-drafts',
    inputSchema: z.array(reportSectionJobSchema),
    outputSchema: z.array(reportSectionJobSchema),
    execute: async ({ inputData }) => {
      const runId = inputData[0]?.runId
      if (!runId) throw new Error('Deep Research outline was empty.')
      const run = loadRunnableRun(repositories, runId, ['researching'])
      checkpointWorkflowPhase(repositories, run, 'drafting_sections', 'extracting_claims')
      return inputData
    },
  })
}
