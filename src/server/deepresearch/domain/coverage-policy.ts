import { createHash } from 'node:crypto'
import type {
  CoveragePolicyV2GapCode,
  CoveragePolicyV2Remediation,
  ResearchCoverageAssessmentV2Dto,
  ResearchCoverageGapV2Dto,
  ResearchCoverageMaterialGainDto,
  ResearchProfile,
} from '@shared/deepresearch/contracts'
import { createCoverageProfileV2Fingerprint, getCoverageProfileV2, getCoverageProfileV2FingerprintPayload } from './coverage-profiles'

export const COVERAGE_POLICY_V2_VERSION = 'v2' as const

export interface CoveragePolicyEvidence {
  id: string
  sourceId: string
  domain: string
  sourceType: string
  publishedAt: number | null
  stance: 'supporting' | 'contradicting' | 'contextual'
  confidence: number
}

export interface SingleAuthoritativeSourceException {
  reason: string
}

export interface CoveragePolicyV2Input {
  questionId: string
  question: string
  intent: string
  profile: ResearchProfile
  priority: 'low' | 'medium' | 'high' | 'critical'
  requiredEvidenceTypes: readonly string[]
  evidence: readonly CoveragePolicyEvidence[]
  assessedAt: number
  /** A blocked question never becomes covered even if its current evidence scores well. */
  blockedReason?: string | null
  /** Use only when the research scope objectively admits one authoritative publisher. */
  singleAuthoritativeSourceException?: SingleAuthoritativeSourceException | null
  previousAssessment?: Pick<ResearchCoverageAssessmentV2Dto, 'score' | 'verdict'> | null
}

const AUTHORITATIVE_SOURCE_TYPE = /(primary|official|regulatory|filing|peer[- ]?reviewed|peer[- ]?review|conference[- ]?paper|academic[- ]?paper|\bpaper\b|dataset|survey|statistics|research[- ]?institute|institutional[- ]?repository)/i
const SCORE_PRECISION = 1_000
const VERDICT_RANK = { uncovered: 0, limited: 1, covered: 2, blocked: -1 } as const

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * SCORE_PRECISION) / SCORE_PRECISION))
}

function round(value: number): number {
  return Math.round(value * SCORE_PRECISION) / SCORE_PRECISION
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeDomain(domain: string): string {
  return normalize(domain).replace(/^www\./, '')
}

function isAuthoritative(sourceType: string): boolean {
  return AUTHORITATIVE_SOURCE_TYPE.test(sourceType)
}

function safeConfidence(value: number): number {
  return clampScore(Number.isFinite(value) ? value : 0)
}

function gapSeverity(priority: CoveragePolicyV2Input['priority']): ResearchCoverageGapV2Dto['severity'] {
  return priority
}

function remediationForGap(code: CoveragePolicyV2GapCode, exceptionalSingleSource: boolean): CoveragePolicyV2Remediation {
  if (exceptionalSingleSource && (code === 'SINGLE_DOMAIN' || code === 'NO_AUTHORITATIVE_SOURCE')) return 'disclose_limitation'
  if (code === 'NO_EVIDENCE' || code === 'NO_AUTHORITATIVE_SOURCE' || code === 'MISSING_REQUIRED_TYPE') return 'search_primary'
  if (code === 'SINGLE_DOMAIN') return 'search_independent'
  if (code === 'STALE_EVIDENCE') return 'search_recent'
  if (code === 'UNRESOLVED_CONTRADICTION') return 'search_counterevidence'
  return 'search_primary'
}

function searchIntentForGap(input: CoveragePolicyV2Input, code: CoveragePolicyV2GapCode, exceptionalSingleSource: boolean): string | null {
  if (exceptionalSingleSource && (code === 'SINGLE_DOMAIN' || code === 'NO_AUTHORITATIVE_SOURCE')) return null
  const subject = input.intent.trim() || input.question.trim()
  const prefix = subject ? `${subject}: ` : ''
  if (code === 'NO_EVIDENCE') return `${prefix}find citable primary or authoritative evidence`
  if (code === 'SINGLE_DOMAIN') return `${prefix}find an independent domain that corroborates the conclusion`
  if (code === 'MISSING_REQUIRED_TYPE') return `${prefix}find the required evidence type: ${input.requiredEvidenceTypes.join(', ')}`
  if (code === 'NO_AUTHORITATIVE_SOURCE') return `${prefix}find an authoritative primary, official, regulatory, or peer-reviewed source`
  if (code === 'STALE_EVIDENCE') return `${prefix}find recent evidence within the profile recency window`
  if (code === 'UNRESOLVED_CONTRADICTION') return `${prefix}find counterevidence and explain the conflicting findings`
  return `${prefix}find higher-confidence, directly relevant evidence`
}

function createGap(input: CoveragePolicyV2Input, code: CoveragePolicyV2GapCode, exceptionalSingleSource: boolean): ResearchCoverageGapV2Dto {
  const remediation = remediationForGap(code, exceptionalSingleSource)
  return {
    code,
    severity: gapSeverity(input.priority),
    remediable: remediation !== 'disclose_limitation',
    remediation,
    recommendedSearchIntent: searchIntentForGap(input, code, exceptionalSingleSource),
  }
}

function sortEvidence(evidence: readonly CoveragePolicyEvidence[]): CoveragePolicyEvidence[] {
  return [...evidence].sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.sourceId.localeCompare(right.sourceId)
    || normalizeDomain(left.domain).localeCompare(normalizeDomain(right.domain))
    || left.stance.localeCompare(right.stance)
  ))
}

/**
 * Every value in this payload can change a Coverage Policy V2 output. Keep it
 * audit-friendly so one fingerprint always identifies one replayable input.
 */
export function createCoveragePolicyV2CanonicalInput(input: Omit<CoveragePolicyV2Input, 'previousAssessment'>) {
  return {
    policyVersion: COVERAGE_POLICY_V2_VERSION,
    profile: input.profile,
    profilePolicyVersion: getCoverageProfileV2(input.profile).policyVersion,
    profilePolicyFingerprint: createCoverageProfileV2Fingerprint(input.profile),
    profilePolicy: getCoverageProfileV2FingerprintPayload(input.profile),
    questionId: input.questionId,
    question: input.question,
    intent: input.intent,
    priority: input.priority,
    assessedAt: input.assessedAt,
    requiredEvidenceTypes: [...input.requiredEvidenceTypes].map(normalize).sort(),
    blockedReason: input.blockedReason ?? null,
    singleAuthoritativeSourceException: input.singleAuthoritativeSourceException?.reason ?? null,
    evidence: sortEvidence(input.evidence).map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      domain: normalizeDomain(item.domain),
      sourceType: normalize(item.sourceType),
      publishedAt: item.publishedAt,
      stance: item.stance,
      confidence: safeConfidence(item.confidence),
    })),
  }
}

export function createCoveragePolicyV2InputFingerprint(input: Omit<CoveragePolicyV2Input, 'previousAssessment'>): string {
  return createHash('sha256').update(JSON.stringify(createCoveragePolicyV2CanonicalInput(input))).digest('hex')
}

function assessMaterialGain(
  input: CoveragePolicyV2Input,
  score: number,
  verdict: ResearchCoverageAssessmentV2Dto['verdict'],
): ResearchCoverageMaterialGainDto | null {
  const previous = input.previousAssessment
  if (!previous) return null
  const scoreDelta = round(score - previous.score)
  const verdictImproved = VERDICT_RANK[verdict] > VERDICT_RANK[previous.verdict]
  const requiresVerdictImprovement = input.priority === 'high' || input.priority === 'critical'
  const material = scoreDelta >= 0.05 && (!requiresVerdictImprovement || verdictImproved)
  return {
    scoreDelta,
    verdictImproved,
    material,
    reason: material
      ? 'score and required verdict thresholds improved'
      : requiresVerdictImprovement && scoreDelta >= 0.05
        ? 'score improved but the high-priority verdict did not improve'
        : scoreDelta < 0.05
          ? 'score improvement is below the material-gain threshold'
          : 'verdict did not improve',
  }
}

/**
 * Deterministic, side-effect-free Coverage Policy V2. Callers provide all
 * time and evidence inputs explicitly so the result can be replayed exactly.
 */
export function assessCoveragePolicyV2(input: CoveragePolicyV2Input): ResearchCoverageAssessmentV2Dto {
  const profile = getCoverageProfileV2(input.profile)
  const evidence = sortEvidence(input.evidence)
  const sourceRecords = [...new Map(evidence.map((item) => [item.sourceId, item])).values()]
  const domains = new Set(sourceRecords.map((item) => normalizeDomain(item.domain)).filter(Boolean))
  const sources = new Set(sourceRecords.map((item) => item.sourceId))
  const authoritative = sourceRecords.filter((item) => isAuthoritative(item.sourceType))
  const recentCutoff = input.assessedAt - profile.maxEvidenceAgeDays * 24 * 60 * 60 * 1_000
  const recent = sourceRecords.filter((item) => item.publishedAt !== null && item.publishedAt >= recentCutoff && item.publishedAt <= input.assessedAt)
  const supporting = evidence.filter((item) => item.stance === 'supporting')
  const contradicting = evidence.filter((item) => item.stance === 'contradicting')
  const contextual = evidence.filter((item) => item.stance === 'contextual')
  const requiredTypes = [...new Set(input.requiredEvidenceTypes.map(normalize).filter(Boolean))]
  const availableTypes = new Set(evidence.map((item) => normalize(item.sourceType)))
  const coveredRequiredTypes = requiredTypes.filter((type) => availableTypes.has(type))
  const exceptionalSingleSource = Boolean(input.singleAuthoritativeSourceException)
  const confidenceMass = evidence.reduce((sum, item) => sum + safeConfidence(item.confidence), 0)
  const evidenceSufficiency = clampScore(confidenceMass / profile.minimumEvidenceByPriority[input.priority])
  const independentCorroboration = clampScore(domains.size / profile.minimumIndependentDomainsByPriority[input.priority])
  const authority = clampScore(authoritative.length / profile.minimumAuthoritativeSourcesByPriority[input.priority])
  const recency = sourceRecords.length === 0 ? 0 : clampScore(recent.length / sourceRecords.length)
  const requiredEvidenceTypes = requiredTypes.length === 0 ? 1 : clampScore(coveredRequiredTypes.length / requiredTypes.length)
  const contradictionHandling = contradicting.length === 0
    ? 1
    : supporting.length > 0 && new Set([...supporting, ...contradicting].map((item) => normalizeDomain(item.domain))).size >= 2
      ? 0.75
      : 0
  const dimensions = {
    evidenceSufficiency,
    independentCorroboration,
    authority,
    recency,
    requiredEvidenceTypes,
    contradictionHandling,
  }
  const score = clampScore(
    dimensions.evidenceSufficiency * profile.weights.evidenceSufficiency
    + dimensions.independentCorroboration * profile.weights.independentCorroboration
    + dimensions.authority * profile.weights.authority
    + dimensions.requiredEvidenceTypes * profile.weights.requiredEvidenceTypes
    + dimensions.recency * profile.weights.recency
    + dimensions.contradictionHandling * profile.weights.contradictionHandling,
  )

  const gaps: ResearchCoverageGapV2Dto[] = []
  if (evidence.length === 0) gaps.push(createGap(input, 'NO_EVIDENCE', exceptionalSingleSource))
  const sufficientEvidence = evidence.length >= profile.minimumEvidenceByPriority[input.priority]
    && confidenceMass >= profile.minimumEvidenceByPriority[input.priority] * 0.75
  if (!sufficientEvidence) gaps.push(createGap(input, 'INSUFFICIENT_CONFIDENCE', exceptionalSingleSource))
  if (requiredEvidenceTypes < 1) gaps.push(createGap(input, 'MISSING_REQUIRED_TYPE', exceptionalSingleSource))
  if (domains.size < profile.minimumIndependentDomainsByPriority[input.priority] || (exceptionalSingleSource && domains.size < 2)) gaps.push(createGap(input, 'SINGLE_DOMAIN', exceptionalSingleSource))
  if (authoritative.length < profile.minimumAuthoritativeSourcesByPriority[input.priority]) gaps.push(createGap(input, 'NO_AUTHORITATIVE_SOURCE', exceptionalSingleSource))
  if (evidence.length > 0 && recency < 0.5) gaps.push(createGap(input, 'STALE_EVIDENCE', exceptionalSingleSource))
  if (contradictionHandling < 1) gaps.push(createGap(input, 'UNRESOLVED_CONTRADICTION', exceptionalSingleSource))

  const threshold = { critical: 0.85, high: 0.80, medium: 0.70, low: 0.60 }[input.priority]
  const minimumsMet = sufficientEvidence
    && independentCorroboration >= 1
    && authority >= 1
    && requiredEvidenceTypes >= 1
    && recency >= 0.5
    && contradictionHandling >= 1
  const limitation = input.blockedReason
    ?? (exceptionalSingleSource ? input.singleAuthoritativeSourceException!.reason : null)
  const verdict: ResearchCoverageAssessmentV2Dto['verdict'] = input.blockedReason
    ? 'blocked'
    : evidence.length === 0
      ? 'uncovered'
      : score >= threshold && minimumsMet && !exceptionalSingleSource
        ? 'covered'
        : 'limited'
  const suggestedSearchIntents = [...new Set(gaps.map((gap) => gap.recommendedSearchIntent).filter((intent): intent is string => Boolean(intent)))]

  return {
    policyVersion: COVERAGE_POLICY_V2_VERSION,
    profile: input.profile,
    questionId: input.questionId,
    inputFingerprint: createCoveragePolicyV2InputFingerprint(input),
    score,
    verdict,
    dimensions,
    sourceCounts: {
      evidence: evidence.length,
      distinctSources: sources.size,
      independentDomains: domains.size,
      primaryOrAuthoritative: authoritative.length,
      recent: recent.length,
    },
    support: {
      supporting: supporting.length,
      contradicting: contradicting.length,
      contextual: contextual.length,
    },
    gaps,
    limitation,
    suggestedSearchIntents,
    materialGain: assessMaterialGain(input, score, verdict),
    assessedAt: input.assessedAt,
  }
}
