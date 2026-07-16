export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }

export type ResearchProfile = 'general' | 'market' | 'competitor' | 'academic'
export type ResearchDepth = 'standard' | 'deep' | 'exhaustive'

export type ResearchRunStatus =
  | 'queued'
  | 'planning'
  | 'researching'
  | 'synthesizing'
  | 'verifying'
  | 'completed'
  | 'completed_with_limitations'
  | 'awaiting_input'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted'
  | 'failed'

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

export interface ResearchRunErrorDto {
  code: string
  message: string
  retryable: boolean
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
  budget: ResearchBudgetDto
  usage: ResearchUsageDto
  quality: ResearchQualityDto | null
  reportArtifactId: string | null
  resumePhase: string | null
  error: ResearchRunErrorDto | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
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
  type: 'report_markdown' | 'report_json' | 'evidence_appendix' | 'references' | 'run_manifest'
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
}
