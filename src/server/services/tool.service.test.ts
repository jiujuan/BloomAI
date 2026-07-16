import { describe, expect, it, vi } from 'vitest'
import { CapabilityError } from '../skills/policy/capability-broker'
import { createToolService } from './tool.service'

describe('toolService', () => {
  it('joins tools with their permissions without leaking repository access to callers', () => {
    const repo = {
      list: vi.fn(() => [{ id: 'search', name: 'Search' }]),
      listPermissions: vi.fn(() => [{ tool_id: 'search', granted: 1 }]),
    } as any
    const service = createToolService({ repo })

    expect(service.list({ category: 'web' })).toEqual([{ id: 'search', name: 'Search', permission: { tool_id: 'search', granted: 1 } }])
    expect(repo.list).toHaveBeenCalledWith('web')
  })

  it('grants and revokes permissions using the historical session default', () => {
    const repo = { grantPermission: vi.fn(), revokePermission: vi.fn() } as any
    const service = createToolService({ repo })

    expect(service.grantPermission('fs_write')).toEqual({ tool_id: 'fs_write', granted: true, scope: 'session' })
    expect(service.revokePermission('fs_write')).toEqual({ tool_id: 'fs_write', granted: false })
    expect(repo.grantPermission).toHaveBeenCalledWith('fs_write', 'session')
    expect(repo.revokePermission).toHaveBeenCalledWith('fs_write')
  })

  it('keeps the legacy capability error code when a tool execution is denied', async () => {
    const service = createToolService({
      repo: {} as any,
      executeLegacyToolCapability: vi.fn(async () => { throw new CapabilityError('CAPABILITY_DENIED', 'Permission denied') }),
    })

    await expect(service.run('search', { input: {}, sessionId: 's1' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED', message: 'Permission denied' })
  })

  it('maps an unexpected legacy tool exception to TOOL_ERROR and forwards run pagination', async () => {
    const repo = { listRuns: vi.fn(() => [{ id: 'run-1' }]) } as any
    const service = createToolService({
      repo,
      executeLegacyToolCapability: vi.fn(async () => { throw new Error('runner failed') }),
    })

    await expect(service.run('search', { input: {} })).rejects.toMatchObject({ code: 'TOOL_ERROR', message: 'runner failed' })
    expect(service.listRuns('search', 7)).toEqual([{ id: 'run-1' }])
    expect(repo.listRuns).toHaveBeenCalledWith('search', 7)
  })

  it('returns NOT_FOUND for a missing tool detail', () => {
    const service = createToolService({ repo: { get: vi.fn(() => undefined) } as any })
    expect(() => service.get('missing')).toThrowError('Tool not found')
    try { service.get('missing') } catch (error) { expect(error).toMatchObject({ code: 'NOT_FOUND' }) }
  })
})
