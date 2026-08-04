import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function createApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { Hono } = await import('hono')
  const { createHttpErrorHandler } = await import('../error-mapper')
  const { toolsRoutes } = await import('./tools')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/tools', toolsRoutes)
  return { app, client }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(route, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

describe('tools route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tools-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists tools with their permission projection and keeps category filtering', async () => {
    const { app } = await createApp()
    const result = await requestJson(app, '/tools?category=fs')

    expect(result.response.status).toBe(200)
    expect(result.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fs_write', category: 'fs', permission: null }),
    ]))
    const webResult = await requestJson(app, '/tools?category=web')
    const screenshot = webResult.body.data.find((tool: any) => tool.id === 'web_screenshot')
    expect(screenshot).toEqual(expect.objectContaining({
      availability: expect.objectContaining({
        status: 'disabled',
      }),
    }))
  })

  it('grants then revokes a tool permission through the stable response shapes', async () => {
    const { app } = await createApp()
    const granted = await requestJson(app, '/tools/permissions/fs_write/grant', {
      method: 'POST', body: JSON.stringify({ scope: 'permanent' }),
    })
    expect(granted.response.status).toBe(200)
    expect(granted.body.data).toEqual({ tool_id: 'fs_write', granted: true, scope: 'permanent' })

    const revoked = await requestJson(app, '/tools/permissions/fs_write/revoke', { method: 'POST', body: '{}' })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body.data).toEqual({ tool_id: 'fs_write', granted: false })

    const permissions = await requestJson(app, '/tools/permissions')
    expect(permissions.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool_id: 'fs_write', granted: 0, scope: 'permanent' }),
    ]))
  })

  it('rejects legacy scope values instead of persisting them', async () => {
    const { app } = await createApp()
    const result = await requestJson(app, '/tools/permissions/fs_write/grant', {
      method: 'POST', body: JSON.stringify({ scope: 'session' }),
    })

    expect(result.response.status).toBe(400)
    expect(result.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('does not accept approvalGranted in an HTTP run request', async () => {
    const { app } = await createApp()
    const result = await requestJson(app, '/tools/fs_write/run', {
      method: 'POST',
      body: JSON.stringify({
        input: { path: 'ignored.txt', content: 'should not run' },
        approvalGranted: true,
      }),
    })

    expect(result.response.status).toBe(400)
    expect(result.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects invalid contract values before invoking web executors', async () => {
    const { app } = await createApp()
    const invalidFetch = await requestJson(app, '/tools/web_fetch/run', {
      method: 'POST',
      body: JSON.stringify({
        input: { url: 'https://example.com', maxChars: 0 },
      }),
    })
    const invalidSearch = await requestJson(app, '/tools/web_search/run', {
      method: 'POST',
      body: JSON.stringify({
        input: { query: 'contract', limit: 51 },
      }),
    })

    expect(invalidFetch.response.status).toBe(400)
    expect(invalidFetch.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('maxChars'),
    }))
    expect(invalidSearch.response.status).toBe(400)
    expect(invalidSearch.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('limit'),
    }))
  })

  it('keeps missing and denied execution errors in the shared HTTP error envelope', async () => {
    const { app } = await createApp()
    const missing = await requestJson(app, '/tools/missing')
    expect(missing.response.status).toBe(404)
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'Tool not found' })

    const denied = await requestJson(app, '/tools/fs_write/run', {
      method: 'POST', body: JSON.stringify({ input: { path: 'ignored.txt', content: 'no write' } }),
    })
    expect(denied.response.status).toBe(403)
    expect(denied.body.error.code).toBe('CAPABILITY_APPROVAL_REQUIRED')
  })

  it('keeps run history pagination endpoints available without invoking an external provider', async () => {
    const { app } = await createApp()
    const byTool = await requestJson(app, '/tools/fs_write/runs?limit=1')
    const all = await requestJson(app, '/tools/runs?limit=1')

    expect(byTool.response.status).toBe(200)
    expect(byTool.body.data).toEqual([])
    expect(all.response.status).toBe(200)
    expect(all.body.data).toEqual([])
  })

  it('serves a screenshot artifact only through the recorded tool run metadata', async () => {
    const { app } = await createApp()
    const { toolRepo } = await import('../../db/repositories/tool.repo')
    const { writeScreenshotArtifact } = await import('../../tools/web/screenshot-artifacts')
    const run = toolRepo.startRun('web_screenshot', null, { url: 'https://example.com' })
    const artifact = await writeScreenshotArtifact({
      dataDir,
      runId: run.id,
      bytes: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      maxBytes: 100,
    })
    toolRepo.completeRun(run.id, artifact)

    const response = await app.request(`/tools/web_screenshot/runs/${run.id}/artifact`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('png-bytes'))
  })

  it('rejects missing, cross-tool, and mismatched screenshot artifact runs', async () => {
    const { app } = await createApp()
    const { toolRepo } = await import('../../db/repositories/tool.repo')
    const { writeScreenshotArtifact } = await import('../../tools/web/screenshot-artifacts')
    const run = toolRepo.startRun('web_screenshot', null, { url: 'https://example.com' })
    const artifact = await writeScreenshotArtifact({
      dataDir,
      runId: run.id,
      bytes: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      maxBytes: 100,
    })
    toolRepo.completeRun(run.id, artifact)

    const missing = await requestJson(app, '/tools/web_screenshot/runs/missing/artifact')
    const wrongTool = await requestJson(app, `/tools/web_fetch/runs/${run.id}/artifact`)
    const mismatched = await requestJson(app, `/tools/web_screenshot/runs/${run.id}/artifact?path=tool-artifacts%2Fweb-screenshot%2Fother%2Fscreenshot.png`)

    expect(missing.response.status).toBe(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')
    expect(wrongTool.response.status).toBe(400)
    expect(wrongTool.body.error.code).toBe('ARTIFACT_ERROR')
    expect(mismatched.response.status).toBe(400)
    expect(mismatched.body.error.code).toBe('ARTIFACT_ERROR')
  })

  it('binds the HTTP request signal to tool execution', async () => {
    const { app } = await createApp()
    const { toolService } = await import('../../services/tool.service')
    const run = vi.spyOn(toolService, 'run').mockResolvedValue({ output: { ok: true }, toolRunId: 'run-1' })

    const result = await requestJson(app, '/tools/web_search/run', {
      method: 'POST',
      body: JSON.stringify({ input: { query: 'signal' } }),
    })

    expect(result.response.status).toBe(200)
    expect(run).toHaveBeenCalledWith('web_search', { input: { query: 'signal' } }, expect.any(AbortSignal))
  })
})
