import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { toolRepo } = await import('../../db/repositories/tool.repo')
  const { toolRegistry } = await import('../../tools/registry')
  const broker = await import('./capability-broker')
  return { skillPackageRepo, toolRepo, toolRegistry, ...broker }
}

async function createPackageRun(skillPackageRepo: Awaited<ReturnType<typeof loadRuntime>>['skillPackageRepo']) {
  const pkg = skillPackageRepo.createPackage({ name: 'Article Illustrator', description: '', sourceType: 'local-directory' })
  const version = skillPackageRepo.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: { runtime: 'instruction-agent' },
    manifestHash: 'package-hash',
    packagePath: '/packages/package-hash',
  })
  const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
  return { version, run }
}

describe('CapabilityBroker', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-capability-broker-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('requires a package capability grant and audits a tool call with runId and toolRunId', async () => {
    const { skillPackageRepo, toolRepo, toolRegistry, executeCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const { version, run } = await createPackageRun(skillPackageRepo)
    toolRegistry.web_search = vi.fn(async () => ({ results: [{ title: 'Result' }] }))

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'illustration ideas' },
      runId: run.id,
      sessionId: 'session-1',
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.search',
      grantMode: 'persistent',
    })

    const result = await executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'illustration ideas' },
      runId: run.id,
      sessionId: 'session-1',
    })

    expect(result.output).toEqual({ results: [{ title: 'Result' }] })
    expect(result.toolRunId).toEqual(expect.any(String))
    expect(toolRepo.listRuns('web_search')[0]).toMatchObject({ id: result.toolRunId, session_id: 'session-1', status: 'success' })
    expect(skillPackageRepo.listEvents(run.id)).toEqual([
      expect.objectContaining({ type: 'capability.call', payload_json: expect.stringContaining(result.toolRunId) }),
    ])
    expect(skillPackageRepo.listEvents(run.id)[0].payload_json).toContain(run.id)
  })

  it('rejects explicitly forbidden package capabilities before a tool can run', async () => {
    const { skillPackageRepo, toolRepo, executeCapability, CapabilityDeniedError } = await loadRuntime()
    const { run } = await createPackageRun(skillPackageRepo)

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'shell.execute',
      input: { command: 'whoami' },
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'python.execute',
      input: { code: 'print(1)' },
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)

    expect(toolRepo.listRuns('shell')).toEqual([])
    expect(toolRepo.listRuns('python_runner')).toEqual([])
  })

  it('checks tool enablement at the broker boundary', async () => {
    const { toolRepo, executeLegacyToolCapability, CapabilityDisabledError } = await loadRuntime()
    toolRepo.setEnabled('web_search', false)

    await expect(executeLegacyToolCapability({
      caller: 'http',
      toolId: 'web_search',
      input: { query: 'blocked' },
    })).rejects.toBeInstanceOf(CapabilityDisabledError)

    expect(toolRepo.listRuns('web_search')).toEqual([])
  })

  it('enforces image model allowlists and per-run call budgets for package capabilities', async () => {
    const { skillPackageRepo, toolRegistry, executeCapability, CapabilityDeniedError } = await loadRuntime()
    const { version, run } = await createPackageRun(skillPackageRepo)
    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'image.generate',
      grantMode: 'persistent',
      scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 1 },
    })
    const imageStudio = await import('../../services/image-studio.service')
    vi.spyOn(imageStudio, 'generateForSession').mockResolvedValue({
      id: 'generation-1', session_id: 'unused', message_id: null, prompt: 'A lighthouse', resolved_prompt: 'A lighthouse', provider_id: 'fixture',
      model: 'agnes-image-2.1-flash', aspect_ratio: null, style: null, size: null, seed: null, reference_images: null,
      status: 'completed', provider_task_id: null, progress: null, url: 'https://example.test/image.png', local_path: null,
      error_msg: null, duration_ms: 1, created_at: Date.now(), updated_at: Date.now(),
    })

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'image.generate',
      input: { prompt: 'A lighthouse', model: 'unapproved-model' },
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'image.generate',
      input: { prompt: 'A lighthouse', model: 'agnes-image-2.1-flash' },
      runId: run.id,
    })).resolves.toMatchObject({ toolId: 'image_gen', output: { status: 'completed', imageSessionId: expect.any(String) } })

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'image.generate',
      input: { prompt: 'A second lighthouse', model: 'agnes-image-2.1-flash' },
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)
  })

  it('audits a failed package tool invocation with the linked toolRunId', async () => {
    const { skillPackageRepo, toolRegistry, executeCapability } = await loadRuntime()
    const { version, run } = await createPackageRun(skillPackageRepo)
    skillPackageRepo.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.search', grantMode: 'persistent' })
    toolRegistry.web_search = vi.fn(async () => { throw new Error('search provider unavailable') })

    await expect(executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'illustration ideas' },
      runId: run.id,
    })).rejects.toThrow('search provider unavailable')

    const [event] = skillPackageRepo.listEvents(run.id)
    expect(event).toMatchObject({ type: 'capability.call' })
    expect(event.payload_json).toContain('"status":"failed"')
    expect(event.payload_json).toMatch(/"toolRunId":"[^"]+"/)
  })

  it('consumes once grants and rejects expired or session-mismatched grants', async () => {
    const { skillPackageRepo, toolRegistry, executeCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const { version, run } = await createPackageRun(skillPackageRepo)
    toolRegistry.web_search = vi.fn(async () => ({ results: [] }))
    skillPackageRepo.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.search', grantMode: 'once' })

    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.search', input: { query: 'first' }, runId: run.id,
    })).resolves.toMatchObject({ toolId: 'web_search' })
    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.search', input: { query: 'second' }, runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id, capability: 'web.search', grantMode: 'session', sessionId: 'session-1',
    })
    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.search', input: { query: 'other' }, runId: run.id, sessionId: 'session-2',
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id, capability: 'web.search', grantMode: 'persistent', expiresAt: Date.now() - 1,
    })
    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.search', input: { query: 'expired' }, runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)
  })

  it('enforces granted web domains and uploaded-file roots', async () => {
    const { skillPackageRepo, toolRegistry, executeCapability, CapabilityDeniedError } = await loadRuntime()
    const { version, run } = await createPackageRun(skillPackageRepo)
    toolRegistry.web_fetch = vi.fn(async () => ({ content: 'ok' }))
    toolRegistry.doc_markdown = vi.fn(async () => ({ text: 'ok' }))
    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id, capability: 'web.fetch', grantMode: 'persistent', scope: { allowedDomains: ['docs.example.test'] },
    })
    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id, capability: 'document.read_uploaded', grantMode: 'persistent', scope: { allowedRoots: ['/uploads'] },
    })

    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.fetch', input: { url: 'https://api.example.test/data' }, runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)
    await expect(executeCapability({
      caller: 'package-runtime', capability: 'document.read_uploaded', input: { path: '/uploads/../secrets.env' }, runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)
    await expect(executeCapability({
      caller: 'package-runtime', capability: 'web.fetch', input: { url: 'https://docs.example.test/data' }, runId: run.id,
    })).resolves.toMatchObject({ toolId: 'web_fetch' })
  })
})
