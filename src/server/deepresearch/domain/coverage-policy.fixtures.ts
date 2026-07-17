import type { CoveragePolicyV2Input } from './coverage-policy'

export const COVERAGE_FIXTURE_ASSESSED_AT = Date.UTC(2026, 6, 17)

function baseFixture(profile: CoveragePolicyV2Input['profile'], sourceType: string): CoveragePolicyV2Input {
  return {
    questionId: `${profile}-question`,
    question: `What evidence answers the ${profile} question?`,
    intent: `${profile} evidence`,
    profile,
    priority: 'medium',
    requiredEvidenceTypes: [sourceType],
    assessedAt: COVERAGE_FIXTURE_ASSESSED_AT,
    evidence: [
      {
        id: `${profile}-evidence-1`,
        sourceId: `${profile}-source-1`,
        domain: `${profile}-primary.example`,
        sourceType,
        publishedAt: Date.UTC(2026, 6, 1),
        stance: 'supporting',
        confidence: 0.95,
      },
      {
        id: `${profile}-evidence-2`,
        sourceId: `${profile}-source-2`,
        domain: `${profile}-independent.example`,
        sourceType,
        publishedAt: Date.UTC(2026, 6, 2),
        stance: 'supporting',
        confidence: 0.9,
      },
    ],
  }
}

export const COVERAGE_POLICY_V2_PROFILE_FIXTURES: Readonly<Record<CoveragePolicyV2Input['profile'], CoveragePolicyV2Input>> = Object.freeze({
  general: baseFixture('general', 'official'),
  market: baseFixture('market', 'official-statistics'),
  competitor: baseFixture('competitor', 'company-primary'),
  academic: baseFixture('academic', 'peer-reviewed-paper'),
})
