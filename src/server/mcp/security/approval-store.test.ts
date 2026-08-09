import { describe, expect, it } from 'vitest'
import {
  InMemoryApprovalStore,
  hashMcpApprovalInput,
} from '../approval-store'
import { McpSecurityError } from '../types'

type ApprovalInput = Parameters<InMemoryApprovalStore['issue']>[0]

function approvalInput(overrides: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    runId: 'run-1',
    serverId: 'server-1',
    toolId: 'mcp:server-1:echo',
    input: { text: 'hello', nested: { count: 1 } },
    catalogVersion: 'catalog-v1',
    sessionId: 'session-1',
    role: 'general-chat',
    configVersion: 'config-v1',
    ...overrides,
  }
}

describe('MCP server-side Approval Store contract', () => {
  it('stores only a hash and consumes an opaque token exactly once', () => {
    const store = new InMemoryApprovalStore({ now: () => 1_000 })
    const issued = store.issue(approvalInput())

    expect(issued.token).toMatch(/^mcp\.approval\.v1\./)
    expect(issued.request).toMatchObject({
      approvalRequestId: expect.any(String),
      runId: 'run-1',
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      inputHash: hashMcpApprovalInput(approvalInput().input),
      catalogVersion: 'catalog-v1',
      sessionId: 'session-1',
      role: 'general-chat',
      configVersion: 'config-v1',
      expiresAt: 61_000,
      consumedAt: null,
    })
    expect(JSON.stringify(store)).not.toContain('hello')
    expect(JSON.stringify(store)).not.toContain(issued.token)

    const grant = store.consume(issued.token, approvalInput())
    expect(grant).toMatchObject({
      approvalRequestId: issued.request.approvalRequestId,
      runId: 'run-1',
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      sessionId: 'session-1',
      role: 'general-chat',
    })
    expect(() => store.consume(issued.token, approvalInput()))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_INVALID'))
  })

  it('binds approval to run, server, tool, input, catalog, session, role, and config', () => {
    const fields: Array<[keyof ApprovalInput, string]> = [
      ['runId', 'run-other'],
      ['serverId', 'server-other'],
      ['toolId', 'mcp:server-1:other'],
      ['catalogVersion', 'catalog-v2'],
      ['sessionId', 'session-other'],
      ['role', 'admin'],
      ['configVersion', 'config-v2'],
    ]
    for (const [field, value] of fields) {
      const store = new InMemoryApprovalStore({ now: () => 1_000 })
      const issued = store.issue(approvalInput())
      expect(() => store.consume(issued.token, approvalInput({ [field]: value })))
        .toThrowError(new McpSecurityError('MCP_APPROVAL_INVALID'))
    }

    const store = new InMemoryApprovalStore({ now: () => 1_000 })
    const issued = store.issue(approvalInput())
    expect(() => store.consume(issued.token, approvalInput({ input: { text: 'tampered' } })))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_INVALID'))
  })

  it('expires approvals and requires a server-issued token rather than a boolean', () => {
    let now = 1_000
    const store = new InMemoryApprovalStore({ now: () => now })
    const issued = store.issue(approvalInput({ ttlMs: 10 }))
    now = 1_010
    expect(() => store.consume(issued.token, approvalInput()))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_EXPIRED'))
    expect(() => store.consume(undefined, approvalInput()))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_REQUIRED'))
    expect(() => store.consume('true', approvalInput({ approvalGranted: true } as never)))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_INVALID'))
  })

  it('invalidates old configuration versions and exposes only safe request snapshots', () => {
    const store = new InMemoryApprovalStore({ now: () => 1_000 })
    const issued = store.issue(approvalInput())
    expect(store.get(issued.request.approvalRequestId)).toEqual(issued.request)
    expect(store.invalidateByConfigVersion('server-1', 'config-v1', 'config-v2')).toBe(1)
    expect(() => store.consume(issued.token, approvalInput()))
      .toThrowError(new McpSecurityError('MCP_APPROVAL_INVALID'))
    expect(JSON.stringify(store.get(issued.request.approvalRequestId))).not.toContain('hello')
  })
})
