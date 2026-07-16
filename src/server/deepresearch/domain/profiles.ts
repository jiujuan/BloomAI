import type { ResearchProfile } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

export interface ResearchProfilePolicy {
  profile: ResearchProfile
  questionCategories: readonly string[]
  requiredSections: readonly string[]
  preferredSourceTypes: readonly string[]
}

function freezePolicy(policy: ResearchProfilePolicy): Readonly<ResearchProfilePolicy> {
  return Object.freeze({
    ...policy,
    questionCategories: Object.freeze([...policy.questionCategories]),
    requiredSections: Object.freeze([...policy.requiredSections]),
    preferredSourceTypes: Object.freeze([...policy.preferredSourceTypes]),
  })
}

const RESEARCH_PROFILE_POLICIES: Readonly<Record<ResearchProfile, Readonly<ResearchProfilePolicy>>> = Object.freeze({
  general: freezePolicy({
    profile: 'general',
    questionCategories: ['definition', 'history', 'current-state', 'mechanism', 'stakeholders', 'evidence', 'disagreement', 'impacts', 'risks', 'open-questions'],
    requiredSections: ['executive-summary', 'scope-and-method', 'findings-by-question', 'alternative-explanations', 'implications', 'limitations', 'references'],
    preferredSourceTypes: ['primary-source', 'official', 'peer-reviewed', 'reputable-secondary'],
  }),
  market: freezePolicy({
    profile: 'market',
    questionCategories: ['market-definition', 'segmentation', 'market-sizing', 'growth', 'demand-drivers', 'value-chain', 'customer-segments', 'regulation', 'competitive-structure', 'risks', 'opportunities'],
    requiredSections: ['executive-summary', 'scope-and-method', 'market-definition', 'market-sizing', 'growth-and-drivers', 'customer-segments', 'competitive-structure', 'risks-and-opportunities', 'limitations', 'references'],
    preferredSourceTypes: ['official-statistics', 'regulatory-filing', 'company-filing', 'industry-association', 'primary-survey', 'research-institute'],
  }),
  competitor: freezePolicy({
    profile: 'competitor',
    questionCategories: ['positioning', 'target-customers', 'product-capabilities', 'pricing', 'channels', 'partners', 'technical-approach', 'adoption-signals', 'strengths', 'weaknesses', 'strategic-risks'],
    requiredSections: ['executive-summary', 'scope-and-method', 'comparison-date', 'positioning', 'capability-comparison', 'pricing-and-packaging', 'channels-and-partners', 'strengths-and-weaknesses', 'strategic-risks', 'limitations', 'references'],
    preferredSourceTypes: ['company-primary', 'pricing-page', 'product-documentation', 'customer-evidence', 'regulatory-filing', 'reputable-secondary'],
  }),
  academic: freezePolicy({
    profile: 'academic',
    questionCategories: ['research-question', 'terminology', 'theoretical-lineage', 'foundational-work', 'recent-work', 'methods', 'datasets', 'findings', 'consensus', 'controversies', 'limitations', 'research-gaps'],
    requiredSections: ['executive-summary', 'scope-and-method', 'terminology', 'literature-review', 'methodology-review', 'findings', 'consensus-and-controversies', 'limitations-and-gaps', 'references'],
    preferredSourceTypes: ['peer-reviewed-paper', 'conference-paper', 'marked-preprint', 'institutional-repository', 'doi-metadata', 'primary-dataset'],
  }),
})

export function getResearchProfilePolicy(profile: ResearchProfile): Readonly<ResearchProfilePolicy> {
  const policy = RESEARCH_PROFILE_POLICIES[profile]

  if (policy) {
    return policy
  }

  throw new ResearchDomainError('RESEARCH_INVALID_PROFILE', 'Unknown research profile: ' + profile, false)
}
