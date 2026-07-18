import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { areHighPriorityQuestionsCovered, type EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const briefSchema = z.object({
  title: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  scope: z.string(),
  assumptions: z.array(z.string()),
  plannedSections: z.array(z.string()),
  criticalClarificationIds: z.array(z.string()),
})
export const gapLoopStateSchema = z.object({
  runId: z.string().min(1),
  brief: briefSchema,
  coverageComplete: z.boolean(),
  marginalNewEvidenceCount: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  iterations: z.number().int().nonnegative(),
  maxIterations: z.number().int().nonnegative(),
})

export function createAssessCoverageStep({ repositories, evidenceService }: { repositories: DeepResearchRepositories; evidenceService: EvidenceService }) {
  return createStep({
    id: 'deep-research-assess-coverage',
    inputSchema: z.object({ runId: z.string().min(1), brief: briefSchema }),
    outputSchema: gapLoopStateSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const { researchAttemptRepo: attemptRepo, researchCoverageAssessmentRepo: assessmentRepo } = repositories
      let attemptId = run.currentAttemptId
      if (!attemptId) {
        attemptId = attemptRepo.createWithInitialCheckpoint({
          runId: run.id,
          trigger: 'initial',
          checkpoint: {
            checkpointKey: 'coverage:attempt-bootstrap',
            phase: 'planning',
            status: 'completed',
            resumeCursor: { version: 1, nextPhase: 'assessing_coverage', iteration: run.usage.iterations },
            inputFingerprint: 'coverage:attempt-bootstrap:' + run.id,
            replayPolicy: 'reuse',
          },
        }).attempt.id
      }
      if (attemptRepo.get(attemptId)?.runId !== run.id) {
        throw new Error('Deep Research assess-coverage Attempt does not belong to the Run.')
      }
      const questions = repositories.researchQuestionRepo.list(run.id)
      const assessment = evidenceService.assessCoverageProjectionV2(run, questions)
      assessmentRepo.persistAndProject({
        runId: run.id,
        attemptId,
        iterationId: null,
        iteration: run.usage.iterations,
        policyVersion: assessment.policyVersion,
        inputFingerprint: assessment.inputFingerprint,
        aggregateScore: assessment.aggregateScore,
        questionAssessments: assessment.questionAssessments,
        coverageProjections: assessment.coverageProjections,
        limitations: assessment.limitations,
        checkpoint: {
          checkpointKey: 'coverage:assessment:v2',
          phase: 'assessing_coverage',
          status: 'completed',
          resumeCursor: { version: 1, nextPhase: 'gap_filling', iteration: run.usage.iterations },
          inputFingerprint: assessment.inputFingerprint,
          outputFingerprint: assessment.inputFingerprint,
          replayPolicy: 'reuse',
        },
      })
      const updatedQuestions = repositories.researchQuestionRepo.list(run.id)
      return {
        runId: run.id,
        brief: inputData.brief,
        coverageComplete: areHighPriorityQuestionsCovered(updatedQuestions),
        marginalNewEvidenceCount: assessment.coverageProjections.length,
        cancelled: repositories.researchRunRepo.get(run.id)?.status === 'cancelled',
        iterations: run.usage.iterations,
        maxIterations: run.budget.maxIterations,
      }
    },
  })
}
