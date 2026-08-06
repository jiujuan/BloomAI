import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { SkillPackageReader } from '../packages/package-reader'
import { SkillExecutionContext } from './skill-execution-context'

describe('SkillExecutionContext', () => {
  it('exposes constrained reads, usage, and broker-only capabilities', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-execution-context-'))
    fs.mkdirSync(path.join(root, 'references'), { recursive: true })
    fs.writeFileSync(path.join(root, 'references', 'guide.md'), 'guide')
    const onEvent = vi.fn()
    const onUsage = vi.fn()
    const executeCapability = vi.fn(async (request) => ({ capability: request.capability, toolId: 'tool-1', toolRunId: 'tool-run-1', output: { ok: true } }))
    const context = new SkillExecutionContext({
      runId: 'run-1', instruction: 'read', manifest: {}, input: {}, runContext: {},
      allowedCapabilities: ['web.search'], reader: new SkillPackageReader(root),
      limits: { maxSteps: 2, maxTokens: 10, maxDurationMs: 10_000, maxLoadedFiles: 2, maxFileBytes: 100 },
      executeCapability, isCancellationRequested: () => false, onEvent, onUsage,
    })

    expect(context.readText('references/guide.md').content).toBe('guide')
    context.startStep('read')
    context.consumeTokens(3)
    await expect(context.executeCapability('web.search', { q: 'x' })).resolves.toMatchObject({ capability: 'web.search' })
    expect(onEvent).toHaveBeenCalledWith('step.started', { title: 'read' })
    expect(onUsage).toHaveBeenCalled()
    expect(executeCapability).toHaveBeenCalledWith(expect.objectContaining({ caller: 'package-runtime', capability: 'web.search', runId: 'run-1' }))
  })

  it('rejects undeclared capabilities and hard limits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-execution-context-'))
    fs.writeFileSync(path.join(root, 'SKILL.md'), 'entry')
    const context = new SkillExecutionContext({
      runId: 'run-1', instruction: 'read', manifest: {}, input: {}, runContext: {}, allowedCapabilities: [],
      reader: new SkillPackageReader(root),
      limits: { maxSteps: 1, maxTokens: 2, maxDurationMs: 10_000, maxLoadedFiles: 1, maxFileBytes: 100 },
      executeCapability: vi.fn(), isCancellationRequested: () => false,
    })
    await expect(context.executeCapability('shell.execute', {})).rejects.toThrow('not declared')
    context.startStep('one')
    expect(() => context.startStep('two')).toThrow('step limit')
    expect(() => context.consumeTokens(3)).toThrow('token limit')
  })
})
