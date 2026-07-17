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
    expect(detail.body.data).toMatchObject({ id: runId, events: [expect.objectContaining({ type: 'research.run.created' })] })

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

  it('returns persisted event pages and honors Last-Event-ID when streaming', async () => {
    const { app, researchRunRepo, researchEventRepo } = await loadApi()
    const created = await requestJson(app, '/runs', { method: 'POST', body: JSON.stringify(validInput()) })
    const runId = created.body.data.id as string
    researchEventRepo.append({ runId, type: 'research.questions.planned', phase: 'planning', payload: { count: 2 } })

    const page = await requestJson(app, '/runs/' + runId + '/events?after=1')
    expect(page.body.data).toEqual([expect.objectContaining({ runId, sequence: 2, type: 'research.questions.planned' })])

    const controller = new AbortController()
    const streamed = await app.request(new Request(new URL('/api/v1/deep-research/runs/' + runId + '/stream', 'http://localhost'), {
      headers: { 'Last-Event-ID': '1' },
      signal: controller.signal,
    }))
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-type')).toContain('text/event-stream')
    const reader = streamed.body!.getReader()
    const first = await reader.read()
    const payload = new TextDecoder().decode(first.value)
    expect(payload).toContain('id: 2')
    expect(payload).toContain('research.questions.planned')

    researchEventRepo.append({ runId, type: 'research.coverage.assessed', phase: 'researching', payload: { coverage: 0.5 } })
    const next = await reader.read()
    const nextPayload = new TextDecoder().decode(next.value)
    expect(nextPayload).toContain('id: 3')
    expect(nextPayload).toContain('research.coverage.assessed')

    controller.abort()
    await reader.cancel()
  })
})
