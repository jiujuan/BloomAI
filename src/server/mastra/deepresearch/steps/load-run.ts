import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchCheckpointCursorSchema } from '@shared/deepresearch/schemas'
import type { DeepResearchRepositories } from '../workflow-context'
import { bindWorkflowExecution, resolveWorkflowResumeCursor } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const attemptSchema = z.object({
  attemptId: z.string().min(1),
  executorId: z.string().min(1).optional(),
  ownershipToken: z.string().min(1),
  resumeCursor: researchCheckpointCursorSchema.nullable(),
})
const runInputSchema = z.object({ runId: z.string().min(1), attempt: attemptSchema.optional() })

export function createLoadRunStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-load-run',
    inputSchema: runInputSchema,
    outputSchema: runInputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['queued'])
      const resolution = resolveWorkflowResumeCursor(repositories, run, inputData.attempt?.resumeCursor ?? null)
      bindWorkflowExecution(run.id, inputData.attempt
        ? { ...inputData.attempt, resumeCursor: resolution.cursor }
        : null)
      repositories.researchRunRepo.transitionWithEvent(run.id, 'planning', {
        phase: resolution.cursor.nextPhase === 'planning' ? 'planning' : `resuming:${resolution.cursor.nextPhase}`,
        progress: 5,
      })
      return inputData
    },
  })
}
