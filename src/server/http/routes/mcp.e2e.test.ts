import { describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../app'
import { McpService } from '../../mcp/mcp.service'
import { McpError } from '../../mcp/errors'
import type { McpServiceRepository } from '../../mcp/mcp.service'
import type { McpToolRun, McpServerTool } from '../../mcp/types'
import type { McpServerRecord } from '../../db/repositories/mcp.repo'

function server(): McpServerRecord {
  return {
    id: 'e2e-server',
    name: 'E2E MCP',
    transportKind: 'streamable_http',
    configJson: JSON.stringify({ url: 'https://example.test/mcp' }),
    secretRefs: [],
    isEnabled: false,
    trustLevel: 'untrusted',
    connectionStatus: 'unknown',
    catalogVersion: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function tool(): McpServerTool {
  return {
    id: 'mcp:e2e-server:echo',
    serverId: 'e2e-server',
    remoteName: 'echo',
    name: 'Echo',
    description: 'Echo',
    inputSchema: { type: 'object' },
    schemaHash: 'hash',
    schemaSupported: true,
    isEnabled: false,
    isRemoved: false,
    requiresApproval: true,
    riskLevel: 'medium',
    discoveredAt: 1,
    updatedAt: 1,
    removedAt: null,
  }
}

function createRepository(): McpServiceRepository {
  let current = server()
  let currentTool = tool()
  const run: McpToolRun = {
    id: 'e2e-run', serverId: current.id, toolId: currentTool.id, remoteName: currentTool.remoteName,
    sessionId: 'session', agentRole: 'general', status: 'success', inputHash: 'hash',
    safeInput: null, safeOutput: null, errorCode: null, durationMs: 0, createdAt: 1, completedAt: 1,
  }
  return {
    listServers: vi.fn(() => [current]),
    getServer: vi.fn((id: string) => id === current.id ? current : undefined),
    createServer: vi.fn((input) => {
      current = { ...current, id: input.id ?? current.id, name: input.name, transportKind: input.transportKind, configJson: input.configJson, secretRefs: input.secretRefs ?? [] }
      return current
    }),
    updateServer: vi.fn((_id, input) => { current = { ...current, ...input }; return current }),
    setServerEnabled: vi.fn((_id, enabled) => { current = { ...current, isEnabled: enabled }; return current }),
    setServerTrust: vi.fn((_id, trustLevel) => { current = { ...current, trustLevel }; return current }),
    deleteServer: vi.fn(() => true),
    getTool: vi.fn((id: string) => id === currentTool.id ? currentTool : undefined),
    listTools: vi.fn((serverId: string) => serverId === current.id ? [currentTool] : []),
    confirmCatalog: vi.fn(() => ({ server: current, tools: [currentTool] })),
    setToolEnabled: vi.fn((_id, enabled) => { currentTool = { ...currentTool, isEnabled: enabled }; return currentTool }),
    listRuns: vi.fn(() => [run]),
  }
}

describe('MCP app integration', () => {
  it('registers /api/v1/mcp under the shared Hono error/request boundary', async () => {
    const repository = createRepository()
    const service = new McpService({
      repository,
      env: { MCP_CLIENT_ENABLED: 'true' },
      connectionManager: { listTools: vi.fn(async () => []) },
      catalog: {
        preview: vi.fn(async () => ({
          previewId: 'preview', serverId: 'e2e-server', previewHash: 'p', configHash: 'c', catalogVersion: '0',
          diff: [], createdAt: 1, expiresAt: 301,
        })),
        confirm: vi.fn(() => ({ server: server(), tools: [] })),
        clearPreviews: vi.fn(),
      },
      broker: {
        getApprovalRequest: vi.fn(),
        execute: vi.fn(async () => { throw new McpError('MCP_TOOL_TIMEOUT') }),
        approve: vi.fn(),
        deny: vi.fn(),
      },
    })
    const app = createHonoApp({ mcp: service })
    const response = await app.request('/api/v1/mcp/servers/e2e-server/runs', {
      headers: { 'x-bloom-role': 'admin' },
    })
    expect(response.status).toBe(200)
    expect((await response.json() as any).data).toEqual([expect.objectContaining({ id: 'e2e-run' })])
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})
