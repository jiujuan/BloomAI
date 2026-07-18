import { describe, expect, it } from 'vitest'
import {
  assessCoveragePolicyV2,
  createCoveragePolicyV2CanonicalInput,
  createCoveragePolicyV2InputFingerprint,
  type CoveragePolicyV2Input,
} from './coverage-policy'
import { COVERAGE_FIXTURE_ASSESSED_AT, COVERAGE_POLICY_V2_PROFILE_FIXTURES } from './coverage-policy.fixtures'

describe('Coverage Policy V2', () => {
  it.each(Object.entries(COVERAGE_POLICY_V2_PROFILE_FIXTURES))('returns an immutable-profile deterministic covered result for %s', (_profile, fixture) => {
    const first = assessCoveragePolicyV2(fixture)
    const reordered = assessCoveragePolicyV2({ ...fixture, evidence: [...fixture.evidence].reverse() })

    expect(first).toEqual(reordered)
    expect(first.policyVersion).toBe('v2')
    expect(first.verdict).toBe('covered')
    expect(first.inputFingerprint).toBe(createCoveragePolicyV2InputFingerprint(fixture))
    expect(first.gaps).toEqual([])
  })

  it('fingerprints all input values that can change recency, search intents, or profile-policy scoring', () => {
    const input: CoveragePolicyV2Input = {
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      priority: 'high',
      evidence: [{
        ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence[0],
        publishedAt: COVERAGE_FIXTURE_ASSESSED_AT - 18 * 30 * 24 * 60 * 60 * 1_000,
      }],
    }
    const fingerprint = createCoveragePolicyV2InputFingerprint(input)
    const canonical = createCoveragePolicyV2CanonicalInput(input)
    const questionFallback = { ...input, intent: '' }
    const changedQuestion = { ...questionFallback, question: 'Which independent evidence corroborates the conclusion?' }
    const changedIntent = { ...input, intent: 'independent corroboration' }
    const changedAssessedAt = { ...input, assessedAt: input.assessedAt + 1 }

    expect(canonical).toMatchObject({
      question: input.question,
      intent: input.intent,
      assessedAt: input.assessedAt,
      profilePolicyVersion: 'v2.1',
      profilePolicy: {
        maxEvidenceAgeDays: 540,
        weights: { evidenceSufficiency: 0.25, contradictionHandling: 0.1 },
      },
    })
    expect(canonical.profilePolicyFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(createCoveragePolicyV2InputFingerprint(changedQuestion)).not.toBe(fingerprint)
    expect(createCoveragePolicyV2InputFingerprint(changedIntent)).not.toBe(fingerprint)
    expect(createCoveragePolicyV2InputFingerprint(changedAssessedAt)).not.toBe(fingerprint)
    expect(assessCoveragePolicyV2(changedQuestion).suggestedSearchIntents).not.toEqual(assessCoveragePolicyV2(questionFallback).suggestedSearchIntents)
    expect(assessCoveragePolicyV2(changedAssessedAt).dimensions.recency).toBeLessThan(assessCoveragePolicyV2(input).dimensions.recency)
  })

  it('does not allow multiple low-quality records from one domain to masquerade as independent coverage', () => {
    const result = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      priority: 'high',
      evidence: [
        { ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence[0], id: 'same-domain-1', domain: 'www.one.example', confidence: 0.2 },
        { ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence[1], id: 'same-domain-2', domain: 'one.example', confidence: 0.2 },
      ],
    })

    expect(result.sourceCounts.independentDomains).toBe(1)
    expect(result.verdict).toBe('limited')
    expect(result.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining(['SINGLE_DOMAIN', 'INSUFFICIENT_CONFIDENCE']))
  })

  it('requires independent authoritative sources for a high-priority market question', () => {
    const result = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.market,
      priority: 'high',
      evidence: [{ ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.market.evidence[0] }],
    })

    expect(result.verdict).toBe('limited')
    expect(result.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining(['SINGLE_DOMAIN', 'NO_AUTHORITATIVE_SOURCE']))
    expect(result.suggestedSearchIntents).toEqual(expect.arrayContaining([
      expect.stringContaining('independent domain'),
      expect.stringContaining('authoritative'),
    ]))
    expect(result.gaps.find((gap) => gap.code === 'SINGLE_DOMAIN')).toMatchObject({
      remediation: 'search_independent',
      remediable: true,
    })
    expect(result.gaps.find((gap) => gap.code === 'NO_AUTHORITATIVE_SOURCE')).toMatchObject({
      remediation: 'search_primary',
      remediable: true,
    })
  })

  it('records a non-remediable limitation instead of calling a single-authority exception covered', () => {
    const result = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      priority: 'low',
      evidence: [{ ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence[0] }],
      singleAuthoritativeSourceException: { reason: 'Only the regulator publishes the underlying registry.' },
    })

    expect(result.verdict).toBe('limited')
    expect(result.limitation).toContain('Only the regulator')
    expect(result.gaps.find((gap) => gap.code === 'SINGLE_DOMAIN')).toMatchObject({
      remediable: false,
      remediation: 'disclose_limitation',
      recommendedSearchIntent: null,
    })
  })

  it('marks stale evidence and contradictions as explainable coverage gaps', () => {
    const fixture = COVERAGE_POLICY_V2_PROFILE_FIXTURES.market
    const result = assessCoveragePolicyV2({
      ...fixture,
      evidence: fixture.evidence.map((item, index) => ({
        ...item,
        publishedAt: COVERAGE_FIXTURE_ASSESSED_AT - 366 * 24 * 60 * 60 * 1_000,
        stance: index === 0 ? 'supporting' as const : 'contradicting' as const,
      })),
    })

    expect(result.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining(['STALE_EVIDENCE', 'UNRESOLVED_CONTRADICTION']))
    expect(result.gaps.find((gap) => gap.code === 'UNRESOLVED_CONTRADICTION')?.remediation).toBe('search_counterevidence')
  })

  it('uses profile-specific recency policies without changing the pure input fingerprint contract', () => {
    const publishedAt = COVERAGE_FIXTURE_ASSESSED_AT - 2 * 365 * 24 * 60 * 60 * 1_000
    const general = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      evidence: COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence.map((item) => ({ ...item, publishedAt })),
    })
    const academic = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.academic,
      evidence: COVERAGE_POLICY_V2_PROFILE_FIXTURES.academic.evidence.map((item) => ({ ...item, publishedAt })),
    })

    expect(general.dimensions.recency).toBe(0)
    expect(academic.dimensions.recency).toBe(1)
    expect(general.inputFingerprint).not.toBe(academic.inputFingerprint)
  })

  it('does not count a score-only increment as material gain for high-priority questions', () => {
    const previous: Pick<ReturnType<typeof assessCoveragePolicyV2>, 'score' | 'verdict'> = { score: 0.6, verdict: 'limited' }
    const result = assessCoveragePolicyV2({
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      priority: 'high',
      evidence: [{ ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general.evidence[0] }],
      previousAssessment: previous,
    })

    expect(result.score).toBeGreaterThan(previous.score)
    expect(result.verdict).toBe('limited')
    expect(result.materialGain).toMatchObject({ material: false, verdictImproved: false })
  })

  it('returns blocked deterministically without allowing a blocked question to become covered', () => {
    const input: CoveragePolicyV2Input = {
      ...COVERAGE_POLICY_V2_PROFILE_FIXTURES.general,
      blockedReason: 'The required source is unavailable in the permitted geography.',
    }
    expect(assessCoveragePolicyV2(input)).toMatchObject({ verdict: 'blocked', limitation: input.blockedReason })
  })
})
