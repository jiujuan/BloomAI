import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { McpServersPage, McpServerCard, McpToolPolicyTable, sanitizeMcpApprovalDetails } from './index'
import { useMcpServersStore } from './mcp-servers.store'
import type { McpServer, McpTool } from './mcp-servers.types'

const server: McpServer = {
  id: 'server-1',
  name: 'Demo MCP',
  transport: { kind: 'streamable_http', url: 'https://mcp.example.test', origin: 'https://mcp.example.test', headers: ['Authorization'] },
  connectionStatus: 'healthy',
  isEnabled: true,
  trustLevel: 'trusted',
  catalogVersion: 4,
  lastErrorCode: null,
  lastErrorAt: null,
  createdAt: 1,
  updatedAt: 2,
}
const tool: McpTool = {
  id: 'mcp:server-1:search',
  serverId: server.id,
  remoteName: 'search',
  name: 'search',
  description: 'Search remote records',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  schemaHash: 'hash',
  schemaSupported: true,
  isEnabled: true,
  isRemoved: false,
  requiresApproval: true,
  riskLevel: 'high',
  discoveredAt: 1,
  updatedAt: 2,
  removedAt: null,
}

beforeEach(() => useMcpServersStore.getState().reset())

describe('MCP management UI', () => {
  it('renders safe transport summaries without header values or secrets', () => {
    const markup = renderToStaticMarkup(<McpServerCard server={server} toolCount={1} onSelect={() => undefined} selected />)
    expect(markup).toContain('https://mcp.example.test')
    expect(markup).toContain('Authorization')
    expect(markup).not.toContain('Bearer')
    expect(markup).not.toContain('secret://')
  })

  it('renders tool policy and does not offer optimistic policy controls for removed tools', () => {
    const markup = renderToStaticMarkup(<McpToolPolicyTable tools={[tool, { ...tool, id: 'removed', remoteName: 'old', isRemoved: true }]} onToggle={() => undefined} onTest={() => undefined} />)
    expect(markup).toContain('search')
    expect(markup).toContain('high')
    expect(markup).toContain('Approval')
    expect(markup).toContain('Removed')
    expect(markup).not.toContain('secret://')
  })

  it('shows a safe disabled state when the server feature flag is closed', () => {
    useMcpServersStore.setState({ featureDisabled: true })
    const markup = renderToStaticMarkup(<McpServersPage />)
    expect(markup).toContain('MCP client is disabled')
    expect(markup).toContain('MCP_CLIENT_ENABLED=true')
    expect(markup).toContain('restart BloomAI')
    expect(markup).not.toContain('Add server')
    expect(markup).not.toContain('Test tool')
  })

  it('sanitizes approval details before they enter UI state', () => {
    expect(sanitizeMcpApprovalDetails({
      approvalRequestId: 'approval-1',
      runId: 'run-1',
      expiresAt: 123,
      safePreview: { toolId: tool.id, safeInput: { query: 'hello' }, approvalToken: 'never-store' },
      approvalToken: 'never-store',
    })).toEqual({
      approvalRequestId: 'approval-1',
      runId: 'run-1',
      expiresAt: 123,
      safePreview: { toolId: tool.id, safeInput: { query: 'hello' } },
    })
  })
})
