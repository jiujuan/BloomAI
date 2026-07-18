import type { ResearchCheckpointCursorDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { deepResearchTelemetryContext, type DeepResearchRepositories } from '../workflow-context'
import { recordDeepResearchCheckpointReuse } from '@server/telemetry/metrics'
import { throwIfCancellationRequested } from '@server/deepresearch/domain/cancellation'
import {
  createCheckpointCursor,
  createCheckpointReplayFingerprint,
  resolveCheckpointReplay,
  type CheckpointReplayEntities,
} from '@server/deepresearch/domain/checkpoint-replay'

interface WorkflowExecutionContext {
  attemptId: string
  executorId?: string
  ownershipToken: string
  signal?: AbortSignal
  resumeCursor: ResearchCheckpointCursorDto | null
}

const executionByRunId = new Map<string, WorkflowExecutionContext>()
const phaseOrder = [
  'planning', 'plan_questions', 'plan_queries', 'searching', 'curating_sources', 'fetching',
  'extracting_evidence', 'assessing_coverage', 'gap_filling', 'building_outline',
  'drafting_sections', 'extracting_claims', 'verifying_citations', 'repair_report', 'assessing_quality',
  'finalizing_artifacts', 'completed',
]

export function bindWorkflowExecution(runId: string, context: WorkflowExecutionContext | null): void {
  if (context) executionByRunId.set(runId, context)
  else executionByRunId.delete(runId)
}

export function clearWorkflowExecution(runId: string): void {
  executionByRunId.delete(runId)
}

export function getWorkflowExecution(runId: string): WorkflowExecutionContext | undefined {
  return executionByRunId.get(runId)
}


export function assertWorkflowNotCancelled(repositories: DeepResearchRepositories, runId: string): void {
  const execution = getWorkflowExecution(runId)
  throwIfCancellationRequested({
    signal: execution?.signal,
    isCancellationRequested: () => {
      const run = repositories.researchRunRepo.get(runId)
      return run?.status === 'cancelling' || run?.status === 'cancelled' || run?.cancellation?.requestedAt != null
    },
  })
}

export function isReplayPastPhase(runId: string, phase: string): boolean {
  const cursor = getWorkflowExecution(runId)?.resumeCursor
  if (!cursor) return false
  return phaseOrder.indexOf(cursor.nextPhase) > phaseOrder.indexOf(phase)
}

function entitiesFor(repositories: DeepResearchRepositories, run: ResearchRunDto): CheckpointReplayEntities {
  const questions = repositories.researchQuestionRepo.list(run.id)
  const queries = repositories.researchQuestionRepo.listSearchQueries(run.id)
  const sources = repositories.researchSourceRepo.listSources(run.id)
  const snapshots = repositories.researchSourceRepo.listSnapshots(run.id)
  const evidence = repositories.researchEvidenceRepo.list(run.id)
  const sections = repositories.researchReportRepo.listSections(run.id)
  const claims = repositories.researchReportRepo.listClaims(run.id)
  const citations = repositories.researchReportRepo.listCitations(run.id)
  const assessments = repositories.researchCoverageAssessmentRepo.list(run.id)
  const iterations = repositories.researchIterationRepo?.list(run.id) ?? []
  const factualClaims = claims.filter((claim) => claim.kind === 'factual')

  return {
    brief: Boolean(run.brief),
    questions: questions.length > 0,
    queries: queries.length > 0,
    searchedQueries: queries.length > 0 && queries.every((query) => query.status !== 'queued'),
    sources: sources.length > 0,
    snapshots: sources.length > 0 && sources.every((source) => snapshots.some((snapshot) => snapshot.sourceId === source.id)),
    evidence: evidence.length > 0,
    coverageAssessment: assessments.length > 0,
    iterationDecision: iterations.some((iteration) => iteration.decision !== null),
    outline: sections.length > 0,
    draftedSections: sections.length > 0 && sections.every((section) => section.status !== 'planned'),
    claims: claims.length > 0,
    verifiedCitations: factualClaims.every((claim) => citations.some((citation) => citation.claimId === claim.id && citation.entailmentStatus !== 'partially_supported')),
    quality: run.quality !== null,
    artifact: Boolean(run.reportArtifactId && repositories.researchReportRepo.listArtifacts(run.id).some((artifact) => artifact.id === run.reportArtifactId)),
  }
}

export function resolveWorkflowResumeCursor(
  repositories: DeepResearchRepositories,
  run: ResearchRunDto,
  cursor: ResearchCheckpointCursorDto | null,
): { cursor: ResearchCheckpointCursorDto; reused: boolean; reason: string | null } {
  const result = resolveCheckpointReplay({ run, cursor, entities: entitiesFor(repositories, run) })
  if (result.reused) recordDeepResearchCheckpointReuse(deepResearchTelemetryContext(run))
  return result
}

export function checkpointWorkflowPhase(
  repositories: DeepResearchRepositories,
  run: ResearchRunDto,
  phase: string,
  nextPhase: string,
  options: { iteration?: number; pendingQueryIds?: string[]; pendingSourceIds?: string[]; pendingSectionIds?: string[]; outputFingerprint?: string | null } = {},
): void {
  assertWorkflowNotCancelled(repositories, run.id)
  const execution = getWorkflowExecution(run.id)
  const executionAttempt = execution && repositories.researchAttemptRepo.get(execution.attemptId)?.runId === run.id
    ? execution
    : undefined
  const attemptId = executionAttempt?.attemptId ?? run.currentAttemptId
  if (!attemptId || repositories.researchAttemptRepo.get(attemptId)?.runId !== run.id) return
  const cursor = {
    ...createCheckpointCursor(run, nextPhase, options.iteration ?? run.usage.iterations),
    ...(options.pendingQueryIds?.length ? { pendingQueryIds: options.pendingQueryIds } : {}),
    ...(options.pendingSourceIds?.length ? { pendingSourceIds: options.pendingSourceIds } : {}),
    ...(options.pendingSectionIds?.length ? { pendingSectionIds: options.pendingSectionIds } : {}),
  }
  const input = {
    runId: run.id,
    attemptId,
    checkpointKey: `workflow:${phase}:v1`,
    phase,
    resumeCursor: cursor,
    inputFingerprint: createCheckpointReplayFingerprint(run),
    outputFingerprint: options.outputFingerprint ?? null,
    replayPolicy: 'invalidate_if_version_changed' as const,
  }
  if (executionAttempt?.executorId) {
    repositories.researchCheckpointRepo.completeWithOwnership({
      ...input,
      executorId: executionAttempt.executorId,
      ownershipToken: executionAttempt.ownershipToken,
    })
  } else {
    repositories.researchCheckpointRepo.append({ ...input, status: 'completed' })
  }
}
