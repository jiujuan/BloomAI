import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import { areHighPriorityQuestionsCovered, type EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchAssessment } from '@server/telemetry/metrics'
import { recordProductionRunDiagnosticEvents } from '@server/deepresearch/run-diagnostics'

const briefSchema = researchBriefSchema
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
      for (const questionAssessment of assessment.questionAssessments) {
        recordDeepResearchAssessment(questionAssessment, deepResearchTelemetryContext(run))
      }
      checkpointWorkflowPhase(repositories, run, 'assessing_coverage', 'gap_filling')
      const updatedQuestions = repositories.researchQuestionRepo.list(run.id)
      const highPriorityQuestions = updatedQuestions.filter((question) => question.priority === 'high' || question.priority === 'critical')
      if (highPriorityQuestions.length > 0 && highPriorityQuestions.every((question) => question.status !== 'covered')) {
        recordProductionRunDiagnosticEvents(repositories, run, 'assessing_coverage', [{ kind: 'high_priority_coverage_zero', questions: updatedQuestions }])
      }
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
