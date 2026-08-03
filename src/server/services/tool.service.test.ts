import { describe, expect, it, vi } from 'vitest'
import { CapabilityError } from '../skills/policy/capability-broker'
import { getToolContract, schemaToJsonSchema } from '../tools/contracts'
import { createToolService } from './tool.service'

describe('toolService', () => {
  it('joins tools with their permissions without leaking repository access to callers', () => {
    const repo = {
      list: vi.fn(() => [{ id: 'search', name: 'Search' }]),
      listPermissions: vi.fn(() => [{ tool_id: 'search', granted: 1 }]),
    } as any
    const service = createToolService({ repo })

    expect(service.list({ category: 'web' })).toEqual([expect.objectContaining({
      id: 'search',
      name: 'Search',
      permission: { tool_id: 'search', granted: 1 },
    })])
    expect(repo.list).toHaveBeenCalledWith('web')
  })

  it('only grants durable permissions with the permanent scope', () => {
    const repo = { grantPermission: vi.fn(), revokePermission: vi.fn() } as any
    const service = createToolService({ repo })

    expect(service.grantPermission('fs_write', 'permanent')).toEqual({ tool_id: 'fs_write', granted: true, scope: 'permanent' })
    expect(service.revokePermission('fs_write')).toEqual({ tool_id: 'fs_write', granted: false })
    expect(repo.grantPermission).toHaveBeenCalledWith('fs_write', 'permanent')
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

  it('projects built-in params and result schemas from the shared contract', () => {
    const tool = {
      id: 'web_fetch',
      category: 'web',
      name: 'Legacy Web Fetch',
      description: 'legacy description',
      params_schema: '{}',
      result_schema: '{}',
      requires_permission: 'network',
    }
    const service = createToolService({
      repo: {
        get: vi.fn(() => tool),
        getPermission: vi.fn(() => null),
      } as any,
    })
    const projected = service.get('web_fetch')
    const contract = getToolContract('web_fetch')!

    expect(projected).toMatchObject({
      params_schema: JSON.stringify(schemaToJsonSchema(contract.inputSchema)),
      result_schema: JSON.stringify(schemaToJsonSchema(contract.outputSchema)),
      description: contract.description,
    })
  })
})
