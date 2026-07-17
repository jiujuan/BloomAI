import { createHash } from 'node:crypto'
import type { ResearchProfile } from '@shared/deepresearch/contracts'

/** Bump when a profile-policy rule changes, in addition to hashing the full configuration. */
export const COVERAGE_PROFILE_V2_POLICY_VERSION = 'v2.1' as const

export interface CoverageDimensionWeights {
  evidenceSufficiency: number
  independentCorroboration: number
  authority: number
  requiredEvidenceTypes: number
  recency: number
  contradictionHandling: number
}

export interface CoverageProfileV2 {
  profile: ResearchProfile
  policyVersion: typeof COVERAGE_PROFILE_V2_POLICY_VERSION
  weights: CoverageDimensionWeights
  maxEvidenceAgeDays: number
  minimumEvidenceByPriority: Readonly<Record<'low' | 'medium' | 'high' | 'critical', number>>
  minimumIndependentDomainsByPriority: Readonly<Record<'low' | 'medium' | 'high' | 'critical', number>>
  minimumAuthoritativeSourcesByPriority: Readonly<Record<'low' | 'medium' | 'high' | 'critical', number>>
}

function freezeNumbers<T extends Record<string, number>>(values: T): Readonly<T> {
  return Object.freeze({ ...values })
}

function freezeProfile(profile: CoverageProfileV2): Readonly<CoverageProfileV2> {
  return Object.freeze({
    ...profile,
    weights: Object.freeze({ ...profile.weights }),
    minimumEvidenceByPriority: freezeNumbers(profile.minimumEvidenceByPriority),
    minimumIndependentDomainsByPriority: freezeNumbers(profile.minimumIndependentDomainsByPriority),
    minimumAuthoritativeSourcesByPriority: freezeNumbers(profile.minimumAuthoritativeSourcesByPriority),
  })
}

const DEFAULT_EVIDENCE_MINIMUMS = freezeNumbers({ low: 1, medium: 2, high: 2, critical: 3 })
const DEFAULT_DOMAIN_MINIMUMS = freezeNumbers({ low: 1, medium: 1, high: 2, critical: 2 })
const DEFAULT_AUTHORITY_MINIMUMS = freezeNumbers({ low: 1, medium: 1, high: 1, critical: 1 })

/**
 * Profile deltas are deliberately data-only. Coverage computation remains in
 * coverage-policy.ts so future policy versions can be audited and tested.
 */
export const COVERAGE_PROFILES_V2: Readonly<Record<ResearchProfile, Readonly<CoverageProfileV2>>> = Object.freeze({
  general: freezeProfile({
    profile: 'general',
    policyVersion: COVERAGE_PROFILE_V2_POLICY_VERSION,
    weights: {
      evidenceSufficiency: 0.25,
      independentCorroboration: 0.20,
      authority: 0.20,
      requiredEvidenceTypes: 0.15,
      recency: 0.10,
      contradictionHandling: 0.10,
    },
    maxEvidenceAgeDays: 18 * 30,
    minimumEvidenceByPriority: DEFAULT_EVIDENCE_MINIMUMS,
    minimumIndependentDomainsByPriority: DEFAULT_DOMAIN_MINIMUMS,
    minimumAuthoritativeSourcesByPriority: DEFAULT_AUTHORITY_MINIMUMS,
  }),
  market: freezeProfile({
    profile: 'market',
    policyVersion: COVERAGE_PROFILE_V2_POLICY_VERSION,
    weights: {
      evidenceSufficiency: 0.22,
      independentCorroboration: 0.20,
      authority: 0.25,
      requiredEvidenceTypes: 0.18,
      recency: 0.10,
      contradictionHandling: 0.05,
    },
    maxEvidenceAgeDays: 365,
    minimumEvidenceByPriority: DEFAULT_EVIDENCE_MINIMUMS,
    minimumIndependentDomainsByPriority: DEFAULT_DOMAIN_MINIMUMS,
    minimumAuthoritativeSourcesByPriority: freezeNumbers({ low: 1, medium: 1, high: 2, critical: 2 }),
  }),
  competitor: freezeProfile({
    profile: 'competitor',
    policyVersion: COVERAGE_PROFILE_V2_POLICY_VERSION,
    weights: {
      evidenceSufficiency: 0.25,
      independentCorroboration: 0.20,
      authority: 0.20,
      requiredEvidenceTypes: 0.15,
      recency: 0.15,
      contradictionHandling: 0.05,
    },
    maxEvidenceAgeDays: 365,
    minimumEvidenceByPriority: DEFAULT_EVIDENCE_MINIMUMS,
    minimumIndependentDomainsByPriority: DEFAULT_DOMAIN_MINIMUMS,
    minimumAuthoritativeSourcesByPriority: DEFAULT_AUTHORITY_MINIMUMS,
  }),
  academic: freezeProfile({
    profile: 'academic',
    policyVersion: COVERAGE_PROFILE_V2_POLICY_VERSION,
    weights: {
      evidenceSufficiency: 0.20,
      independentCorroboration: 0.20,
      authority: 0.25,
      requiredEvidenceTypes: 0.20,
      recency: 0.05,
      contradictionHandling: 0.10,
    },
    maxEvidenceAgeDays: 5 * 365,
    minimumEvidenceByPriority: DEFAULT_EVIDENCE_MINIMUMS,
    minimumIndependentDomainsByPriority: DEFAULT_DOMAIN_MINIMUMS,
    minimumAuthoritativeSourcesByPriority: DEFAULT_AUTHORITY_MINIMUMS,
  }),
})

export function getCoverageProfileV2(profile: ResearchProfile): Readonly<CoverageProfileV2> {
  return COVERAGE_PROFILES_V2[profile]
}


/** Canonical data used by Coverage Policy V2 fingerprints and audit records. */
export function getCoverageProfileV2FingerprintPayload(profile: ResearchProfile): Readonly<Record<string, unknown>> {
  const policy = getCoverageProfileV2(profile)
  return Object.freeze({
    policyVersion: policy.policyVersion,
    profile: policy.profile,
    weights: Object.freeze({ ...policy.weights }),
    maxEvidenceAgeDays: policy.maxEvidenceAgeDays,
    minimumEvidenceByPriority: Object.freeze({ ...policy.minimumEvidenceByPriority }),
    minimumIndependentDomainsByPriority: Object.freeze({ ...policy.minimumIndependentDomainsByPriority }),
    minimumAuthoritativeSourcesByPriority: Object.freeze({ ...policy.minimumAuthoritativeSourcesByPriority }),
  })
}

export function createCoverageProfileV2Fingerprint(profile: ResearchProfile): string {
  return createHash('sha256')
    .update(JSON.stringify(getCoverageProfileV2FingerprintPayload(profile)))
    .digest('hex')
}
