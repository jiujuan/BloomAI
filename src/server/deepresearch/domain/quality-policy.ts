import type { ResearchProfile } from '@shared/deepresearch/contracts'

export interface ResearchQualityGatePolicy {
  version: string
  highPriorityCoverageThreshold: number
  factualClaimCitationThreshold: number
  keyClaimCitationValidityThreshold: number
  minKeySectionLength: number
  minIndependentDomainsPerKeySection: number
  maxSectionSimilarity: number
  allowLimitedPublication: boolean
}

export const DEFAULT_RESEARCH_QUALITY_GATE_POLICY: Readonly<ResearchQualityGatePolicy> = Object.freeze({
  version: 'deep-research-quality-gates-v2',
  highPriorityCoverageThreshold: 0.8,
  factualClaimCitationThreshold: 0.9,
  keyClaimCitationValidityThreshold: 0.9,
  minKeySectionLength: 160,
  minIndependentDomainsPerKeySection: 1,
  maxSectionSimilarity: 0.82,
  allowLimitedPublication: true,
})

const numericKeys = [
  'highPriorityCoverageThreshold',
  'factualClaimCitationThreshold',
  'keyClaimCitationValidityThreshold',
  'maxSectionSimilarity',
] as const

/** Parses the administrator-managed deep_research_quality_gates setting without allowing malformed values to weaken release gates. */
export function parseResearchQualityGatePolicy(value: string | null | undefined, profile?: ResearchProfile): ResearchQualityGatePolicy {
  if (!value?.trim()) return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY, version: DEFAULT_RESEARCH_QUALITY_GATE_POLICY.version + (profile ? ':' + profile : '') }
  try {
    const candidate = JSON.parse(value) as Partial<ResearchQualityGatePolicy>
    const policy: ResearchQualityGatePolicy = {
      ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY,
      ...candidate,
      version: typeof candidate.version === 'string' && candidate.version.trim() ? candidate.version.trim() : DEFAULT_RESEARCH_QUALITY_GATE_POLICY.version,
    }
    for (const key of numericKeys) {
      if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1) return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY }
    }
    if (!Number.isInteger(policy.minKeySectionLength) || policy.minKeySectionLength < 1 || policy.minKeySectionLength > 20_000) return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY }
    if (!Number.isInteger(policy.minIndependentDomainsPerKeySection) || policy.minIndependentDomainsPerKeySection < 1 || policy.minIndependentDomainsPerKeySection > 20) return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY }
    if (typeof policy.allowLimitedPublication !== 'boolean') return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY }
    return policy
  } catch {
    return { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY }
  }
}
