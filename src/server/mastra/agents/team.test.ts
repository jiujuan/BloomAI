import { describe, expect, it, vi } from 'vitest'

const buildToolsForRole = vi.hoisted(() => vi.fn(() => ({
  'fs_write': { id: 'fs_write' },
  'mcp:server-1:echo': { id: 'builtin-mcp-collision' },
})))

vi.mock('../tools', () => ({ buildToolsForRole }))

import { createCoderAgent, createWriterAgent } from './team'
import type { McpCapabilityBroker } from '../../mcp/capability-broker'
import type { McpAgentToolSurfaceDependencies } from '../../mcp/agent-tool-surface'
import type { McpServerRecord, McpToolRecord } from '../../db/repositories/mcp.repo'

function server(): McpServerRecord {
  return {
    id: 'server-1',
    name: 'Fixture Server',
    transportKind: 'streamable_http',
    configJson: JSON.stringify({ url: 'https://example.test/mcp' }),
    secretRefs: [],
    isEnabled: true,
    trustLevel: 'trusted',
    connectionStatus: 'healthy',
    catalogVersion: 1,
    lastErrorCode: null,
    lastErrorAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function tool(remoteName: string): McpToolRecord {
  return {
    id: `mcp:server-1:${remoteName}`,
    serverId: 'server-1',
    remoteName,
    name: remoteName,
    description: remoteName,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    schemaHash: `schema-${remoteName}`,
    schemaSupported: true,
    isEnabled: true,
    isRemoved: false,
    requiresApproval: false,
    riskLevel: 'low',
    discoveredAt: 1,
    updatedAt: 1,
    removedAt: null,
  }
}

function dependencies(overrides: Partial<McpAgentToolSurfaceDependencies> = {}) {
  const repository = {
    listServers: vi.fn(() => [server()]),
    listTools: vi.fn(() => [tool('echo'), tool('search')]),
  }
  const broker = {
    execute: vi.fn().mockResolvedValue({
      status: 'success',
      result: { content: [], isError: false, truncated: false },
      run: { id: 'run-1' },
    }),
  } as unknown as Pick<McpCapabilityBroker, 'execute'>
  return {
    repository,
    broker,
    env: { MCP_CLIENT_ENABLED: 'true' },
    ...overrides,
  } satisfies McpAgentToolSurfaceDependencies
}

function getAgentTools(agent: any, values: Record<string, unknown>) {
  const toolsFactory = agent.__getOverridableFields().tools
  return toolsFactory({ requestContext: { get: (key: string) => values[key] } })
}

describe('specialist Agent MCP surfaces', () => {
  it('gives Writer a fixed writing role even if request context contains forged routing facts', async () => {
    const mcp = dependencies()
    const agent = createWriterAgent({ mcpToolSurface: mcp })
    const tools = getAgentTools(agent, { sessionId: 'session-1', mode: 'deep', agentId: 'coder', role: 'admin' })

    expect(Object.keys(tools)).toEqual(['mcp:server-1:echo', 'mcp:server-1:search'])
    await tools['mcp:server-1:echo'].execute?.({}, {} as any)
    expect(mcp.broker.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      role: 'writing',
      caller: 'agent',
    }))
  })

  it('gives Coder a fixed coding role and preserves built-in tools over same-id MCP tools', () => {
    const mcp = dependencies()
    const agent = createCoderAgent({ mcpToolSurface: mcp })
    const tools = getAgentTools(agent, { sessionId: 'session-1', mode: 'chat', agentId: 'writer' })

    expect(Object.keys(tools)).toEqual(['fs_write', 'mcp:server-1:echo', 'mcp:server-1:search'])
    expect(tools['mcp:server-1:echo']).toMatchObject({ id: 'builtin-mcp-collision' })
  })

  it('does not register MCP tools when the server policy denies the specialist role', () => {
    const mcp = dependencies({ rolePolicy: () => false })
    const agent = createWriterAgent({ mcpToolSurface: mcp })

    expect(getAgentTools(agent, { sessionId: 'session-1', mode: 'chat', agentId: 'writer' })).toEqual({})
  })
})
