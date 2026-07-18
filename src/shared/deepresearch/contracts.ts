export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }

export type ResearchProfile = 'general' | 'market' | 'competitor' | 'academic'
export type ResearchDepth = 'standard' | 'deep' | 'exhaustive'

export type ResearchRunStatus =
  | 'queued'
  | 'planning'
  | 'researching'
  | 'assessing_coverage'
  | 'gap_filling'
  | 'synthesizing'
  | 'verifying'
  | 'completed'
  | 'completed_with_limitations'
  | 'awaiting_input'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted'
  | 'failed'

/** The execution lifecycle for one start, resume, or retry of a Run. */
export type ResearchAttemptStatus = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed' | 'interrupted'
export type ResearchAttemptTrigger = 'initial' | 'manual_resume' | 'auto_resume' | 'retry'
export type ResearchCheckpointStatus = 'started' | 'completed' | 'invalidated' | 'skipped'
export type ResearchCheckpointReplayPolicy = 'reuse' | 'retry_incomplete' | 'invalidate_if_version_changed'
export type ResearchErrorCategory =
  | 'cancelled'
  | 'validation'
  | 'budget'
  | 'provider'
  | 'network'
  | 'timeout'
  | 'rate_limit'
  | 'concurrency'
  | 'workflow'
  | 'internal'
export type ResearchIterationStatus = 'planned' | 'executing' | 'assessed' | 'completed' | 'stopped'
export type ResearchLoopDecision =
  | 'continue'
  | 'stop_covered'
  | 'stop_budget'
  | 'stop_no_material_gain'
  | 'stop_no_actionable_gaps'
  | 'stop_cancelled'
  | 'stop_max_iterations'
  | 'stop_blocked'

export type ResearchIterationStopRule =
  | 'coverage_reached'
  | 'budget_exhausted'
  | 'max_iterations'
  | 'no_actionable_gaps'
  | 'no_material_gain'
  | 'cancellation_requested'
  | 'blocked_unrecoverable'

/** Budget capacity reserved before one planned gap-filling iteration is dispatched. */
export interface ResearchBudgetReservationDto {
  iterations: number
  searchQueries: number
  fetchedSources: number
  modelTokens: number
  providerCostUsd: number
}

export interface ResearchBudgetAvailabilityDto {
  iterations: number
  searchQueries: number
  fetchedSources: number
  modelTokens: number | null
  providerCostUsd: number | null
}

export interface ResearchBudgetSnapshotDto {
  consumed: ResearchBudgetReservationDto
  reserved: ResearchBudgetReservationDto
  available: ResearchBudgetAvailabilityDto
}

export interface ResearchBudgetSettlementDto {
  spent: ResearchBudgetReservationDto
  released: ResearchBudgetReservationDto
}

export interface ResearchIterationPlanTargetDto {
  questionId: string
  gapCode: CoveragePolicyV2GapCode
  severity: 'critical' | 'high' | 'medium' | 'low'
  remediation: CoveragePolicyV2Remediation
  searchIntent: string
  query: string
  expectedValue: number
}

export interface ResearchIterationDecisionInputSummaryDto {
  assessmentFingerprints: string[]
  previousAssessmentFingerprint: string | null
  historyIterationCount: number
  consecutiveNoMaterialGain: number
  actionableGapCount: number
  actionableQueryCount: number
  cancellationRequested: boolean
  usage: ResearchUsageDto
  activeReservation: ResearchBudgetReservationDto
}

export interface ResearchIterationPlanDto {
  version: 1
  targets: ResearchIterationPlanTargetDto[]
  reservation: ResearchBudgetReservationDto
  inputSummary: ResearchIterationDecisionInputSummaryDto
  settlement?: ResearchBudgetSettlementDto
}
export interface ResearchTimeRange {
  from?: string
  to?: string
}

export interface StartResearchInput {
  sessionId?: string
  topic: string
  profile: ResearchProfile
  depth: ResearchDepth
  objective?: string
  audience?: string
  geography?: string[]
  timeRange?: ResearchTimeRange
  preferredDomains?: string[]
  excludedDomains?: string[]
  attachmentIds?: string[]
  model?: string
}

export interface ResearchRunFilter {
  sessionId?: string
  statuses?: ResearchRunStatus[]
  profile?: ResearchProfile
  limit?: number
  cursor?: string
}

export interface ResearchClarificationInput {
  clarificationId: string
  answer: string
}

export interface ResearchBriefDto {
  title: string
  objective: string | null
  audience: string | null
  scope: string
  assumptions: string[]
  plannedSections: string[]
  criticalClarificationIds: string[]
}

export interface ResearchBudgetDto {
  maxQuestions: number
  maxIterations: number
  maxSearchQueries: number
  maxNormalizedSources: number
  maxFetchedSources: number
  searchConcurrency: number
  fetchConcurrency: number
  maxDurationMs: number
  maxTokens?: number
  maxProviderCostUsd?: number
}

export interface ResearchUsageDto {
  questions: number
  iterations: number
  searchQueries: number
  normalizedSources: number
  fetchedSources: number
  tokens: number
  providerCostUsd: number
  startedAt: number | null
  deadlineAt: number | null
}

/** A JSON-safe recovery cursor. Missing optional IDs mean that phase resumes from its conservative boundary. */
export interface ResearchCheckpointCursorDto {
  version: 1
  nextPhase: string
  iteration: number
  pendingQueryIds?: string[]
  pendingSourceIds?: string[]
  pendingSectionIds?: string[]
}

export interface ResearchRunErrorDto {
  code: string
  message: string
  retryable: boolean
  /** Optional for V1 compatibility; consumers must use retryable as the recovery authority. */
  category?: ResearchErrorCategory
}

export interface ResearchRunCapabilitiesDto {
  canCancel: boolean
  canResume: boolean
  canRetry: boolean
  canProvideClarification: boolean
}

export interface ResearchCancellationDto {
  requestedAt: number | null
  reason: string | null
}

export interface ResearchRunAttemptDto {
  id: string
  runId: string
  ordinal: number
  trigger: ResearchAttemptTrigger
  status: ResearchAttemptStatus
  workflowRunId: string | null
  executorId: string | null
  leaseExpiresAt: number | null
  heartbeatAt: number | null
  startCheckpointKey: string | null
  endCheckpointKey: string | null
  error: ResearchRunErrorDto | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
}

export interface ResearchRunExecutionDto {
  attempt: ResearchRunAttemptDto
}

export interface ResearchRunCheckpointDto {
  id: string
  runId: string
  attemptId: string | null
  sequence: number
  checkpointKey: string
  phase: string
  status: ResearchCheckpointStatus
  resumeCursor: ResearchCheckpointCursorDto
  inputFingerprint: string
  outputFingerprint: string | null
  replayPolicy: ResearchCheckpointReplayPolicy
  createdAt: number
}

export type CoveragePolicyV2GapCode =
  | 'NO_EVIDENCE'
  | 'SINGLE_DOMAIN'
  | 'MISSING_REQUIRED_TYPE'
  | 'NO_AUTHORITATIVE_SOURCE'
  | 'STALE_EVIDENCE'
  | 'UNRESOLVED_CONTRADICTION'
  | 'INSUFFICIENT_CONFIDENCE'

export type CoveragePolicyV2Remediation =
  | 'search_primary'
  | 'search_independent'
  | 'search_recent'
  | 'search_counterevidence'
  | 'disclose_limitation'

/** Versioned, deterministic coverage-policy output. It is deliberately separate from the V1 UI projection below. */
export interface ResearchCoverageGapV2Dto {
  code: CoveragePolicyV2GapCode
  severity: 'critical' | 'high' | 'medium' | 'low'
  remediable: boolean
  remediation: CoveragePolicyV2Remediation
  recommendedSearchIntent: string | null
}

export interface ResearchCoverageMaterialGainDto {
  scoreDelta: number
  verdictImproved: boolean
  material: boolean
  reason: string
}

export interface ResearchCoverageAssessmentV2Dto {
  policyVersion: 'v2'
  profile: ResearchProfile
  questionId: string
  inputFingerprint: string
  score: number
  verdict: 'covered' | 'limited' | 'uncovered' | 'blocked'
  dimensions: {
    evidenceSufficiency: number
    independentCorroboration: number
    authority: number
    recency: number
    requiredEvidenceTypes: number
    contradictionHandling: number
  }
  sourceCounts: {
    evidence: number
    distinctSources: number
    independentDomains: number
    primaryOrAuthoritative: number
    recent: number
  }
  support: {
    supporting: number
    contradicting: number
    contextual: number
  }
  gaps: ResearchCoverageGapV2Dto[]
  limitation: string | null
  suggestedSearchIntents: string[]
  materialGain: ResearchCoverageMaterialGainDto | null
  assessedAt: number
}

export interface ResearchQuestionCoverageVerdictDto {
  questionId: string
  score: number
  verdict: 'covered' | 'limited' | 'uncovered'
  gapCodes: string[]
  limitations: string[]
}

/** Persisted audit record: V1 projections stay compatible while complete V2 policy outputs stay queryable. */
export interface ResearchCoverageAssessmentDto {
  id: string
  runId: string
  /** Null only for pre-DR2-06 historical records. */
  attemptId: string | null
  iterationId: string | null
  iteration: number
  policyVersion: string
  inputFingerprint: string
  aggregateScore: number
  questionVerdicts: ResearchQuestionCoverageVerdictDto[]
  questionAssessments: ResearchCoverageAssessmentV2Dto[]
  coverageProjections: ResearchCoverageDto[]
  limitations: string[]
  createdAt: number
}

export interface ResearchLoopDecisionDto {
  decision: ResearchLoopDecision
  reason: string | null
  limitationCodes: string[]
  /** Additive audit data. Historical decision records may omit these fields. */
  matchedRule?: ResearchIterationStopRule
  inputSummary?: ResearchIterationDecisionInputSummaryDto
  limitations?: string[]
}

export interface ResearchIterationDto {
  id: string
  runId: string
  ordinal: number
  status: ResearchIterationStatus
  decision: ResearchLoopDecision | null
  targetQuestionIds: string[]
  plannedQueryCount: number
  executedQueryCount: number
  newSourceCount: number
  newEvidenceCount: number
  stopReason: ResearchLoopDecisionDto | null
  /** Optional while pre-DR2-07 rows remain readable. */
  plan?: ResearchIterationPlanDto
  createdAt: number
  completedAt: number | null
}

export interface ResearchRunDto {
  id: string
  sessionId: string | null
  topic: string
  profile: ResearchProfile
  depth: ResearchDepth
  status: ResearchRunStatus
  phase: string
  progress: number
  brief: ResearchBriefDto | null
  workflowRunId: string | null
  budget: ResearchBudgetDto
  usage: ResearchUsageDto
  quality: ResearchQualityDto | null
  reportArtifactId: string | null
  /** V1 compatibility projection of checkpointCursor.nextPhase. */
  resumePhase: string | null
  error: ResearchRunErrorDto | null
  createdAt: number
  updatedAt: number
  completedAt: number | null

  /** V2 fields are optional while historical Run rows and V1 clients are supported. */
  stateVersion?: number
  currentAttemptId?: string | null
  checkpointCursor?: ResearchCheckpointCursorDto | null
  execution?: ResearchRunExecutionDto | null
  latestCheckpoint?: ResearchRunCheckpointDto | null
  cancellation?: ResearchCancellationDto | null
  capabilities?: ResearchRunCapabilitiesDto
}

export interface ResearchQuestionDto {
  id: string
  runId: string
  parentQuestionId: string | null
  ordinal: number
  question: string
  intent: string
  requiredEvidenceTypes: string[]
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'planned' | 'researching' | 'covered' | 'limited'
  coverage: ResearchCoverageDto | null
}

/** V1 coverage projection retained for existing clients. */
export interface ResearchCoverageDto {
  questionId: string
  score: number
  independentDomainCount: number
  evidenceCategories: string[]
  primarySourceCount: number
  recentSourceCount: number
  supportingEvidenceCount: number
  contradictingEvidenceCount: number
  hasSingleSourceDependency: boolean
  gaps: string[]
}

export interface ResearchSearchQueryDto {
  id: string
  runId: string
  questionId: string
  iteration: number
  query: string
  provider: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  resultCount: number
  error: ResearchRunErrorDto | null
  createdAt: number
  completedAt: number | null
}

export interface ResearchSourceDto {
  id: string
  runId: string
  canonicalUrl: string
  domain: string
  title: string | null
  author: string | null
  publisher: string | null
  publishedAt: number | null
  sourceType: string
  selectionStatus: 'discovered' | 'selected' | 'rejected'
  scores: JsonObject
}

export interface ResearchSourceSnapshotDto {
  id: string
  runId: string
  sourceId: string
  contentHash: string
  content: string
  metadata: JsonObject
  fetchedAt: number
  parserVersion: string
  finalUrl: string
  httpStatus: number | null
}

export interface ResearchEvidenceDto {
  id: string
  runId: string
  questionId: string
  snapshotId: string
  passage: string
  summary: string
  stance: 'supporting' | 'contradicting' | 'contextual'
  confidence: number
  startOffset: number
  endOffset: number
}

export interface ResearchReportSectionDto {
  id: string
  runId: string
  ordinal: number
  title: string
  purpose: string
  draft: string | null
  verifiedText: string | null
  status: 'planned' | 'drafted' | 'verified' | 'limited'
}

export interface ResearchClaimDto {
  id: string
  runId: string
  sectionId: string
  text: string
  kind: 'factual' | 'analysis' | 'recommendation' | 'limitation'
  importance: 'low' | 'medium' | 'high' | 'critical'
  verificationStatus: 'supported' | 'partially_supported' | 'unsupported' | 'not_applicable'
  confidence: number
  repairHistory: JsonValue[]
}

export interface ResearchCitationDto {
  id: string
  runId: string
  claimId: string
  evidenceId: string
  entailmentStatus: 'supported' | 'partially_supported' | 'unsupported'
  rationale: string
  ordinal: number
}

export interface ResearchReportDto {
  runId: string
  title: string
  sections: ResearchReportSectionDto[]
  claims: ResearchClaimDto[]
  citations: ResearchCitationDto[]
  generatedAt: number | null
}

export interface ResearchQualityDto {
  releaseStatus: 'completed' | 'completed_with_limitations' | 'failed'
  highPriorityQuestionCoverage: number
  factualClaimCitationCoverage: number
  supportedCitationCoverage: number
  independentCitedDomainCount: number
  contradictionDisclosureCoverage: number
  requiredSectionCoverage: number
  limitations: string[]
  assessorVersion: string
}

export interface ResearchEventDto {
  runId: string
  sequence: number
  type: string
  phase: string
  timestamp: number
  payload: JsonObject
}

export interface ResearchArtifactDto {
  id: string
  runId: string
  type: 'report_markdown' | 'report_markdown_zh_cn' | 'report_json' | 'evidence_appendix' | 'references' | 'run_manifest'
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: number
}

export interface ResearchArtifactContent {
  artifact: ResearchArtifactDto
  content: string
}

export interface ResearchRunDetailDto extends ResearchRunDto {
  questions: ResearchQuestionDto[]
  searchQueries: ResearchSearchQueryDto[]
  sources: ResearchSourceDto[]
  snapshots: ResearchSourceSnapshotDto[]
  evidence: ResearchEvidenceDto[]
  report: ResearchReportDto | null
  events: ResearchEventDto[]
  artifacts: ResearchArtifactDto[]
  attempts?: ResearchRunAttemptDto[]
  iterations?: ResearchIterationDto[]
  coverageAssessments?: ResearchCoverageAssessmentDto[]
}
