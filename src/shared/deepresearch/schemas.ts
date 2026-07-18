import { z } from 'zod'

const jsonObjectSchema = z.record(z.string(), z.unknown())

export const researchRunStatusSchema = z.enum([
  'queued',
  'planning',
  'researching',
  'assessing_coverage',
  'gap_filling',
  'synthesizing',
  'verifying',
  'completed',
  'completed_with_limitations',
  'awaiting_input',
  'cancelling',
  'cancelled',
  'interrupted',
  'failed',
])
export const researchAttemptStatusSchema = z.enum(['queued', 'running', 'cancelling', 'cancelled', 'succeeded', 'failed', 'interrupted'])
export const researchAttemptTriggerSchema = z.enum(['initial', 'manual_resume', 'auto_resume', 'retry'])
export const researchErrorCategorySchema = z.enum([
  'cancelled',
  'validation',
  'budget',
  'provider',
  'network',
  'timeout',
  'rate_limit',
  'concurrency',
  'workflow',
  'internal',
])
export const researchCheckpointStatusSchema = z.enum(['started', 'completed', 'invalidated', 'skipped'])
export const researchCheckpointReplayPolicySchema = z.enum(['reuse', 'retry_incomplete', 'invalidate_if_version_changed'])
export const researchIterationStatusSchema = z.enum(['planned', 'executing', 'assessed', 'completed', 'stopped'])
export const researchLoopDecisionSchema = z.enum([
  'continue',
  'stop_covered',
  'stop_budget',
  'stop_no_material_gain',
  'stop_no_actionable_gaps',
  'stop_cancelled',
  'stop_max_iterations',
  'stop_blocked',
])

export const researchIterationStopRuleSchema = z.enum([
  'coverage_reached',
  'budget_exhausted',
  'max_iterations',
  'no_actionable_gaps',
  'no_material_gain',
  'cancellation_requested',
  'blocked_unrecoverable',
])

export const researchBudgetReservationSchema = z.object({
  iterations: z.number().int().nonnegative(),
  searchQueries: z.number().int().nonnegative(),
  fetchedSources: z.number().int().nonnegative(),
  modelTokens: z.number().int().nonnegative(),
  providerCostUsd: z.number().nonnegative(),
})

export const researchBudgetAvailabilitySchema = z.object({
  iterations: z.number().int(),
  searchQueries: z.number().int(),
  fetchedSources: z.number().int(),
  modelTokens: z.number().int().nullable(),
  providerCostUsd: z.number().nullable(),
})

export const researchBudgetSnapshotSchema = z.object({
  consumed: researchBudgetReservationSchema,
  reserved: researchBudgetReservationSchema,
  available: researchBudgetAvailabilitySchema,
})

export const researchBudgetSettlementSchema = z.object({
  spent: researchBudgetReservationSchema,
  released: researchBudgetReservationSchema,
})

export const researchIterationPlanTargetSchema = z.object({
  questionId: z.string().min(1),
  gapCode: z.enum(['NO_EVIDENCE', 'SINGLE_DOMAIN', 'MISSING_REQUIRED_TYPE', 'NO_AUTHORITATIVE_SOURCE', 'STALE_EVIDENCE', 'UNRESOLVED_CONTRADICTION', 'INSUFFICIENT_CONFIDENCE']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  remediation: z.enum(['search_primary', 'search_independent', 'search_recent', 'search_counterevidence', 'disclose_limitation']),
  searchIntent: z.string().min(1),
  query: z.string().min(1),
  expectedValue: z.number().nonnegative(),
})

export const researchIterationDecisionInputSummarySchema = z.object({
  assessmentFingerprints: z.array(z.string().min(1)),
  previousAssessmentFingerprint: z.string().min(1).nullable(),
  historyIterationCount: z.number().int().nonnegative(),
  consecutiveNoMaterialGain: z.number().int().nonnegative(),
  actionableGapCount: z.number().int().nonnegative(),
  actionableQueryCount: z.number().int().nonnegative(),
  cancellationRequested: z.boolean(),
  usage: z.object({
    questions: z.number(),
    iterations: z.number(),
    searchQueries: z.number(),
    normalizedSources: z.number(),
    fetchedSources: z.number(),
    tokens: z.number(),
    providerCostUsd: z.number(),
    startedAt: z.number().nullable(),
    deadlineAt: z.number().nullable(),
  }),
  activeReservation: researchBudgetReservationSchema,
})

export const researchIterationPlanSchema = z.object({
  version: z.literal(1),
  targets: z.array(researchIterationPlanTargetSchema),
  reservation: researchBudgetReservationSchema,
  inputSummary: researchIterationDecisionInputSummarySchema,
  settlement: researchBudgetSettlementSchema.optional(),
})
export const researchRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  category: researchErrorCategorySchema.optional(),
})

export const researchCheckpointCursorSchema = z.object({
  version: z.literal(1),
  nextPhase: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  pendingQueryIds: z.array(z.string().min(1)).optional(),
  pendingSourceIds: z.array(z.string().min(1)).optional(),
  pendingSectionIds: z.array(z.string().min(1)).optional(),
  workflowVersion: z.string().min(1).optional(),
  profile: z.enum(['general', 'market', 'competitor', 'academic']).optional(),
  policyVersion: z.string().min(1).optional(),
  compatibilityFingerprint: z.string().min(1).optional(),
})

export const researchRunCapabilitiesSchema = z.object({
  canCancel: z.boolean(),
  canResume: z.boolean(),
  canRetry: z.boolean(),
  canProvideClarification: z.boolean(),
})

export const researchCancellationSchema = z.object({
  requestedAt: z.number().nullable(),
  reason: z.string().nullable(),
})

export const researchRunAttemptSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  ordinal: z.number().int().positive(),
  trigger: researchAttemptTriggerSchema,
  status: researchAttemptStatusSchema,
  workflowRunId: z.string().nullable(),
  executorId: z.string().nullable(),
  leaseExpiresAt: z.number().nullable(),
  heartbeatAt: z.number().nullable(),
  startCheckpointKey: z.string().nullable(),
  endCheckpointKey: z.string().nullable(),
  error: researchRunErrorSchema.nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  createdAt: z.number(),
})

export const researchRunExecutionSchema = z.object({
  attempt: researchRunAttemptSchema,
})

export const researchRunCheckpointSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().nullable(),
  sequence: z.number().int().nonnegative(),
  checkpointKey: z.string().min(1),
  phase: z.string().min(1),
  status: researchCheckpointStatusSchema,
  resumeCursor: researchCheckpointCursorSchema,
  inputFingerprint: z.string().min(1),
  outputFingerprint: z.string().nullable(),
  replayPolicy: researchCheckpointReplayPolicySchema,
  createdAt: z.number(),
})

export const researchQuestionCoverageVerdictSchema = z.object({
  questionId: z.string().min(1),
  score: z.number().min(0).max(1),
  verdict: z.enum(['covered', 'limited', 'uncovered']),
  gapCodes: z.array(z.string()),
  limitations: z.array(z.string()),
})


export const researchLoopDecisionDtoSchema = z.object({
  decision: researchLoopDecisionSchema,
  reason: z.string().nullable(),
  limitationCodes: z.array(z.string()),
  matchedRule: researchIterationStopRuleSchema.optional(),
  inputSummary: researchIterationDecisionInputSummarySchema.optional(),
  limitations: z.array(z.string()).optional(),
})

export const researchIterationSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  ordinal: z.number().int().positive(),
  status: researchIterationStatusSchema,
  decision: researchLoopDecisionSchema.nullable(),
  targetQuestionIds: z.array(z.string().min(1)),
  plannedQueryCount: z.number().int().nonnegative(),
  executedQueryCount: z.number().int().nonnegative(),
  newSourceCount: z.number().int().nonnegative(),
  newEvidenceCount: z.number().int().nonnegative(),
  stopReason: researchLoopDecisionDtoSchema.nullable(),
  plan: researchIterationPlanSchema.optional(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
})

export const researchBriefSchema = z.object({
  title: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  scope: z.string(),
  assumptions: z.array(z.string()),
  plannedSections: z.array(z.string()),
  criticalClarificationIds: z.array(z.string()),
})

export const researchBudgetSchema = z.object({
  maxQuestions: z.number(),
  maxIterations: z.number(),
  maxSearchQueries: z.number(),
  maxNormalizedSources: z.number(),
  maxFetchedSources: z.number(),
  searchConcurrency: z.number(),
  fetchConcurrency: z.number(),
  maxDurationMs: z.number(),
  maxTokens: z.number().optional(),
  maxProviderCostUsd: z.number().optional(),
})

export const researchUsageSchema = z.object({
  questions: z.number(),
  iterations: z.number(),
  searchQueries: z.number(),
  normalizedSources: z.number(),
  fetchedSources: z.number(),
  tokens: z.number(),
  providerCostUsd: z.number(),
  startedAt: z.number().nullable(),
  deadlineAt: z.number().nullable(),
})

export const researchQualitySchema = z.object({
  releaseStatus: z.enum(['completed', 'completed_with_limitations', 'failed']),
  highPriorityQuestionCoverage: z.number(),
  factualClaimCitationCoverage: z.number(),
  supportedCitationCoverage: z.number(),
  independentCitedDomainCount: z.number(),
  contradictionDisclosureCoverage: z.number(),
  requiredSectionCoverage: z.number(),
  limitations: z.array(z.string()),
  assessorVersion: z.string(),
})

/** Parses V1 and additive V2 Run payloads, normalizing V1 recovery fields to V2-safe defaults. */
const fallbackResearchRunCapabilities = (
  status: z.infer<typeof researchRunStatusSchema>,
  error: z.infer<typeof researchRunErrorSchema> | null,
): z.infer<typeof researchRunCapabilitiesSchema> => {
  const retryableFailure = status === 'failed' && error?.retryable === true
  const canCancel = [
    'queued',
    'planning',
    'researching',
    'assessing_coverage',
    'gap_filling',
    'synthesizing',
    'verifying',
    'awaiting_input',
    'interrupted',
  ].includes(status)

  return {
    canCancel,
    canResume: status === 'interrupted' || retryableFailure,
    canRetry: retryableFailure,
    canProvideClarification: status === 'awaiting_input',
  }
}

export const researchRunDtoSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().nullable(),
  topic: z.string(),
  profile: z.enum(['general', 'market', 'competitor', 'academic']),
  depth: z.enum(['standard', 'deep', 'exhaustive']),
  status: researchRunStatusSchema,
  phase: z.string(),
  progress: z.number(),
  brief: researchBriefSchema.nullable(),
  workflowRunId: z.string().nullable(),
  budget: researchBudgetSchema,
  usage: researchUsageSchema,
  quality: researchQualitySchema.nullable(),
  reportArtifactId: z.string().nullable(),
  resumePhase: z.string().nullable(),
  error: researchRunErrorSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  stateVersion: z.number().int().nonnegative().optional(),
  currentAttemptId: z.string().nullable().optional(),
  checkpointCursor: researchCheckpointCursorSchema.nullable().optional(),
  execution: researchRunExecutionSchema.nullable().optional(),
  latestCheckpoint: researchRunCheckpointSchema.nullable().optional(),
  cancellation: researchCancellationSchema.nullable().optional(),
  capabilities: researchRunCapabilitiesSchema.optional(),
}).transform((run) => ({
  ...run,
  checkpointCursor: run.checkpointCursor ?? (run.resumePhase
    ? { version: 1 as const, nextPhase: run.resumePhase, iteration: 0 }
    : null),
  execution: run.execution ?? null,
  latestCheckpoint: run.latestCheckpoint ?? null,
  cancellation: run.cancellation ?? null,
  capabilities: run.capabilities ?? fallbackResearchRunCapabilities(run.status, run.error),
}))

export const researchCoverageSchema = z.object({
  questionId: z.string().min(1),
  score: z.number(),
  independentDomainCount: z.number().int().nonnegative(),
  evidenceCategories: z.array(z.string()),
  primarySourceCount: z.number().int().nonnegative(),
  recentSourceCount: z.number().int().nonnegative(),
  supportingEvidenceCount: z.number().int().nonnegative(),
  contradictingEvidenceCount: z.number().int().nonnegative(),
  hasSingleSourceDependency: z.boolean(),
  gaps: z.array(z.string()),
})

export const researchCoverageGapV2Schema = z.object({
  code: z.enum([
    'NO_EVIDENCE',
    'SINGLE_DOMAIN',
    'MISSING_REQUIRED_TYPE',
    'NO_AUTHORITATIVE_SOURCE',
    'STALE_EVIDENCE',
    'UNRESOLVED_CONTRADICTION',
    'INSUFFICIENT_CONFIDENCE',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  remediable: z.boolean(),
  remediation: z.enum(['search_primary', 'search_independent', 'search_recent', 'search_counterevidence', 'disclose_limitation']),
  recommendedSearchIntent: z.string().nullable(),
})

export const researchCoverageAssessmentV2Schema = z.object({
  policyVersion: z.literal('v2'),
  profile: z.enum(['general', 'market', 'competitor', 'academic']),
  questionId: z.string().min(1),
  inputFingerprint: z.string().min(1),
  score: z.number().min(0).max(1),
  verdict: z.enum(['covered', 'limited', 'uncovered', 'blocked']),
  dimensions: z.object({
    evidenceSufficiency: z.number().min(0).max(1),
    independentCorroboration: z.number().min(0).max(1),
    authority: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    requiredEvidenceTypes: z.number().min(0).max(1),
    contradictionHandling: z.number().min(0).max(1),
  }),
  sourceCounts: z.object({
    evidence: z.number().int().nonnegative(),
    distinctSources: z.number().int().nonnegative(),
    independentDomains: z.number().int().nonnegative(),
    primaryOrAuthoritative: z.number().int().nonnegative(),
    recent: z.number().int().nonnegative(),
  }),
  support: z.object({
    supporting: z.number().int().nonnegative(),
    contradicting: z.number().int().nonnegative(),
    contextual: z.number().int().nonnegative(),
  }),
  gaps: z.array(researchCoverageGapV2Schema),
  limitation: z.string().nullable(),
  suggestedSearchIntents: z.array(z.string()),
  materialGain: z.object({
    scoreDelta: z.number(),
    verdictImproved: z.boolean(),
    material: z.boolean(),
    reason: z.string(),
  }).nullable(),
  assessedAt: z.number(),
})

export const researchCoverageAssessmentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1).nullable(),
  iterationId: z.string().min(1).nullable(),
  iteration: z.number().int().nonnegative(),
  policyVersion: z.string().min(1),
  inputFingerprint: z.string().min(1),
  aggregateScore: z.number().min(0).max(1),
  questionVerdicts: z.array(researchQuestionCoverageVerdictSchema),
  questionAssessments: z.array(researchCoverageAssessmentV2Schema),
  coverageProjections: z.array(researchCoverageSchema),
  limitations: z.array(z.string()),
  createdAt: z.number(),
})

export const researchRunAttemptSummarySchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  trigger: researchAttemptTriggerSchema,
  status: researchAttemptStatusSchema,
  startCheckpointKey: z.string().min(1).nullable(),
  endCheckpointKey: z.string().min(1).nullable(),
  error: researchRunErrorSchema.nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  createdAt: z.number(),
})

export const researchRunCheckpointSummarySchema = z.object({
  id: z.string().min(1),
  attemptId: z.string().min(1).nullable(),
  sequence: z.number().int().positive(),
  checkpointKey: z.string().min(1),
  phase: z.string().min(1),
  status: researchCheckpointStatusSchema,
  resumeCursor: researchCheckpointCursorSchema,
  replayPolicy: researchCheckpointReplayPolicySchema,
  createdAt: z.number(),
})

export const researchHistoryPageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item),
  nextCursor: z.string().min(1).nullable(),
})

export const researchRunLifecycleSchema = z.object({
  currentAttempt: researchRunAttemptSummarySchema.nullable(),
  resumeCheckpoint: researchRunCheckpointSummarySchema.nullable(),
  assessment: researchCoverageAssessmentSchema.nullable(),
  attemptHistory: researchHistoryPageSchema(researchRunAttemptSummarySchema),
  iterationHistory: researchHistoryPageSchema(researchIterationSchema),
  budget: z.object({ limit: researchBudgetSchema, usage: researchUsageSchema }),
  stopReason: researchLoopDecisionDtoSchema.nullable(),
  limitations: z.array(z.string()),
  cancellation: researchCancellationSchema.nullable(),
  capabilities: researchRunCapabilitiesSchema,
})

export const researchEventSchema = z.object({
  eventId: z.string().min(1).optional(),
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: z.string().min(1),
  phase: z.string(),
  timestamp: z.number(),
  payload: jsonObjectSchema,
})

export const startResearchSchema = z.object({
  sessionId: z.string().min(1).optional(),
  topic: z.string().trim().min(3).max(4000),
  profile: z.enum(['general', 'market', 'competitor', 'academic']),
  depth: z.enum(['standard', 'deep', 'exhaustive']),
  objective: z.string().trim().min(1).max(4000).optional(),
  audience: z.string().trim().min(1).max(500).optional(),
  geography: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  timeRange: z.object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
  }).optional(),
  preferredDomains: z.array(z.string().trim().min(1).max(253)).max(30).optional(),
  excludedDomains: z.array(z.string().trim().min(1).max(253)).max(30).optional(),
  attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  model: z.string().min(1).optional(),
})

export const clarificationSchema = z.object({
  clarificationId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(4000),
})
