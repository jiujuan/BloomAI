import fs from 'fs'
import os from 'os'
import path from 'path'
import { LibSQLStore } from '@mastra/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartResearchInput } from '@shared/deepresearch/contracts'
import { createDeepResearchService } from '../../deepresearch/deep-research.service'
import { createDeepResearchMastraRuntime } from './mastra'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let stores: LibSQLStore[]
let runtimes: Array<ReturnType<typeof createDeepResearchMastraRuntime>>

const input: StartResearchInput = {
  topic: 'Enterprise AI assistant market',
  profile: 'market',
  depth: 'deep',
  objective: 'Compare the market and leading vendors.',
}

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../../db/repositories/deepresearch/research-run.repo')
  const { researchQuestionRepo } = await import('../../db/repositories/deepresearch/research-question.repo')
  const { researchReportRepo } = await import('../../db/repositories/deepresearch/research-report.repo')
  const { researchEventRepo } = await import('../../db/repositories/deepresearch/research-event.repo')

  return { client, researchRunRepo, researchQuestionRepo, researchReportRepo, researchEventRepo }
}

function createStorage() {
  const storage = new LibSQLStore({
    id: 'deep-research-workflow-test-' + Math.random().toString(36).slice(2),
    url: ':memory:',
  })
  stores.push(storage)
  return storage
}

describe('Deep Research Mastra skeleton workflow', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-workflow-'))
    originalEnv = { ...process.env }
    stores = []
    runtimes = []
  })

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.mastra.shutdown()))
    await Promise.all(stores.map((storage) => storage.close()))
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('persists a fixed brief, Mastra workflow id, events, and a skeleton Markdown artifact', async () => {
    const repositories = await loadTestContext()
    const planner = {
      plan: vi.fn(async () => ({
        title: 'Enterprise AI assistant market research',
        objective: 'Compare the market and leading vendors.',
        audience: 'Product strategy team',
        scope: 'US enterprise AI assistant market in 2026',
        assumptions: ['Public sources only'],
        plannedSections: ['executive-summary', 'market-definition', 'competitive-structure'],
        criticalClarifications: [],
      })),
    }
    const runtime = createDeepResearchMastraRuntime({
      dataDir,
      storage: createStorage(),
      planner,
      repositories,
    })
    runtimes.push(runtime)
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 48,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })

    await runtime.start(run.id)

    const detail = repositories.researchRunRepo.getDetail(run.id)!
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(detail).toMatchObject({
      status: 'completed_with_limitations',
      phase: 'skeleton_complete',
      workflowRunId: expect.any(String),
      brief: {
        title: 'Enterprise AI assistant market research',
        plannedSections: ['executive-summary', 'market-definition', 'competitive-structure'],
      },
    })
    expect(detail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.brief.completed' }),
      expect.objectContaining({ type: 'research.run.completed' }),
      expect.objectContaining({ type: 'research.artifact.created' }),
    ]))
    expect(detail.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'report_markdown',
        fileName: 'research-skeleton.md',
        contentType: 'text/markdown',
      }),
    ]))
    const skeletonPath = path.join(dataDir, 'deepresearch', 'runs', run.id, 'research-skeleton.md')
    expect(fs.readFileSync(skeletonPath, 'utf8')).toContain('# Enterprise AI assistant market research')
  })

  it('suspends for a critical clarification then resumes planning without creating a second brief', async () => {
    const repositories = await loadTestContext()
    const planner = {
      plan: vi.fn(async () => ({
        title: 'Enterprise AI assistant market research',
        objective: 'Compare the market and leading vendors.',
        audience: 'Product strategy team',
        scope: 'Enterprise market',
        assumptions: [],
        plannedSections: ['executive-summary'],
        criticalClarifications: [{
          question: 'Which geography should the comparison cover?',
          intent: 'scope',
          priority: 'critical' as const,
          requiredEvidenceTypes: ['official-statistics'],
        }],
      })),
    }
    const runtime = createDeepResearchMastraRuntime({
      dataDir,
      storage: createStorage(),
      planner,
      repositories,
    })
    runtimes.push(runtime)
    const service = createDeepResearchService({ runtime })
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 48,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })

    const suspended = await runtime.start(run.id)
    const awaitingDetail = repositories.researchRunRepo.getDetail(run.id)!

    expect(suspended.status).toBe('suspended')
    expect(awaitingDetail).toMatchObject({
      status: 'awaiting_input',
      phase: 'awaiting_clarification',
      resumePhase: 'planning',
      brief: { criticalClarificationIds: [expect.any(String)] },
    })
    expect(awaitingDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.run.awaiting_input' }),
    ]))

    const clarificationId = awaitingDetail.brief!.criticalClarificationIds[0]
    await service.answerClarification(run.id, {
      clarificationId,
      answer: 'Focus on the United States market.',
    })
    await vi.waitFor(() => {
      expect(repositories.researchRunRepo.get(run.id)).toMatchObject({
        status: 'completed_with_limitations',
        phase: 'skeleton_complete',
      })
    })

    const resumedDetail = repositories.researchRunRepo.getDetail(run.id)!
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(resumedDetail.brief).toEqual(awaitingDetail.brief)
    expect(resumedDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'research.clarification.answered',
        payload: { clarificationId, answer: 'Focus on the United States market.' },
      }),
      expect.objectContaining({ type: 'research.run.completed' }),
    ]))
  })
})
