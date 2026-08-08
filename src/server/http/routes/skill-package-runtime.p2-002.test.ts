import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let exportDir: string
let artifactDir: string
let originalEnv: NodeJS.ProcessEnv

type App = { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'true'
  process.env.SKILL_PACKAGE_EXECUTION_ENABLED = 'true'
  process.env.SKILL_ARTIFACT_ROOT = artifactDir
  process.env.SKILL_EXPORT_ROOT = exportDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { ArtifactStore } = await import('../../skills/artifacts')
  return { app: createHonoApp(), client, skillPackageRepo, ArtifactStore }
}

async function requestJson(app: App, route: string, init: RequestInit = {}) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-bloom-role': 'admin', ...(init.headers ?? {}) },
  })
  return { response, body: await response.json() as any }
}

function createRunnableFixture(repo: any, manifest: Record<string, unknown> = {}) {
  const packagePath = path.join(dataDir, 'packages', 'fixture')
  fs.mkdirSync(packagePath, { recursive: true })
  const pkg = repo.createPackage({ name: 'P2 Run Package', description: '', sourceType: 'local-directory' })
  const version = repo.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: { name: 'P2 Run Package', ...manifest },
    manifestHash: `p2-run-${Math.random().toString(16).slice(2)}`,
    packagePath,
    securityStatus: 'verified',
  })
  const installation = repo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
  return { pkg, version, installation }
}

function parseSse(text: string) {
  return text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/)
      const event: Record<string, unknown> = {}
      let data = ''
      for (const line of lines) {
        const separator = line.indexOf(':')
        if (separator < 0) continue
        const key = line.slice(0, separator)
        const value = line.slice(separator + 1).trimStart()
        if (key === 'data') data += value
        else event[key] = value
      }
      return { ...event, data: data ? JSON.parse(data) : undefined }
    })
}

describe('SKL12-P2-002 Grant/Run/Artifact HTTP contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-002-data-'))
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-002-export-'))
    artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-002-artifacts-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(exportDir, { recursive: true, force: true })
    fs.rmSync(artifactDir, { recursive: true, force: true })
  })

  it('uses only the trusted actor header for grant approval/rejection/revocation and records grant audit context', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { version } = createRunnableFixture(skillPackageRepo, {
      requestedCapabilities: [{ capability: 'web.search', scope: { allowedDomains: ['example.com'], maxCalls: 1 } }],
    })
    const created = await requestJson(app, '/skill-runs', {
      method: 'POST',
      headers: { 'x-bloom-actor': 'run-owner' },
      body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }),
    })
    expect(created.response.status).toBe(201)
    const runId = created.body.data.runId as string
    const capabilities = await requestJson(app, `/skill-runs/${runId}/capabilities`)
    const grantId = capabilities.body.data[0].grantId as string

    const spoofed = await requestJson(app, `/skill-capability-grants/${grantId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-approver', 'x-request-id': 'grant-spoof-rejected' },
      body: JSON.stringify({ actor: 'spoofed-approver', scope: { allowedDomains: ['example.com'], maxCalls: 1 } }),
    })
    expect(spoofed.response.status).toBe(400)
    expect(spoofed.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: 'grant-spoof-rejected' })

    const approved = await requestJson(app, `/skill-capability-grants/${grantId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-approver', 'x-request-id': 'grant-approve-1' },
      body: JSON.stringify({ scope: { allowedDomains: ['example.com'], maxCalls: 1 } }),
    })
    expect(approved.response.status).toBe(200)
    expect(approved.body.data).toMatchObject({ grantId, status: 'approved', approvedBy: 'trusted-approver' })

    const audit = await requestJson(app, `/skill-runtime/audit?action=capability.approved&resourceId=${encodeURIComponent(grantId)}`)
    expect(audit.response.status).toBe(200)
    expect(audit.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'trusted-approver',
        resourceId: grantId,
        securityDecision: 'allowed',
        policyVersion: 'skills-admin-v1.2',
        payload: expect.objectContaining({ requestId: 'grant-approve-1' }),
      }),
    ]))

    const revoked = await requestJson(app, `/skill-capability-grants/${grantId}/revoke`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-approver', 'x-request-id': 'grant-revoke-1' },
      body: JSON.stringify({ reason: 'run finished' }),
    })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body.data).toMatchObject({ grantId, status: 'revoked', revokeReason: 'run finished' })
  })

  it('keeps run event history and SSE in the same sequence and audits create/cancel operations', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { version } = createRunnableFixture(skillPackageRepo)
    const created = await requestJson(app, '/skill-runs', {
      method: 'POST',
      headers: { 'x-bloom-actor': 'run-owner', 'x-request-id': 'run-create-1' },
      body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: { prompt: 'safe summary' } }),
    })
    expect(created.response.status).toBe(201)
    const runId = created.body.data.runId as string
    expect(created.body.data).toMatchObject({ status: 'validating', revision: 1 })

    const history = await requestJson(app, `/skill-runs/${runId}/events`)
    const streamResponse = await app.request(new URL(`/api/v1/skill-runs/${runId}/stream`, 'http://localhost'), {
      headers: { 'x-bloom-role': 'admin' },
    })
    expect(streamResponse.status).toBe(200)
    const stream = parseSse(await streamResponse.text())
    expect(stream.map((item: any) => ({ seq: Number(item.id), type: item.event, payload: item.data.payload }))).toEqual(
      history.body.data.map((event: any) => ({ seq: event.seq, type: event.type, payload: event.payload })),
    )

    const cancel = await requestJson(app, `/skill-runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'run-owner', 'x-request-id': 'run-cancel-1' },
      body: JSON.stringify({ idempotencyKey: 'cancel-p2-002', expectedRevision: 1, reason: 'user requested stop' }),
    })
    expect(cancel.response.status).toBe(200)
    expect(cancel.body.data).toMatchObject({ id: runId, revision: 2, cancelRequested: true })

    const duplicate = await requestJson(app, `/skill-runs/${runId}/commands`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'run-owner' },
      body: JSON.stringify({ type: 'cancel', idempotencyKey: 'cancel-p2-002', expectedRevision: 1 }),
    })
    expect(duplicate.response.status).toBe(200)
    expect(duplicate.body.data).toMatchObject({ id: runId, revision: 2 })

    const stale = await requestJson(app, `/skill-runs/${runId}/commands`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'run-owner' },
      body: JSON.stringify({ type: 'cancel', idempotencyKey: 'cancel-p2-002-stale', expectedRevision: 1 }),
    })
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('REVISION_CONFLICT')

    const createAudit = await requestJson(app, `/skill-runtime/audit?action=skill.run.created&resourceId=${encodeURIComponent(runId)}`)
    expect(createAudit.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'run-owner',
        securityDecision: 'allowed',
        policyVersion: 'skills-admin-v1.2',
        payload: expect.objectContaining({ requestId: 'run-create-1', skillVersionId: version.id }),
      }),
    ]))
    const cancelAudit = await requestJson(app, `/skill-runtime/audit?action=skill.run.cancel_requested&resourceId=${encodeURIComponent(runId)}`)
    expect(cancelAudit.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'run-owner',
        securityDecision: 'allowed',
        policyVersion: 'skills-admin-v1.2',
        payload: expect.objectContaining({ requestId: 'run-cancel-1', reason: 'user requested stop' }),
      }),
    ]))
  })

  it('enforces artifact ownership, strict export confirmation, controlled paths, trusted actor audit, and user denial', async () => {
    const { app, skillPackageRepo, ArtifactStore } = await loadApi()
    const { version } = createRunnableFixture(skillPackageRepo)
    const first = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }),
    })
    const second = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }),
    })
    const firstRunId = first.body.data.runId as string
    const secondRunId = second.body.data.runId as string
    const artifact = new ArtifactStore().writeText({ runId: firstRunId, kind: 'markdown', fileName: 'summary.md', content: '# P2-002' })

    const wrongRun = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content?runId=${encodeURIComponent(secondRunId)}`)
    expect(wrongRun.status).toBe(404)

    const spoofed = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-exporter', 'x-request-id': 'artifact-spoof-rejected' },
      body: JSON.stringify({ runId: firstRunId, destinationDir: exportDir, confirmed: true, actor: 'spoofed-exporter', auditReason: 'should reject spoofed identity' }),
    })
    expect(spoofed.response.status).toBe(400)
    expect(spoofed.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: 'artifact-spoof-rejected' })

    const missingConfirmation = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-exporter' },
      body: JSON.stringify({ runId: firstRunId, destinationDir: exportDir, auditReason: 'missing confirmation' }),
    })
    expect(missingConfirmation.response.status).toBe(400)
    expect(missingConfirmation.body.error.code).toBe('VALIDATION_ERROR')

    const escaped = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-exporter' },
      body: JSON.stringify({ runId: firstRunId, destinationDir: path.dirname(exportDir), confirmed: true, auditReason: 'path traversal check' }),
    })
    expect(escaped.response.status).toBe(400)
    expect(escaped.body.error.code).toBe('ARTIFACT_ERROR')

    const denied = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-role': 'user' },
      body: JSON.stringify({ runId: firstRunId, destinationDir: exportDir, confirmed: true, auditReason: 'user cannot export' }),
    })
    expect(denied.response.status).toBe(403)

    const exported = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'trusted-exporter', 'x-request-id': 'artifact-export-1' },
      body: JSON.stringify({ runId: firstRunId, destinationDir: exportDir, confirmed: true, auditReason: 'Export P2 artifact for verification' }),
    })
    expect(exported.response.status).toBe(200)
    expect(exported.body.data.path).toBe(path.join(exportDir, 'summary.md'))
    expect(fs.readFileSync(exported.body.data.path, 'utf8')).toBe('# P2-002')

    const audit = await requestJson(app, `/skill-runtime/audit?action=artifact.exported&resourceId=${encodeURIComponent(artifact.id)}`)
    expect(audit.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'trusted-exporter',
        securityDecision: 'allowed',
        policyVersion: 'skills-admin-v1.2',
        payload: expect.objectContaining({ runId: firstRunId, requestId: 'artifact-export-1', auditReason: 'Export P2 artifact for verification' }),
      }),
    ]))
  })
})
