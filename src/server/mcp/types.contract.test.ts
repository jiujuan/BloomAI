import { describe, expect, it } from 'vitest'
import {
  MCP_ERROR_CODES,
  MCP_ERROR_HTTP_STATUS,
  MCP_RUN_STATUSES,
  canTransitionMcpRun,
  type DiscoveredMcpTool,
  type McpApprovalRequest,
  type McpPreview,
  type McpServerConnectionConfig,
  type McpServerTool,
  type McpToolExecutionContext,
  type McpToolRun,
  type McpTransportKind,
  type McpTrustLevel,
  type McpRunStatus,
} from './types'

describe('MCP domain type contract', () => {
  it('fixes the transport, trust, run status, and aggregate domain shapes', () => {
    const transportKind: McpTransportKind = 'streamable_http'
    const trustLevel: McpTrustLevel = 'reviewed'
    const runStatus: McpRunStatus = 'pending_approval'

    const connection: McpServerConnectionConfig = {
      serverId: 'server-1',
      name: 'Fixture server',
      transport: {
        kind: transportKind,
        url: 'https://example.test/mcp',
      },
      configVersion: 'config-v1',
      catalogVersion: 'catalog-v1',
      isEnabled: true,
      trustLevel,
    }

    const discoveredTool: DiscoveredMcpTool = {
      serverId: connection.serverId,
      localName: 'fixture_echo',
      remoteName: 'echo',
      name: 'Echo',
      description: 'Echoes input',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'string' },
    }

    const serverTool: McpServerTool = {
      id: 'mcp:server-1:echo',
      serverId: connection.serverId,
      remoteName: discoveredTool.remoteName,
      name: discoveredTool.name ?? 'Echo',
      description: discoveredTool.description ?? '',
      inputSchema: discoveredTool.inputSchema,
      outputSchema: discoveredTool.outputSchema,
      schemaHash: 'schema-hash',
      isEnabled: false,
      isRemoved: false,
      requiresApproval: true,
      riskLevel: 'medium',
      discoveredAt: 1_000,
      updatedAt: 1_000,
      removedAt: null,
    }

    const preview: McpPreview = {
      previewId: 'preview-1',
      serverId: connection.serverId,
      previewHash: 'preview-hash',
      configHash: 'config-hash',
      catalogVersion: connection.catalogVersion ?? 'catalog-v1',
      diff: [{ kind: 'added', remoteName: discoveredTool.remoteName }],
      createdAt: 1_000,
      expiresAt: 61_000,
    }

    const normalizedResult = {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true },
      isError: false,
      truncated: false,
    } as const

    const run: McpToolRun = {
      id: 'run-1',
      serverId: connection.serverId,
      toolId: serverTool.id,
      remoteName: serverTool.remoteName,
      sessionId: 'session-1',
      agentRole: 'general',
      status: runStatus,
      inputHash: 'input-hash',
      safeInput: { message: 'hello' },
      safeOutput: normalizedResult,
      errorCode: null,
      durationMs: null,
      createdAt: 1_000,
      completedAt: null,
    }

    const context: McpToolExecutionContext = {
      runId: run.id,
      serverId: connection.serverId,
      toolId: serverTool.id,
      remoteName: serverTool.remoteName,
      sessionId: 'session-1',
      role: 'general',
      catalogVersion: connection.catalogVersion ?? 'catalog-v1',
      configVersion: connection.configVersion,
    }

    expect(transportKind).toBe('streamable_http')
    expect(trustLevel).toBe('reviewed')
    expect(preview.diff[0]).toEqual({ kind: 'added', remoteName: 'echo' })
    expect(run.safeOutput?.structuredContent).toEqual({ ok: true })
    expect(context.remoteName).toBe('echo')
  })

  it('keeps approval versions string-compatible with the Task 1 store', () => {
    const request: McpApprovalRequest = {
      approvalRequestId: 'approval-1',
      runId: 'run-1',
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      inputHash: 'input-hash',
      catalogVersion: 'catalog-v1',
      sessionId: 'session-1',
      role: 'general',
      configVersion: 'config-v1',
      issuedAt: 1_000,
      expiresAt: 61_000,
      consumedAt: null,
    }

    expect(request.catalogVersion).toBe('catalog-v1')
    expect(request.configVersion).toBe('config-v1')
  })

  it('fixes the public run statuses and legal transitions', () => {
    expect(MCP_RUN_STATUSES).toEqual([
      'pending_approval',
      'running',
      'success',
      'error',
      'denied',
      'cancelled',
    ])
    expect(canTransitionMcpRun('pending_approval', 'running')).toBe(true)
    expect(canTransitionMcpRun('pending_approval', 'denied')).toBe(true)
    expect(canTransitionMcpRun('success', 'running')).toBe(false)
    expect(canTransitionMcpRun('running', 'success')).toBe(true)
  })

  it('fixes the complete stable error code list and HTTP mapping', () => {
    expect(MCP_ERROR_CODES).toEqual([
      'MCP_DISABLED',
      'MCP_CONFIG_INVALID',
      'MCP_SERVER_NOT_FOUND',
      'MCP_TOOL_NOT_FOUND',
      'MCP_SERVER_DISABLED',
      'MCP_TOOL_DISABLED',
      'MCP_ROLE_NOT_ALLOWED',
      'MCP_APPROVAL_REQUIRED',
      'MCP_APPROVAL_INVALID',
      'MCP_APPROVAL_EXPIRED',
      'MCP_PREVIEW_STALE',
      'MCP_SCHEMA_UNSUPPORTED',
      'MCP_CONNECTION_FAILED',
      'MCP_PROTOCOL_ERROR',
      'MCP_TOOL_ERROR',
      'MCP_TOOL_TIMEOUT',
      'MCP_TOOL_CANCELLED',
    ])
    expect(MCP_ERROR_HTTP_STATUS.MCP_SCHEMA_UNSUPPORTED).toBe(422)
    expect(MCP_ERROR_HTTP_STATUS.MCP_TOOL_TIMEOUT).toBe(504)
    expect(MCP_ERROR_HTTP_STATUS.MCP_TOOL_CANCELLED).toBe(499)
  })
})
