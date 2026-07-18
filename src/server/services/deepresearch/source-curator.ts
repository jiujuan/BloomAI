import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { canonicalizeResearchUrl } from '@server/deepresearch/domain/idempotency'

export interface DiscoveredResearchSource {
  queryId: string
  title: string
  url: string
  snippet: string
}

export interface CuratedResearchSource extends DiscoveredResearchSource {
  canonicalUrl: string
  domain: string
  sourceType: string
  score: number
}

export interface RejectedResearchSource extends DiscoveredResearchSource {
  reason: 'duplicate' | 'invalid_url' | 'domain_cap' | 'budget_cap'
}

export interface SourceCurationResult {
  selected: CuratedResearchSource[]
  rejected: RejectedResearchSource[]
}

export { canonicalizeResearchUrl } from '@server/deepresearch/domain/idempotency'

function inferSourceType(url: URL): string {
  const host = url.hostname.replace(/^www\./, '')
  const path = url.pathname.toLowerCase()
  if (host === 'sec.gov' || host.endsWith('.sec.gov')) return 'regulatory-filing'
  if (host.endsWith('.gov')) return 'official-statistics'
  if (host === 'arxiv.org') return 'marked-preprint'
  if (host.includes('doi.org')) return 'doi-metadata'
  if (/pricing|plans/.test(path)) return 'pricing-page'
  if (/docs|documentation/.test(path)) return 'product-documentation'
  return 'reputable-secondary'
}

function scoreSource(run: ResearchRunDto, sourceType: string, candidate: DiscoveredResearchSource): number {
  const policy = getResearchProfilePolicy(run.profile)
  let score = policy.preferredSourceTypes.includes(sourceType) ? 100 : 45
  if (/\b(official|filing|annual report|dataset|methodology)\b/i.test(candidate.title + ' ' + candidate.snippet)) score += 12
  if (/\b(201[0-8]|200\d)\b/.test(candidate.title + ' ' + candidate.snippet)) score -= 25
  return score
}

export class SourceCurator {
  private readonly maxSourcesPerDomain: number

  constructor(options: { maxSourcesPerDomain?: number } = {}) {
    this.maxSourcesPerDomain = options.maxSourcesPerDomain ?? 2
  }

  curate(run: ResearchRunDto, candidates: DiscoveredResearchSource[], options: { maxSources?: number } = {}): SourceCurationResult {
    const rejected: RejectedResearchSource[] = []
    const byCanonicalUrl = new Set<string>()
    const normalized: Array<CuratedResearchSource & { ordinal: number }> = []

    candidates.forEach((candidate, ordinal) => {
      let canonicalUrl: string
      try {
        canonicalUrl = canonicalizeResearchUrl(candidate.url)
      } catch {
        rejected.push({ ...candidate, reason: 'invalid_url' })
        return
      }
      if (byCanonicalUrl.has(canonicalUrl)) {
        rejected.push({ ...candidate, reason: 'duplicate' })
        return
      }
      byCanonicalUrl.add(canonicalUrl)
      const url = new URL(canonicalUrl)
      const sourceType = inferSourceType(url)
      normalized.push({
        ...candidate,
        canonicalUrl,
        domain: url.hostname,
        sourceType,
        score: scoreSource(run, sourceType, candidate),
        ordinal,
      })
    })

    const remainingNormalizedSources = Math.max(0, run.budget.maxNormalizedSources - run.usage.normalizedSources)
    // An iteration reservation is the upper bound for work that may later be
    // settled. Keep curation inside that bound so every selected source can be
    // fetched and charged without exceeding the reservation.
    const reservationCap = options.maxSources === undefined ? remainingNormalizedSources : Math.max(0, Math.floor(options.maxSources))
    const sourceBudget = Math.min(remainingNormalizedSources, reservationCap)
    const selected: CuratedResearchSource[] = []
    const domainCounts = new Map<string, number>()
    for (const candidate of normalized.sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)) {
      if (selected.length >= sourceBudget) {
        rejected.push({ ...candidate, reason: 'budget_cap' })
        continue
      }
      const count = domainCounts.get(candidate.domain) ?? 0
      if (count >= this.maxSourcesPerDomain) {
        rejected.push({ ...candidate, reason: 'domain_cap' })
        continue
      }
      domainCounts.set(candidate.domain, count + 1)
      const { ordinal: _ordinal, ...selectedCandidate } = candidate
      selected.push(selectedCandidate)
    }

    return { selected, rejected }
  }
}
