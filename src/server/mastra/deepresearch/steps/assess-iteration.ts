import { createStep } from '@mastra/core/workflows'
import type { EvidenceService } from '@server/services/deepresearch/evidence-service'
import { deepResearchTelemetryContext, type DeepResearchRepositories } from '../workflow-context'
import { recordDeepResearchAssessment, recordDeepResearchIteration } from '@server/telemetry/metrics'
import { recordProductionRunDiagnosticEvents } from '@server/deepresearch/run-diagnostics'
import { iterationContextSchema, type IterationContext } from './iteration-context'
import { assertWorkflowNotCancelled, getWorkflowExecution } from './checkpoint-replay'

export async function assessIteration(
  input: IterationContext,
  dependencies: { repositories: DeepResearchRepositories; evidenceService: EvidenceService },
): Promise<IterationContext> {
  if (!input.iterationId) return input
  const { repositories, evidenceService } = dependencies
  const run = repositories.researchRunRepo.get(input.runId)
  const iteration = repositories.researchIterationRepo!.get(input.iterationId)
  if (!run || !iteration) return input
  const questions = repositories.researchQuestionRepo.list(run.id)
  const previousScore = repositories.researchCoverageAssessmentRepo.getLatest(run.id)?.aggregateScore ?? null
  assertWorkflowNotCancelled(repositories, run.id)
  const extraction = await evidenceService.extract(run, questions, { signal: getWorkflowExecution(run.id)?.signal, isCancelled: () => { const current = repositories.researchRunRepo.get(run.id); return current?.status === 'cancelling' || current?.status === 'cancelled' || current?.cancellation?.requestedAt != null } })
  assertWorkflowNotCancelled(repositories, run.id)
  repositories.researchEventRepo.append({ runId: run.id, type: 'research.evidence.extracted', phase: 'gap_filling', payload: { count: extraction.createdCount, iterationId: iteration.id } })
  for (const coverage of extraction.coverage) repositories.researchEventRepo.append({ runId: run.id, type: 'research.coverage.assessed', phase: 'gap_filling', payload: { id: coverage.questionId, score: coverage.score, iterationId: iteration.id } })
  const projection = evidenceService.assessCoverageProjectionV2(run, repositories.researchQuestionRepo.list(run.id))
  repositories.researchCoverageAssessmentRepo.save({
    runId: run.id,
    iterationId: iteration.id,
    iteration: iteration.ordinal,
    policyVersion: projection.policyVersion,
    inputFingerprint: projection.inputFingerprint,
    aggregateScore: projection.aggregateScore,
    questionVerdicts: projection.questionAssessments.map((assessment) => ({ questionId: assessment.questionId, score: assessment.score, verdict: assessment.verdict === 'blocked' ? 'limited' : assessment.verdict, gapCodes: assessment.gaps.map((gap) => gap.code), limitations: assessment.limitation ? [assessment.limitation] : [] })),
    limitations: projection.limitations,
  })
  for (const questionAssessment of projection.questionAssessments) {
    recordDeepResearchAssessment(questionAssessment, deepResearchTelemetryContext(run))
  }
  const fetchedCount = (input.sourceIds ?? []).filter((sourceId) => Boolean(repositories.researchSourceRepo.getLatestSnapshotForSource(run.id, sourceId))).length
  // The next loop decision must use Coverage Policy V2 gain semantics, never raw evidence count.
  const materialGain = projection.questionAssessments.some((assessment) => assessment.materialGain?.material === true)
  const settled = repositories.researchIterationRepo!.settleReservation(iteration.id, {
    actual: { iterations: 1, searchQueries: input.queryIds?.length ?? 0, fetchedSources: fetchedCount, modelTokens: 0, providerCostUsd: 0 },
    status: 'completed',
    coverageAfter: { aggregateScore: projection.aggregateScore, materialGain },
    limitations: projection.limitations,
  })
  recordDeepResearchIteration({
    ordinal: iteration.ordinal,
    evidenceDelta: extraction.createdCount,
    scoreDelta: projection.aggregateScore - (previousScore ?? projection.aggregateScore),
  }, deepResearchTelemetryContext(run))
  repositories.researchEventRepo.append({ runId: run.id, type: 'research.iteration.completed', phase: 'gap_filling', payload: { iteration: iteration.ordinal, iterationId: iteration.id, newEvidenceCount: extraction.createdCount, materialGain } })
  if (run.currentAttemptId) {
    repositories.researchCheckpointRepo.append({
      runId: run.id,
      attemptId: run.currentAttemptId,
      checkpointKey: `iteration:${iteration.ordinal}:assessment-completed`,
      phase: 'gap_filling',
      status: 'completed',
      resumeCursor: { version: 1, nextPhase: 'gap_filling', iteration: iteration.ordinal },
      inputFingerprint: `iteration:${iteration.id}:assessment:${projection.inputFingerprint}`,
      outputFingerprint: `material-gain:${materialGain}`,
      replayPolicy: 'reuse',
    })
  }
  const updatedQuestions = repositories.researchQuestionRepo.list(run.id)
  const highPriorityQuestions = updatedQuestions.filter((question) => question.priority === 'high' || question.priority === 'critical')
  if (highPriorityQuestions.length > 0 && highPriorityQuestions.every((question) => question.status !== 'covered')) {
    recordProductionRunDiagnosticEvents(repositories, run, 'gap_filling', [{ kind: 'high_priority_coverage_zero', questions: updatedQuestions }])
  }
  return { ...input, coverageComplete: updatedQuestions.filter((question) => question.priority === 'high' || question.priority === 'critical').every((question) => question.status === 'covered'), marginalNewEvidenceCount: extraction.createdCount, iterations: settled?.ordinal ?? run.usage.iterations + 1, maxIterations: run.budget.maxIterations, iterationId: settled?.id ?? input.iterationId, stopDecision: null, limitations: projection.limitations }
}

export function createAssessIterationStep(dependencies: { repositories: DeepResearchRepositories; evidenceService: EvidenceService }) {
  return createStep({
    id: 'deep-research-assess-iteration',
    inputSchema: iterationContextSchema,
    outputSchema: iterationContextSchema,
    execute: async ({ inputData }) => assessIteration(inputData, dependencies),
  })
}
