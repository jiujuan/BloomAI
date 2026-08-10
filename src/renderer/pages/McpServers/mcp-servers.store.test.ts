import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpServersStore } from './mcp-servers.store'
import type { McpServer, McpTool } from './mcp-servers.types'

const server: McpServer = {
  id: 'server-1',
  name: 'Demo MCP',
  transport: { kind: 'stdio', command: 'node', args: ['fixture.mjs'], envNames: ['API_TOKEN'] },
  connectionStatus: 'healthy',
  isEnabled: false,
  trustLevel: 'reviewed',
  catalogVersion: 2,
  lastErrorCode: null,
  lastErrorAt: null,
  createdAt: 1,
  updatedAt: 2,
}
const tool: McpTool = {
  id: 'mcp:server-1:echo',
  serverId: 'server-1',
  remoteName: 'echo',
  name: 'echo',
  description: 'Echo input',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  schemaHash: 'schema',
  schemaSupported: true,
  isEnabled: true,
  isRemoved: false,
  requiresApproval: false,
  riskLevel: 'low',
  discoveredAt: 1,
  updatedAt: 2,
  removedAt: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  useMcpServersStore.getState().reset()
})

describe('MCP server store safety', () => {
  it('does not optimistically enable a tool before the server confirms it', async () => {
    useMcpServersStore.setState({ servers: [server], selectedServerId: server.id, tools: [{ ...tool, isEnabled: false }] })
    const update = vi.fn().mockResolvedValue({ ...tool, isEnabled: true })
    useMcpServersStore.setState({ api: { updateTool: update } as never })

    const pending = useMcpServersStore.getState().setToolEnabled(tool.id, true)
    expect(useMcpServersStore.getState().tools[0]?.isEnabled).toBe(false)
    await pending
    expect(useMcpServersStore.getState().tools[0]?.isEnabled).toBe(true)
  })

  it('keeps approval state to request/run/safe preview/expiry only', async () => {
    const testTool = vi.fn().mockRejectedValue(Object.assign(new Error('approval'), {
      code: 'MCP_APPROVAL_REQUIRED',
      status: 409,
      details: {
        approvalRequestId: 'approval-1',
        runId: 'run-1',
        expiresAt: 123,
        safePreview: { toolId: tool.id, safeInput: { text: 'hello' }, approvalToken: 'never-store' },
        approvalToken: 'never-store',
      },
    }))
    useMcpServersStore.setState({ servers: [server], selectedServerId: server.id, tools: [tool], api: { testTool } as never })

    await useMcpServersStore.getState().runToolTest(tool.id, { text: 'hello' })
    const approval = useMcpServersStore.getState().pendingApproval
    expect(approval).toMatchObject({ approvalRequestId: 'approval-1', runId: 'run-1', expiresAt: 123 })
    expect(approval).not.toHaveProperty('approvalToken')
    expect(JSON.stringify(approval)).not.toContain('never-store')
  })

  it('clears preview and tools after a configuration change', async () => {
    const updateServer = vi.fn().mockResolvedValue({ ...server, updatedAt: 3 })
    useMcpServersStore.setState({
      servers: [server], selectedServerId: server.id, tools: [tool],
      preview: { previewId: 'p', serverId: server.id, previewHash: 'h', configHash: 'c', catalogVersion: '2', diff: [], createdAt: 1, expiresAt: 100 },
      api: { updateServer } as never,
    })

    await useMcpServersStore.getState().updateServer(server.id, { name: 'Renamed' })
    expect(useMcpServersStore.getState().preview).toBeNull()
    expect(useMcpServersStore.getState().tools).toEqual([])
    expect(useMcpServersStore.getState().connectionTest).toBeNull()
  })
})
