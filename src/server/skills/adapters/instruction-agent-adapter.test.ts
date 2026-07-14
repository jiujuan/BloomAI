import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let packagePath: string
let originalEnv: NodeJS.ProcessEnv

async function createFixture(manifest: Record<string, unknown> = {}) {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { SkillRunCoordinator } = await import('../runtime/skill-run-coordinator')
  const version = skillPackageRepo.createVersion({
    packageId: skillPackageRepo.createPackage({ name: 'Adapter fixture', description: '', sourceType: 'local-directory' }).id,
    version: '1.0.0',
    manifest: { name: 'Adapter fixture', runtime: 'instruction-agent', requestedCapabilities: [{ capability: 'web.search', scope: {} }], ...manifest },
    manifestHash: 'adapter-fixture', packagePath,
  })
  const coordinator = new SkillRunCoordinator()
  const { runId } = coordinator.startRun({
    skillVersionId: version.id,
    input: { article: 'A city wakes at dawn.' },
    context: { surface: 'image-studio' },
    sessionId: 'session-1',
  })
  return { SkillRunCoordinator, coordinator, runId, skillPackageRepo, version }
}

describe('InstructionAgentAdapter', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-instruction-agent-'))
    packagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-instruction-package-'))
    originalEnv = { ...process.env }
    fs.mkdirSync(path.join(packagePath, 'references'), { recursive: true })
    fs.writeFileSync(path.join(packagePath, 'SKILL.md'), '# Article Illustrator\nCreate an editorial illustration plan.\n')
    fs.writeFileSync(path.join(packagePath, 'references', 'style.md'), '# Style\nEditorial photography.\n')
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(packagePath, { recursive: true, force: true })
  })

  it('executes only the selected SkillVersion with its entry, manifest, and constrained context', async () => {
    const { runId, coordinator } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const execute = vi.fn(async (context) => {
      expect(context).toMatchObject({
        runId,
        instruction: '# Article Illustrator\nCreate an editorial illustration plan.\n',
        manifest: expect.objectContaining({ name: 'Adapter fixture', runtime: 'instruction-agent' }),
        input: { article: 'A city wakes at dawn.' },
        runContext: { surface: 'image-studio' },
        maxSteps: 8,
        maxTokens: 1_000,
        allowedCapabilities: ['web.search'],
      })
      expect(context.readText).toBeTypeOf('function')
      expect(context.readAsset).toBeTypeOf('function')
      expect(context.executeCapability).toBeTypeOf('function')
      expect(context).not.toHaveProperty('packagePath')
      expect(context).not.toHaveProperty('repository')
      return { status: 'completed' as const, output: { plan: ['Dawn skyline'] }, tokensUsed: 240 }
    })
    const adapter = new InstructionAgentAdapter({ executor: { execute }, maxSteps: 8, maxTokens: 1_000 })

    const result = await adapter.run(runId)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'completed', output: { plan: ['Dawn skyline'] } })
    expect(coordinator.getRun(runId)).toMatchObject({ status: 'completed', output: { plan: ['Dawn skyline'] } })
  })

  it('persists partial package execution as completed_with_errors', async () => {
    const { runId, coordinator } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const adapter = new InstructionAgentAdapter({
      executor: { async execute() { return { status: 'completed_with_errors' as const, output: { images: { completed: 2, failed: 1 } } } } },
    })

    expect(await adapter.run(runId)).toMatchObject({ status: 'completed_with_errors', output: { images: { completed: 2, failed: 1 } } })
    expect(coordinator.getRun(runId).status).toBe('completed_with_errors')
    expect(coordinator.subscribeEvents(runId).at(-1)).toMatchObject({ type: 'run.completed_with_errors' })
  })

  it('loads references only when the executor requests them and blocks undeclared capabilities', async () => {
    const { runId, coordinator } = await createFixture()
    const { InstructionAgentAdapter, InstructionAgentAdapterError } = await import('./instruction-agent-adapter')
    const executeCapability = vi.fn()
    const adapter = new InstructionAgentAdapter({
      executor: {
        async execute(context) {
          expect(coordinator.subscribeEvents(runId).filter((event) => event.type === 'package.file_loaded'))
            .toMatchObject([{ payload: { path: 'SKILL.md' } }])
          expect(context.readText('references/style.md').content).toContain('Editorial photography')
          await expect(context.executeCapability('image.generate', { prompt: 'city' })).rejects.toThrow(InstructionAgentAdapterError)
          return { status: 'completed', output: { referenceUsed: true } }
        },
      },
      executeCapability,
    })

    await adapter.run(runId)

    expect(executeCapability).not.toHaveBeenCalled()
    expect(coordinator.subscribeEvents(runId).filter((event) => event.type === 'package.file_loaded'))
      .toMatchObject([
        { payload: { path: 'SKILL.md' } },
        { payload: { path: 'references/style.md' } },
      ])
  })

  it('forwards declared capabilities through the broker with the bound run and session', async () => {
    const { runId } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const executeCapability = vi.fn(async () => ({
      capability: 'web.search', toolId: 'web_search', toolRunId: 'tool-run-1', output: { results: [] },
    }))
    const adapter = new InstructionAgentAdapter({
      executor: {
        async execute(context) {
          await context.executeCapability('web.search', { url: 'https://example.test' })
          return { status: 'completed', output: { searched: true } }
        },
      },
      executeCapability,
    })

    await adapter.run(runId)

    expect(executeCapability).toHaveBeenCalledWith({
      caller: 'package-runtime', capability: 'web.search', input: { url: 'https://example.test' }, runId, sessionId: 'session-1',
    })
  })

  it('fails the run when the executor exceeds the configured step or token budget', async () => {
    const { runId: stepRunId, coordinator, version } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const stepLimited = new InstructionAgentAdapter({
      executor: { async execute(context) { context.startStep('one'); context.startStep('two'); return { status: 'completed', output: {} } } },
      maxSteps: 1,
    })

    const stepResult = await stepLimited.run(stepRunId)
    expect(stepResult).toMatchObject({ status: 'failed', errorCode: 'AGENT_BUDGET_EXCEEDED' })
    expect(coordinator.getRun(stepRunId).status).toBe('failed')

    const { runId: tokenRunId } = coordinator.startRun({
      skillVersionId: version.id,
      input: { article: 'A second city wakes at dawn.' },
      context: { surface: 'image-studio' },
      sessionId: 'session-1',
    })
    const tokenLimited = new InstructionAgentAdapter({
      executor: { async execute() { return { status: 'completed', output: {}, tokensUsed: 11 } } },
      maxTokens: 10,
    })

    const tokenResult = await tokenLimited.run(tokenRunId)
    expect(tokenResult).toMatchObject({ status: 'failed', errorCode: 'AGENT_BUDGET_EXCEEDED' })
    expect(coordinator.getRun(tokenRunId).status).toBe('failed')
  })

  it('persists user-input and approval waits with normalized approval capabilities', async () => {
    const { runId: inputRunId, coordinator, version } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const inputAdapter = new InstructionAgentAdapter({
      executor: { async execute() { return { status: 'waiting_input', reason: 'Choose an illustration style' } } },
    })

    const inputResult = await inputAdapter.run(inputRunId)
    expect(inputResult).toMatchObject({ status: 'waiting_input', waitingReason: 'Choose an illustration style' })

    const { runId: approvalRunId } = coordinator.startRun({
      skillVersionId: version.id,
      input: {}, context: {}, sessionId: 'session-1',
    })
    const approvalAdapter = new InstructionAgentAdapter({
      executor: {
        async execute() {
          return { status: 'waiting_approval', reason: 'Approve image generation', capabilities: ['image.generate'] }
        },
      },
    })

    const approvalResult = await approvalAdapter.run(approvalRunId)
    expect(approvalResult).toMatchObject({ status: 'waiting_approval', waitingReason: 'Approve image generation' })
    expect(coordinator.subscribeEvents(approvalRunId).at(-1)).toMatchObject({
      type: 'approval.required',
      payload: { reason: 'Approve image generation', capabilities: ['image.generate'] },
    })
  })

  it('resumes from waiting input after the user modifies the persisted input', async () => {
    const { runId, coordinator } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    const waitingAdapter = new InstructionAgentAdapter({
      executor: { async execute() { return { status: 'waiting_input', reason: 'Choose an illustration style' } } },
    })
    await waitingAdapter.run(runId)
    const modified = coordinator.dispatchCommand(runId, {
      type: 'modify', idempotencyKey: 'choose-style', expectedRevision: 3, patchInput: { style: 'editorial' },
    })
    const resumedAdapter = new InstructionAgentAdapter({
      executor: {
        async execute(context) {
          expect(context.input).toMatchObject({ style: 'editorial' })
          return { status: 'completed', output: { style: context.input.style } }
        },
      },
    })

    const result = await resumedAdapter.run(runId)

    expect(modified.status).toBe('waiting_input')
    expect(result).toMatchObject({ status: 'completed', output: { style: 'editorial' } })
  })

  it('honors cancellation requests before and during Agent execution', async () => {
    const { runId: beforeRunId, coordinator, version } = await createFixture()
    const { InstructionAgentAdapter } = await import('./instruction-agent-adapter')
    coordinator.dispatchCommand(beforeRunId, { type: 'cancel', idempotencyKey: 'cancel-before', expectedRevision: 1 })
    const notCalled = vi.fn()
    const beforeAdapter = new InstructionAgentAdapter({ executor: { execute: notCalled } })

    expect(await beforeAdapter.run(beforeRunId)).toMatchObject({ status: 'cancelled' })
    expect(notCalled).not.toHaveBeenCalled()

    const { runId: duringRunId } = coordinator.startRun({
      skillVersionId: version.id,
      input: {}, context: {}, sessionId: 'session-1',
    })
    const duringAdapter = new InstructionAgentAdapter({
      executor: {
        async execute(context) {
          coordinator.dispatchCommand(duringRunId, { type: 'cancel', idempotencyKey: 'cancel-during', expectedRevision: 2 })
          expect(context.isCancellationRequested()).toBe(true)
          return { status: 'completed', output: { ignored: true } }
        },
      },
    })

    expect(await duringAdapter.run(duringRunId)).toMatchObject({ status: 'cancelled' })
    expect(coordinator.getRun(duringRunId)).toMatchObject({ status: 'cancelled', output: null })
  })
})
