import fs from 'node:fs'
import path from 'node:path'
import { LibSQLStore } from '@mastra/libsql'
import { afterEach, describe, expect, it, vi } from 'vitest'

const enabled = process.env.DEEP_RESEARCH_REAL_MODEL_E2E === '1'
const configuredDataDir = process.env.DEEP_RESEARCH_REAL_MODEL_E2E_DATA_DIR
const tokenCap = Number(process.env.DEEP_RESEARCH_REAL_MODEL_E2E_MAX_TOKENS)

function readGoldenFixture() {
  const fixturePath = path.join(process.cwd(), 'src', 'server', 'deepresearch', 'test-fixtures', 'sales-lead-agent-quality.json')
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    topic: string
    queryContext: { queryId: string }
    candidates: Array<{ id: string; url: string; title: string; snippet: string }>
    documents: Array<{ candidateId: string; title: string; text: string; expectedRejection: string | null }>
  }
}

/**
 * Intentionally opt-in: this exercises an administrator-configured backend text
 * model with deterministic search/fetch fixtures, so it never spends provider
 * credits in normal unit or CI runs. See test-fixtures/README.md for setup.
 */
describe.skipIf(!enabled)('Deep Research real configured-model E2E', () => {
  let storage: LibSQLStore | undefined
  let runtime: any
  let priorDataDir: string | undefined

  afterEach(async () => {
    await runtime?.mastra.shutdown()
    await storage?.close()
    vi.resetModules()
    if (priorDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = priorDataDir
  })

  it('records a visible model snapshot and non-zero token usage for the sales-lead-agent golden corpus', async () => {
    expect(configuredDataDir, 'Set DEEP_RESEARCH_REAL_MODEL_E2E_DATA_DIR to a dedicated, administrator-configured DATA_DIR.').toBeTruthy()
    expect(Number.isFinite(tokenCap) && tokenCap > 0, 'Set DEEP_RESEARCH_REAL_MODEL_E2E_MAX_TOKENS to the approved cost ceiling.').toBe(true)

    priorDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = path.resolve(configuredDataDir!)
    vi.resetModules()

    const fixture = readGoldenFixture()
    const client = await import('../db/client')
    await client.runMigrations()
    const { defaultDeepResearchRepositories: repositories } = await import('../mastra/deepresearch/workflow-context')
    const { resolveResearchRuntimeModel } = await import('./domain/model-selection')
    const { getResearchBudget } = await import('./domain/budgets')
    const { createDeepResearchMastraRuntime } = await import('../mastra/deepresearch/mastra')
    const { createSearchService } = await import('../services/deepresearch/search-service')
    const { createContentService } = await import('../services/deepresearch/content-service')
    const { SourceCurator } = await import('../services/deepresearch/source-curator')

    const documents = new Map(fixture.documents.map((document) => [document.candidateId, document]))
    const candidates = fixture.candidates.filter((candidate) => !['generic-news', 'duplicate-product'].includes(candidate.id))
    const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]))
    const executeTool = async ({ toolId, input }: { toolId: string; input: Record<string, unknown> }) => {
      if (toolId === 'web_search') return { output: { provider: 'golden-e2e-fixture', results: candidates } }
      const candidate = byUrl.get(String(input.url))
      const document = candidate ? documents.get(candidate.id) : undefined
      if (!candidate || !document) throw new Error('Unexpected golden fixture URL: ' + String(input.url))
      if (toolId === 'web_fetch') return { output: { finalUrl: candidate.url, status: 200, content: document.text } }
      if (toolId === 'web_extract') return { output: { finalUrl: candidate.url, title: document.title, text: document.text, headings: ['Fixture evidence'] } }
      throw new Error('Unexpected golden fixture tool: ' + toolId)
    }

    storage = new LibSQLStore({ id: 'deep-research-real-model-e2e-' + Date.now(), url: ':memory:' })
    runtime = createDeepResearchMastraRuntime({
      dataDir: process.env.DATA_DIR,
      storage,
      repositories,
      searchService: createSearchService({ executeTool, sleep: async () => {} }),
      contentService: createContentService({
        repositories: { researchSourceRepo: repositories.researchSourceRepo, researchEventRepo: repositories.researchEventRepo },
        executeTool,
        sleep: async () => {},
        lookup: async () => ['93.184.216.34'],
      }),
      sourceCurator: new SourceCurator(),
    })

    const runtimeModel = await resolveResearchRuntimeModel()
    const run = repositories.researchRunRepo.create({
      input: { topic: fixture.topic, profile: 'market', depth: 'standard', objective: 'Manual acceptance of a configured text model with a fixed sales-lead-agent corpus.' },
      budget: { ...getResearchBudget('standard'), maxTokens: tokenCap },
      modelSelectionSnapshot: runtimeModel.snapshot,
    })
    const attempt = repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'initial' })

    await runtime.start({ runId: run.id, attemptId: attempt.id, ownershipToken: 'real-model-e2e', signal: new AbortController().signal, resumeCursor: null })

    const detail = repositories.researchRunRepo.getDetail(run.id)!
    const usage = repositories.researchAttemptRepo.get(attempt.id)!.modelUsage
    console.info('[deep-research-real-model-e2e] Run ID:', run.id)
    expect(detail.modelSelectionSnapshot).toMatchObject({ selectedModelId: expect.any(String), providerId: expect.any(String) })
    expect(usage.tokens).toBeGreaterThan(0)
    expect(usage.tokens).toBeLessThanOrEqual(tokenCap)
    expect(detail.report?.sections.length ?? 0).toBeGreaterThan(0)
    expect(detail.report?.citations.length ?? 0).toBeGreaterThan(0)
    expect(detail.snapshots.every((snapshot) => /^https?:\/\//.test(snapshot.finalUrl))).toBe(true)
  }, 10 * 60_000)
})
