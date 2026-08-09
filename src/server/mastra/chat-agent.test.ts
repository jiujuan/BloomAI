import { describe, expect, it, vi } from 'vitest'

const buildAgentTools = vi.hoisted(() => vi.fn(() => ({
  builtin: { id: 'builtin' },
  'mcp:server-1:echo': { id: 'builtin-mcp-collision' },
})))

vi.mock('./tools', () => ({ buildAgentTools }))
vi.mock('./workspace/project-workspace.factory', () => ({
  projectWorkspaceFactory: { getCached: vi.fn() },
}))

import { buildChatAgentTools, createChatAgent } from './chat-agent'
import type { McpCapabilityBroker } from '../mcp/capability-broker'
import type { McpAgentToolSurfaceDependencies } from '../mcp/agent-tool-surface'
import type { McpServerRecord, McpToolRecord } from '../db/repositories/mcp.repo'

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

function tool(): McpToolRecord {
  return {
    id: 'mcp:server-1:echo',
    serverId: 'server-1',
    remoteName: 'echo',
    name: 'Echo',
    description: 'Echo input',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    schemaHash: 'schema-v1',
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

function mcpDependencies(): McpAgentToolSurfaceDependencies & {
  repository: { listServers: ReturnType<typeof vi.fn>; listTools: ReturnType<typeof vi.fn> }
  broker: Pick<McpCapabilityBroker, 'execute'>
} {
  const repository = {
    listServers: vi.fn(() => [server()]),
    listTools: vi.fn(() => [tool()]),
  }
  const broker = {
    execute: vi.fn().mockResolvedValue({
      status: 'success',
      result: { content: [], isError: false, truncated: false },
      run: { id: 'run-1' },
    }),
  } as unknown as Pick<McpCapabilityBroker, 'execute'>
  return {
    repository: repository as unknown as McpAgentToolSurfaceDependencies['repository'] & {
      listServers: ReturnType<typeof vi.fn>
      listTools: ReturnType<typeof vi.fn>
    },
    broker,
    env: { MCP_CLIENT_ENABLED: 'true' },
  }
}

function requestContext(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] }
}

describe('Chat Agent MCP integration', () => {
  it('merges the local MCP surface into the Chat Agent and keeps built-ins ahead of remote ids', () => {
    const dependencies = mcpDependencies()
    const context = requestContext({ sessionId: 'session-1', mode: 'chat', agentId: 'chat' })

    const tools = buildChatAgentTools(context, undefined as never, dependencies)

    expect(Object.keys(tools)).toEqual(['builtin', 'mcp:server-1:echo'])
    expect(tools['mcp:server-1:echo']).toMatchObject({ id: 'builtin-mcp-collision' })
    expect(dependencies.repository.listServers).toHaveBeenCalledOnce()
    expect(dependencies.repository.listTools).toHaveBeenCalledOnce()
    expect(dependencies.broker.execute).not.toHaveBeenCalled()
  })

  it('uses the same MCP injection when the registered Agent is built from the composition factory', () => {
    const dependencies = mcpDependencies()
    const agent = createChatAgent({ mcpToolSurface: dependencies })
    const toolsFactory = (agent as any).__getOverridableFields().tools

    const tools = toolsFactory({
      requestContext: requestContext({ sessionId: 'session-1', mode: 'chat', agentId: 'chat' }),
    })

    expect(tools['mcp:server-1:echo']).toMatchObject({ id: 'builtin-mcp-collision' })
    expect(dependencies.broker.execute).not.toHaveBeenCalled()
  })
})
