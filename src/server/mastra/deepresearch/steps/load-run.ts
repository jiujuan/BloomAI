import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const runInputSchema = z.object({ runId: z.string().min(1) })

export function createLoadRunStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-load-run',
    inputSchema: runInputSchema,
    outputSchema: runInputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['queued'])
      repositories.researchRunRepo.transitionWithEvent(run.id, 'planning', {
        phase: 'planning',
        progress: 5,
      })
      return { runId: run.id }
    },
  })
}
