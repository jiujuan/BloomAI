import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

type TestApp = { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }

async function loadApi(): Promise<{
  app: TestApp
  researchRunRepo: typeof import('../../db/repositories/deepresearch/research-run.repo').researchRunRepo
  researchEventRepo: typeof import('../../db/repositories/deepresearch/research-event.repo').researchEventRepo
  researchReportRepo: typeof import('../../db/repositories/deepresearch/research-report.repo').researchReportRepo
}> {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { settingsRepo } = await import('../../db/repositories/settings.repo')
  settingsRepo.setMany({
    deep_research_model: 'deepseek-chat',
    deepseek_api_key: 'deepseek-test-secret',
  })
  const { createDeepResearchModule } = await import('../../deepresearch')
  const { createDeepResearchRoutes } = await import('./deep-research')
  const { researchRunRepo } = await import('../../db/repositories/deepresearch/research-run.repo')
  const { researchEventRepo } = await import('../../db/repositories/deepresearch/research-event.repo')
  const { researchReportRepo } = await import('../../db/repositories/deepresearch/research-report.repo')
  const module = createDeepResearchModule({ start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) })
  const app = new Hono()
  app.route('/api/v1/deep-research', createDeepResearchRoutes({ module }))
  return { app, researchRunRepo, researchEventRepo, researchReportRepo }
}

async function requestJson(app: TestApp, route: string, init?: RequestInit) {
  const response = await app.request(new URL('/api/v1/deep-research' + route, 'http://localhost'), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

function validInput() {
  return { topic: 'Enterprise AI assistant market', profile: 'market' as const, depth: 'deep' as const }
}

describe('Deep Research HTTP API', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deep-research-http-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('always exposes the durable Deep Research API without a feature flag', async () => {
    const { app } = await loadApi()

    const status = await requestJson(app, '/status')
    expect(status.response.status).toBe(200)
    expect(status.body).toEqual({ data: { enabled: true, version: 'v2' } })

    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    expect(created.response.status).toBe(201)
    expect(created.body.data).toMatchObject({ status: 'queued' })
  })

  it('creates, lists, reads, validates, clarifies, cancels, resumes, and serves owned artifacts', async () => {
    const { app, researchRunRepo, researchReportRepo } = await loadApi()

    const invalid = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify({ topic: 'x' }) })
    expect(invalid.response.status).toBe(400)
    expect(invalid.body.error).toMatchObject({ code: 'RESEARCH_VALIDATION_ERROR' })

    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    expect(created.response.status).toBe(201)
    expect(created.body.data).toMatchObject({ id: expect.any(String), status: 'queued', topic: validInput().topic })
    const runId = created.body.data.id as string

    const listed = await requestJson(app, '/runs?profile=market&limit=10')
    expect(listed.body.data).toEqual([expect.objectContaining({ id: runId })])

    const detail = await requestJson(app, '/runs/' + runId)
    expect(detail.body.data).toMatchObject({ id: runId })
    expect(detail.body.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.run.created' }),
      expect.objectContaining({ type: 'research.attempt.created' }),
      expect.objectContaining({ type: 'research.checkpoint.completed', payload: expect.objectContaining({ checkpointKey: 'run:queued' }) }),
    ]))

    researchRunRepo.transitionWithEvent(runId, 'planning', { phase: 'planning' })
    researchRunRepo.transitionWithEvent(runId, 'awaiting_input', { phase: 'awaiting_input' })
    const clarification = await requestJson(app, '/runs/' + runId + '/clarifications', {
      method: 'POST',
      body: JSON.stringify({ clarificationId: 'scope', answer: 'United States' }),
    })
    expect(clarification.response.status).toBe(200)
    expect(clarification.body.data).toMatchObject({ id: runId, status: 'awaiting_input' })

    const cancelled = await requestJson(app, '/runs/' + runId + '/cancel', { method: 'POST', body: '{}' })
    expect(cancelled.body.data).toMatchObject({ id: runId, status: 'cancelling' })

    const interrupted = researchRunRepo.create({ input: validInput(), budget: created.body.data.budget })
    researchRunRepo.transitionWithEvent(interrupted.id, 'interrupted', { phase: 'interrupted' })
    const resumed = await requestJson(app, '/runs/' + interrupted.id + '/resume', { method: 'POST', body: '{}' })
    expect(resumed.body.data).toMatchObject({ id: interrupted.id, status: 'queued' })

    const artifactPath = path.join(dataDir, 'artifact.md')
    fs.writeFileSync(artifactPath, '# verified report', 'utf8')
    const artifact = researchReportRepo.upsertArtifact({
      runId,
      type: 'report_markdown',
      fileName: 'report.md',
      contentType: 'text/markdown',
      storagePath: artifactPath,
      sizeBytes: 17,
      contentHash: 'test',
      metadata: {},
      idempotencyKey: 'test-artifact',
    })
    const served = await app.request(new URL('/api/v1/deep-research/runs/' + runId + '/artifacts/' + artifact.id, 'http://localhost'))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toContain('text/markdown')
    expect(served.headers.get('content-disposition')).toContain('report.md')
    expect(await served.text()).toBe('# verified report')

    const crossRunArtifact = await app.request(new URL('/api/v1/deep-research/runs/' + interrupted.id + '/artifacts/' + artifact.id, 'http://localhost'))
    expect(crossRunArtifact.status).toBe(404)
  })

  it('projects lifecycle history through safe paginated V2 DTOs without exposing fetched bodies or internals', async () => {
    const { app, researchEventRepo } = await loadApi()
    const { researchAttemptRepo } = await import('../../db/repositories/deepresearch/research-attempt.repo')
    const { researchIterationRepo } = await import('../../db/repositories/deepresearch/research-iteration.repo')
    const { researchSourceRepo } = await import('../../db/repositories/deepresearch/research-source.repo')
    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    const runId = created.body.data.id as string

    const secondAttempt = researchAttemptRepo.create({ runId, trigger: 'retry', status: 'queued', workflowRunId: 'workflow-private' })
    researchIterationRepo.create({ runId, targetQuestionIds: ['question-1'], limitations: ['Only one independent source was available.'] })
    researchIterationRepo.create({
      runId,
      status: 'stopped',
      targetQuestionIds: ['question-1'],
      limitations: ['Budget limit reached.'],
      stopReason: {
        decision: 'stop_budget',
        reason: 'budget exhausted',
        limitationCodes: ['BUDGET'],
        limitations: ['Budget limit reached.'],
        matchedRule: 'budget_exhausted',
        inputSummary: {
          assessmentFingerprints: [], previousAssessmentFingerprint: null, historyIterationCount: 2,
          consecutiveNoMaterialGain: 0, actionableGapCount: 0, actionableQueryCount: 0, cancellationRequested: false,
          usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
          activeReservation: { iterations: 0, searchQueries: 0, fetchedSources: 0, modelTokens: 0, providerCostUsd: 0 },
        },
      },
    })
    const source = researchSourceRepo.createSource({
      runId,
      canonicalUrl: 'https://example.test/article?access_token=private',
      domain: 'example.test',
      sourceType: 'official',
      selectionStatus: 'selected',
      scores: { authorization: 'private', relevance: 1 },
    })
    researchSourceRepo.createSnapshot({
      runId,
      sourceId: source.id,
      contentHash: 'content-hash',
      content: 'Fetched source body must never be exposed by the lifecycle detail API.',
      metadata: { storagePath: 'C:\private\snapshot.html', parser: 'test' },
      fetchedAt: 1,
      parserVersion: 'test',
      finalUrl: 'https://example.test/article?session=private',
      idempotencyKey: 'snapshot-1',
    })
    researchEventRepo.append({
      runId,
      type: 'research.recovery.reconciled',
      phase: 'reconciliation',
      payload: { storagePath: 'C:\private\artifact.json', content: 'private body', checkpointKey: 'safe' },
    })

    const detail = await requestJson(app, '/runs/' + runId)
    expect(detail.body.data.lifecycle).toMatchObject({
      currentAttempt: { id: secondAttempt.id, ordinal: 2 },
      resumeCheckpoint: expect.objectContaining({ checkpointKey: 'run:queued' }),
      budget: { limit: created.body.data.budget, usage: expect.any(Object) },
      stopReason: expect.objectContaining({ decision: 'stop_budget' }),
      limitations: expect.arrayContaining(['Budget limit reached.']),
      capabilities: expect.objectContaining({ canCancel: true }),
    })
    expect(detail.body.data.lifecycle.currentAttempt).not.toHaveProperty('executorId')
    expect(detail.body.data.lifecycle.currentAttempt).not.toHaveProperty('leaseExpiresAt')
    expect(detail.body.data.snapshots[0]).toMatchObject({ content: '[redacted]', finalUrl: 'https://example.test/article' })
    expect(detail.body.data.snapshots[0].metadata).not.toHaveProperty('storagePath')
    expect(detail.body.data.sources[0].canonicalUrl).toBe('https://example.test/article')

    const redactedEvent = detail.body.data.events.find((event: any) => event.type === 'research.recovery.reconciled')
    expect(redactedEvent).toMatchObject({ eventId: expect.any(String), payload: { checkpointKey: 'safe' } })
    expect(redactedEvent.payload).not.toHaveProperty('content')
    expect(redactedEvent.payload).not.toHaveProperty('storagePath')

    const attempts = await requestJson(app, '/runs/' + runId + '/attempts?limit=1')
    expect(attempts.body.data).toMatchObject({ items: [expect.objectContaining({ id: secondAttempt.id })], nextCursor: '2' })
    expect(attempts.body.data.items[0]).not.toHaveProperty('workflowRunId')
    const secondPage = await requestJson(app, '/runs/' + runId + '/attempts?limit=1&cursor=' + attempts.body.data.nextCursor)
    expect(secondPage.body.data).toMatchObject({ items: [expect.objectContaining({ ordinal: 1 })], nextCursor: null })

    const checkpoints = await requestJson(app, '/runs/' + runId + '/checkpoints')
    expect(checkpoints.body.data.items[0]).not.toHaveProperty('inputFingerprint')
    const iterations = await requestJson(app, '/runs/' + runId + '/iterations?limit=1')
    expect(iterations.body.data).toMatchObject({ items: [expect.objectContaining({ ordinal: 2 })], nextCursor: '2' })
    const assessments = await requestJson(app, '/runs/' + runId + '/assessments')
    expect(assessments.body.data).toEqual({ items: [], nextCursor: null })
  })

  it('maps cancelled resume to a conflict and redacts replayed SSE event payloads with stable event IDs', async () => {
    const { app, researchRunRepo, researchEventRepo } = await loadApi()
    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    const runId = created.body.data.id as string
    researchRunRepo.transitionWithEvent(runId, 'cancelling', { phase: 'cancelling' })
    researchRunRepo.transitionWithEvent(runId, 'cancelled', { phase: 'cancelled' })

    const resume = await requestJson(app, '/runs/' + runId + '/resume', { method: 'POST', body: '{}' })
    expect(resume.response.status).toBe(409)
    expect(resume.body.error).toMatchObject({ code: 'RESEARCH_CANCELLED' })

    researchEventRepo.append({ runId, type: 'research.recovery.reconciled', phase: 'reconciliation', payload: { ownershipToken: 'private', checkpointKey: 'replayed' } })
    const replay = await requestJson(app, '/runs/' + runId + '/events')
    const event = replay.body.data.at(-1)
    expect(event).toMatchObject({ eventId: expect.any(String), payload: { checkpointKey: 'replayed' } })
    expect(event.payload).not.toHaveProperty('ownershipToken')
  })

  it('returns persisted event pages and honors Last-Event-ID when streaming', async () => {
    const { app, researchRunRepo, researchEventRepo } = await loadApi()
    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    const runId = created.body.data.id as string
    const planned = researchEventRepo.append({ runId, type: 'research.questions.planned', phase: 'planning', payload: { count: 2 } })

    const page = await requestJson(app, '/runs/' + runId + '/events?after=' + (planned.sequence - 1))
    expect(page.body.data).toEqual([expect.objectContaining({ runId, eventId: expect.any(String), sequence: planned.sequence, type: 'research.questions.planned' })])

    const controller = new AbortController()
    const streamed = await app.request(new Request(new URL('/api/v1/deep-research/runs/' + runId + '/stream', 'http://localhost'), {
      headers: { 'Last-Event-ID': String(planned.sequence - 1) },
      signal: controller.signal,
    }))
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-type')).toContain('text/event-stream')
    const reader = streamed.body!.getReader()
    const first = await reader.read()
    const payload = new TextDecoder().decode(first.value)
    expect(payload).toContain('id: ' + planned.sequence)
    expect(payload).toContain('research.questions.planned')

    const coverage = researchEventRepo.append({ runId, type: 'research.coverage.assessed', phase: 'researching', payload: { coverage: 0.5 } })
    const next = await reader.read()
    const nextPayload = new TextDecoder().decode(next.value)
    expect(nextPayload).toContain('id: ' + coverage.sequence)
    expect(nextPayload).toContain('research.coverage.assessed')
    expect(nextPayload).toContain('"eventId"')

    controller.abort()
    await reader.cancel()
  })
})
