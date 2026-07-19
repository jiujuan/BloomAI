import { describe, expect, it } from 'vitest'
import { DEFAULT_RESEARCH_QUALITY_GATE_POLICY, parseResearchQualityGatePolicy } from './quality-policy'

describe('Research quality gate policy', () => {
  it('uses a safe default for missing or malformed administrator configuration', () => {
    expect(parseResearchQualityGatePolicy(null)).toMatchObject(DEFAULT_RESEARCH_QUALITY_GATE_POLICY)
    expect(parseResearchQualityGatePolicy('{not json}')).toMatchObject(DEFAULT_RESEARCH_QUALITY_GATE_POLICY)
    expect(parseResearchQualityGatePolicy(JSON.stringify({ highPriorityCoverageThreshold: 2 }))).toMatchObject(DEFAULT_RESEARCH_QUALITY_GATE_POLICY)
  })

  it('accepts bounded administrator-managed release thresholds', () => {
    expect(parseResearchQualityGatePolicy(JSON.stringify({
      version: 'operations-policy-v1', highPriorityCoverageThreshold: 0.85,
      minKeySectionLength: 220, minIndependentDomainsPerKeySection: 2,
      allowLimitedPublication: false,
    }))).toMatchObject({
      version: 'operations-policy-v1', highPriorityCoverageThreshold: 0.85,
      minKeySectionLength: 220, minIndependentDomainsPerKeySection: 2,
      allowLimitedPublication: false,
    })
  })
})
