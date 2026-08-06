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
    const events = skillPackageRepo.listEvents(run.id)
    expect(events.map((event) => event.type)).toEqual([
      'capability.requested', 'capability.requested', 'capability.started', 'capability.completed', 'capability.call',
    ])
    expect(events.find((event) => event.type === 'capability.call')).toMatchObject({
      payload_json: expect.stringContaining(result.toolRunId),
    })
    expect(events[0].payload_json).toContain('web.search')
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

  it('propagates an upstream abort to the tool executor and records a cancelled run', async () => {
    const { toolRegistry, executeLegacyToolCapability } = await loadRuntime()
    const controller = new AbortController()
    let executorSignal: AbortSignal | undefined
    toolRegistry.web_search = vi.fn(async (_input, context) => new Promise((resolve) => {
      executorSignal = context.signal
      context.signal?.addEventListener('abort', () => resolve({ query: 'cancelled', total: 0, results: [] }), { once: true })
    }))

    const pending = executeLegacyToolCapability({
      caller: 'http',
      toolId: 'web_search',
      input: { query: 'cancelled' },
      signal: controller.signal,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ status: 'cancelled' })
    expect(executorSignal?.aborted).toBe(true)
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

    const event = skillPackageRepo.listEvents(run.id).find((candidate) => candidate.type === 'capability.call')
    expect(event).toMatchObject({ type: 'capability.call' })
    expect(event?.payload_json).toContain('\"status\":\"failed\"')
    expect(event?.payload_json).toMatch(/\"toolRunId\":\"[^\"]+\"/)
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

  it('allows fs_apply_patch dry runs without write approval but gates actual writes', async () => {
    const { executeLegacyToolCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const root = fs.mkdtempSync(path.join(process.cwd(), '.bloomai-b1-capability-'))
    try {
    const dryRun = await executeLegacyToolCapability({
      caller: 'http',
      toolId: 'fs_apply_patch',
      sessionId: 'session-1',
      input: {
        patch: [
          '--- /dev/null',
          '+++ b/new.txt',
          '@@ -0,0 +1,1 @@',
          '+hello',
        ].join('\n'),
        root,
        dryRun: true,
      },
    })
    expect(dryRun.output).toMatchObject({ dryRun: true, applied: false })

    await expect(executeLegacyToolCapability({
      caller: 'http',
      toolId: 'fs_apply_patch',
      sessionId: 'session-1',
      input: {
        patch: [
          '--- /dev/null',
          '+++ b/new.txt',
          '@@ -0,0 +1,1 @@',
          '+hello',
        ].join('\n'),
        root,
        dryRun: false,
      },
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts session, permanent, and exact one-time grants for fs_apply_patch writes', async () => {
    const { toolRepo, executeLegacyToolCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const sessionId = 'session-1'
    const root = fs.mkdtempSync(path.join(process.cwd(), '.bloomai-b1-capability-'))
    const patchInput = {
      patch: [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ].join('\n'),
      root,
      dryRun: false,
    }

    try {
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        sessionId,
        input: patchInput,
      })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

      const { sessionToolPermissionStore } = await import('../../tools/session-permission-store')
      sessionToolPermissionStore.grant('fs_apply_patch', sessionId)
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        sessionId,
        input: patchInput,
      })).resolves.toMatchObject({ output: { applied: true } })

      toolRepo.grantPermission('fs_apply_patch', 'permanent')
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        sessionId: 'session-2',
        input: {
          ...patchInput,
          patch: [
            '--- /dev/null',
            '+++ b/permanent.txt',
            '@@ -0,0 +1,1 @@',
            '+hello',
          ].join('\n'),
        },
      })).resolves.toMatchObject({ output: { applied: true } })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('consumes an exact one-time fs_apply_patch approval token only once', async () => {
    const { executeLegacyToolCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const sessionId = 'session-1'
    const root = fs.mkdtempSync(path.join(process.cwd(), '.bloomai-b1-capability-'))
    const input = {
      patch: [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ].join('\n'),
      root,
      dryRun: false,
    }
    const { createApprovalToken } = await import('../../tools/approval-token')
    const token = createApprovalToken({
      secret: process.env.TOOL_APPROVAL_TOKEN_SECRET ?? 'bloomai-development-approval-secret',
      toolId: 'fs_apply_patch',
      sessionId,
      input,
    })

    try {
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        sessionId,
        approvalToken: token,
        input,
      })).resolves.toMatchObject({ output: { applied: true } })

      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        sessionId,
        approvalToken: token,
        input,
      })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows patch preview without approval and requires a trusted one-time token for writes', async () => {
    process.env.TOOL_APPROVAL_TOKEN_SECRET = 'patch-test-secret'
    const { executeLegacyToolCapability, CapabilityApprovalRequiredError } = await loadRuntime()
    const { createApprovalToken } = await import('../../tools/approval-token')
    const workspace = fs.mkdtempSync(path.join(process.cwd(), '.bloomai-fs-apply-patch-'))
    const filePath = path.join(workspace, 'notes.txt')
    const patch = [
      '--- a/notes.txt',
      '+++ b/notes.txt',
      '@@ -1,1 +1,1 @@',
      '-before',
      '+after',
    ].join('\n')
    fs.writeFileSync(filePath, 'before\n', 'utf8')

    try {
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        input: { patch, root: workspace },
      })).resolves.toMatchObject({ output: { dryRun: true, applied: false } })

      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        input: { patch, root: workspace, dryRun: false, createBackup: true },
        sessionId: 'patch-session',
      })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

      const approvalToken = createApprovalToken({
        secret: 'patch-test-secret',
        toolId: 'fs_apply_patch',
        sessionId: 'patch-session',
        input: { patch, root: workspace, dryRun: false, createBackup: true },
      })
      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        input: { patch, root: workspace, dryRun: false, createBackup: true },
        sessionId: 'patch-session',
        approvalToken,
      })).resolves.toMatchObject({ output: { dryRun: false, applied: true, rollbackToken: expect.any(String) } })
      expect(fs.readFileSync(filePath, 'utf8')).toBe('after\n')

      await expect(executeLegacyToolCapability({
        caller: 'http',
        toolId: 'fs_apply_patch',
        input: { patch, root: workspace, dryRun: false, createBackup: true },
        sessionId: 'patch-session',
        approvalToken,
      })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
