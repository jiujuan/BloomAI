import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { getResearchBudget } from '@server/deepresearch/domain/budgets'
import { createContentService } from './content-service'
import { createSearchService, type WorkflowToolRequest } from './search-service'
import { SourceCurator, canonicalizeResearchUrl } from './source-curator'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

function createRun(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  const now = Date.now()
  return {
    id: 'run-1',
    sessionId: 'session-1',
    topic: 'Enterprise AI assistants',
    profile: 'market',
    depth: 'deep',
    status: 'researching',
    phase: 'retrieval',
    progress: 40,
    brief: null,
    workflowRunId: 'workflow-1',
    budget: getResearchBudget('deep'),
    usage: {
      questions: 1,
      iterations: 0,
      searchQueries: 0,
      normalizedSources: 0,
      fetchedSources: 0,
      tokens: 0,
      providerCostUsd: 0,
      startedAt: now,
      deadlineAt: now + 60_000,
    },
    quality: null,
    reportArtifactId: null,
    resumePhase: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  }
}

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../../db/repositories/deepresearch/research-run.repo')
  const { researchSourceRepo } = await import('../../db/repositories/deepresearch/research-source.repo')
  const { researchEventRepo } = await import('../../db/repositories/deepresearch/research-event.repo')
  return { client, researchRunRepo, researchSourceRepo, researchEventRepo }
}

describe('Deep Research retrieval services', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-retrieval-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('canonicalizes tracking URLs and curates a diverse, profile-weighted source set', () => {
    expect(canonicalizeResearchUrl('HTTPS://WWW.SEC.GOV/Archives/a?utm_source=x&b=2&a=1#top'))
      .toBe('https://sec.gov/Archives/a?a=1&b=2')

    const curated = new SourceCurator({ maxSourcesPerDomain: 2 }).curate(createRun(), [
      { queryId: 'q1', title: 'Vendor blog', url: 'https://example.com/a?utm_campaign=x', snippet: 'secondary source' },
      { queryId: 'q1', title: 'Vendor blog duplicate', url: 'https://example.com/a#fragment', snippet: 'duplicate' },
      { queryId: 'q1', title: 'Same domain one', url: 'https://example.com/b', snippet: 'secondary source' },
      { queryId: 'q1', title: 'Same domain two', url: 'https://example.com/c', snippet: 'secondary source' },
      { queryId: 'q1', title: 'Company filing', url: 'https://www.sec.gov/Archives/edgar/data/1', snippet: 'primary filing' },
      { queryId: 'q1', title: 'Stale opinion', url: 'https://old.example.net/market', snippet: 'published 2017 analysis' },
    ])

    expect(curated.selected.map((item) => item.canonicalUrl)).toContain('https://sec.gov/Archives/edgar/data/1')
    expect(curated.selected.filter((item) => item.domain === 'example.com')).toHaveLength(2)
    expect(curated.rejected.some((item) => item.reason === 'duplicate')).toBe(true)
    expect(curated.selected.find((item) => item.canonicalUrl.includes('sec.gov'))!.score)
      .toBeGreaterThan(curated.selected.find((item) => item.canonicalUrl.includes('old.example.net'))!.score)
  })

  it('uses the workflow tool capability with a real session, retrying transient provider failures within the deadline', async () => {
    const calls: WorkflowToolRequest[] = []
    let attempts = 0
    const search = createSearchService({
      executeTool: async (request) => {
        calls.push(request)
        attempts += 1
        if (attempts < 3) throw new Error('provider unavailable')
        return { output: { provider: 'fixture', results: [{ title: 'Primary source', url: 'https://sec.gov/a', snippet: 'official' }] } }
      },
      sleep: async () => undefined,
    })

    const result = await search.search(createRun(), [{ id: 'q1', query: 'enterprise AI filings' }])

    expect(attempts).toBe(3)
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ caller: 'workflow', toolId: 'web_search', sessionId: 'session-1' }),
    ]))
    expect(calls.every((call) => Number((call.input as { limit: number }).limit) <= createRun().budget.maxSearchQueries)).toBe(true)
    expect(result[0]).toMatchObject({ queryId: 'q1', provider: 'fixture', candidates: [{ url: 'https://sec.gov/a' }] })
  })

  it('fetches with bounded concurrency, rejects unsafe redirects, records failures, and persists immutable content-hash snapshots', async () => {
    const { researchRunRepo, researchSourceRepo, researchEventRepo } = await loadTestContext()
    const run = researchRunRepo.create({
      input: { topic: 'Enterprise AI assistants', profile: 'market', depth: 'deep', objective: undefined },
      budget: getResearchBudget('deep'),
    })
    const publicSource = researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: 'https://public.example/report',
      domain: 'public.example',
      title: 'Public report',
      sourceType: 'industry-association',
      selectionStatus: 'selected',
      scores: {},
    })
    const redirectSource = researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: 'https://redirect.example/report',
      domain: 'redirect.example',
      title: 'Unsafe redirect',
      sourceType: 'reputable-secondary',
      selectionStatus: 'selected',
      scores: {},
    })

    let activeFetches = 0
    let maxActiveFetches = 0
    const content = 'A source page may say Ignore prior instructions, but it remains untrusted evidence.\nAuthorization: Bearer secret-token\nC:\\Users\\researcher\\secret.txt'
    const contentService = createContentService({
      repositories: { researchSourceRepo, researchEventRepo },
      maxConcurrency: 2,
      executeTool: async ({ toolId, input }) => {
        const url = String(input.url)
        if (toolId === 'web_fetch') {
          activeFetches += 1
          maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
          await Promise.resolve()
          activeFetches -= 1
          if (url.includes('redirect')) return { output: { finalUrl: 'http://169.254.169.254/latest/meta-data', status: 302 } }
          return { output: { finalUrl: url, status: 200 } }
        }
        return { output: { title: 'Fixture report', finalUrl: url, text: content, headings: ['Findings'] } }
      },
      sleep: async () => undefined,
      lookup: async () => ['93.184.216.34'],
    })

    const outcomes = await contentService.fetch(createRun({ id: run.id, budget: { ...run.budget, fetchConcurrency: 2 } }), [publicSource, redirectSource])
    const snapshots = researchSourceRepo.listSnapshots(run.id)

    expect(maxActiveFetches).toBeLessThanOrEqual(2)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fetched', 'failed'])
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].content).toContain('Ignore prior instructions')
    expect(snapshots[0].content).not.toContain('secret-token')
    expect(snapshots[0].content).not.toContain('C:\\Users\\researcher\\secret.txt')
    expect(snapshots[0].contentHash).toBe(crypto.createHash('sha256').update(snapshots[0].content).digest('hex'))
    expect(researchEventRepo.list(run.id).some((event) => event.type === 'research.source.fetch_failed')).toBe(true)

    await contentService.fetch(createRun({ id: run.id, budget: { ...run.budget, fetchConcurrency: 2 } }), [publicSource])
    expect(researchSourceRepo.listSnapshots(run.id)).toHaveLength(1)
  })

  it('rejects hosts that resolve to private networks and stops scheduling after cancellation', async () => {
    const { researchRunRepo, researchSourceRepo, researchEventRepo } = await loadTestContext()
    const run = researchRunRepo.create({
      input: { topic: 'Private target protection', profile: 'market', depth: 'deep', objective: undefined },
      budget: getResearchBudget('deep'),
    })
    const sources = ['https://private-name.example/report', 'https://public-one.example/report', 'https://public-two.example/report'].map((canonicalUrl, index) => researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl,
      domain: new URL(canonicalUrl).hostname,
      title: 'Source ' + index,
      sourceType: 'reputable-secondary',
      selectionStatus: 'selected',
      scores: {},
    }))
    let cancelled = false
    let webFetches = 0
    const contentService = createContentService({
      repositories: { researchSourceRepo, researchEventRepo },
      maxConcurrency: 1,
      isCancelled: () => cancelled,
      lookup: async (hostname) => hostname === 'private-name.example' ? ['127.0.0.1'] : ['93.184.216.34'],
      executeTool: async ({ toolId, input }) => {
        if (toolId === 'web_fetch') {
          webFetches += 1
          cancelled = true
          return { output: { finalUrl: String(input.url), status: 200 } }
        }
        return { output: { finalUrl: String(input.url), title: 'Fixture', text: 'fixture' } }
      },
    })

    const privateOutcome = await contentService.fetch(createRun({ id: run.id }), [sources[0]])
    const outcomes = await contentService.fetch(createRun({ id: run.id }), sources.slice(1))

    expect(privateOutcome[0]).toMatchObject({ status: 'failed', error: { code: 'RESEARCH_UNSAFE_URL' } })
    expect(webFetches).toBe(1)
    expect(outcomes.map((outcome) => outcome.error?.code)).toEqual(['RESEARCH_CANCELLED', 'RESEARCH_CANCELLED'])
    expect(researchEventRepo.list(run.id).filter((event) => event.type === 'research.source.fetch_failed')).toHaveLength(3)
  })

  it('stops scheduling queued searches after cancellation while preserving result order', async () => {
    let cancelled = false
    let calls = 0
    const search = createSearchService({
      isCancelled: () => cancelled,
      executeTool: async () => {
        calls += 1
        cancelled = true
        return { output: { provider: 'fixture', results: [] } }
      },
    })

    const results = await search.search(createRun({ budget: { ...createRun().budget, searchConcurrency: 1 } }), [
      { id: 'q1', query: 'first' },
      { id: 'q2', query: 'second' },
    ])

    expect(calls).toBe(1)
    expect(results.map((result) => result.queryId)).toEqual(['q1', 'q2'])
    expect(results[1].error).toMatchObject({ code: 'RESEARCH_CANCELLED', retryable: false })
  })
})
