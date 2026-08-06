import { describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../../services/errors'
import { createChatSkillLauncher, buildSkillRunMessage } from './chat-skill-launcher'

describe('ChatSkillLauncher', () => {
  it('lists only enabled, installed, compatible Package Skill versions', () => {
    const packages = {
      listPackages: vi.fn(() => ({
        data: [
          { id: 'pkg-ready', name: 'Ready', description: 'ready', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1 },
          { id: 'pkg-disabled', name: 'Disabled', description: 'disabled', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1 },
        ],
        total: 2,
      })),
      listVersions: vi.fn((packageId: string) => packageId === 'pkg-ready'
        ? [{ id: 'version-ready', packageId, version: '1.0.0', runtime: 'instruction-agent', manifest: { requestedCapabilities: [{ capability: 'image.generate', scope: {} }] }, manifestHash: 'hash', packagePath: '/safe', sourceSnapshot: {}, isCompatible: true, createdAt: 1 }]
        : [{ id: 'version-disabled', packageId, version: '1.0.0', runtime: 'instruction-agent', manifest: {}, manifestHash: 'hash', packagePath: '/safe', sourceSnapshot: {}, isCompatible: true, createdAt: 1 }]),
      listInstallations: vi.fn((packageId: string) => packageId === 'pkg-ready'
        ? [{ id: 'install-ready', packageId, currentVersionId: 'version-ready', status: 'installed', enabled: true, installedAt: 1, updatedAt: 1 }]
        : [{ id: 'install-disabled', packageId, currentVersionId: 'version-disabled', status: 'installed', enabled: false, installedAt: 1, updatedAt: 1 }]),
    }
    const launcher = createChatSkillLauncher({
      packages,
      sessions: { get: vi.fn(() => ({ id: 'chat-1' })) },
      messages: { save: vi.fn() },
      runtime: {} as any,
    })

    expect(launcher.listChatEligibleSkills()).toEqual([expect.objectContaining({
      packageId: 'pkg-ready',
      skillVersionId: 'version-ready',
      requiredCapabilities: ['image.generate'],
    })])
  })

  it('starts one durable chat Run, stores a compact reference message, and reuses idempotent launches', async () => {
    const save = vi.fn()
    const startRun = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'created', revision: 0 })
    const findChatRunByIdempotency = vi.fn()
    const launcher = createChatSkillLauncher({
      packages: { listPackages: vi.fn(() => ({ data: [], total: 0 })), listVersions: vi.fn(), listInstallations: vi.fn() },
      sessions: { get: vi.fn(() => ({ id: 'chat-1' })) },
      messages: { save },
      runtime: { startRun, findChatRunByIdempotency } as any,
    })

    const first = await launcher.startRunFromChat({
      sessionId: 'chat-1',
      skillVersionId: 'version-1',
      input: { text: 'make an image' },
      idempotencyKey: 'submit-1',
      userMessage: { content: 'make an image', parts: [{ type: 'text', text: 'make an image' }] },
    })
    findChatRunByIdempotency.mockResolvedValue({ id: 'run-1', status: 'created', revision: 0, skillVersionId: 'version-1' })
    const second = await launcher.startRunFromChat({
      sessionId: 'chat-1',
      skillVersionId: 'version-1',
      input: { text: 'make an image' },
      idempotencyKey: 'submit-1',
      userMessage: { content: 'make an image', parts: [{ type: 'text', text: 'make an image' }] },
    })

    expect(first).toMatchObject({ runId: 'run-1', created: true })
    expect(second).toMatchObject({ runId: 'run-1', created: false })
    expect(startRun).toHaveBeenCalledOnce()
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      skillVersionId: 'version-1',
      surface: 'chat',
      sessionId: 'chat-1',
      target: { kind: 'chat', id: 'chat-1' },
      context: { chatIdempotencyKey: 'submit-1' },
    }))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toMatchObject({ role: 'assistant', content: '' })
    expect(JSON.parse(save.mock.calls[1][0].parts)).toEqual([expect.objectContaining({
      type: 'data-skill-run',
      data: expect.objectContaining({ runId: 'run-1', skillVersionId: 'version-1', sessionId: 'chat-1' }),
    })])
  })

  it('rejects launches for an unknown chat session', async () => {
    const launcher = createChatSkillLauncher({
      packages: { listPackages: vi.fn(() => ({ data: [], total: 0 })), listVersions: vi.fn(), listInstallations: vi.fn() },
      sessions: { get: vi.fn(() => undefined) },
      messages: { save: vi.fn() },
      runtime: {} as any,
    })

    await expect(launcher.startRunFromChat({ sessionId: 'missing', skillVersionId: 'version-1', input: {}, idempotencyKey: 'submit-1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('builds a reload-safe structured message without copying Run events', () => {
    expect(buildSkillRunMessage({ runId: 'run-1', skillVersionId: 'version-1', status: 'waiting_approval', sessionId: 'chat-1' })).toEqual({
      content: '',
      parts: [{ type: 'data-skill-run', data: { runId: 'run-1', skillVersionId: 'version-1', status: 'waiting_approval', sessionId: 'chat-1' } }],
    })
  })
})
