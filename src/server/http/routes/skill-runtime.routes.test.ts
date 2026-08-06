import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const app = createHonoApp()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  return { app, client, skillPackageRepo }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

describe('Package Runtime v1 resource contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-contract-data-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('exposes bounded installation pagination with hasMore and nextOffset', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Contract package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: path.join(dataDir, 'package'), securityStatus: 'verified' })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })

    const result = await requestJson(app, '/skill-installations?limit=1&offset=0')
    expect(result.response.status).toBe(200)
    expect(result.body.meta).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null })
    expect(result.body.data).toHaveLength(1)
  })

  it('serves an SSE-compatible finite event stream that honors afterSeq', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Stream package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: path.join(dataDir, 'package'), securityStatus: 'verified' })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const created = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId: version.id, input: {}, surface: 'skills' }) })
    const stream = await app.request(new URL(`/api/v1/skill-runs/${created.body.data.runId}/stream?afterSeq=0`, 'http://localhost'))
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const text = await stream.text()
    expect(text).toContain('event:')
    expect(text).toContain('id:')
  })
})
