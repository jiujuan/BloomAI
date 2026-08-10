import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import {
  McpApiError,
  createMcpServer,
  listMcpServers,
  testMcpTool,
} from './mcp-servers.api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MCP renderer API boundary', () => {
  it('uses API_BASE and the /mcp path while sending only secret references', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id: 'server-1' } }), { status: 201 }))

    await createMcpServer({
      name: 'Local MCP',
      transportKind: 'stdio',
      config: {
        command: 'node',
        args: ['fixture.mjs'],
        env: { API_TOKEN: '${env:MCP_TOKEN}' },
      },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/mcp/servers`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-bloom-role': 'admin',
        }),
        body: JSON.stringify({
          name: 'Local MCP',
          transportKind: 'stdio',
          config: {
            command: 'node',
            args: ['fixture.mjs'],
            env: { API_TOKEN: '${env:MCP_TOKEN}' },
          },
        }),
      }),
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(JSON.stringify(body)).not.toContain('resolved-secret')
    expect(JSON.stringify(body)).not.toContain('Authorization: Bearer')
  })

  it('normalizes error envelopes and retains only safe details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: {
        code: 'MCP_APPROVAL_REQUIRED',
        message: 'MCP approval is required',
        details: {
          approvalRequestId: 'approval-1',
          runId: 'run-1',
          expiresAt: 123,
          safePreview: { toolId: 'tool-1', safeInput: { query: 'safe' }, approvalToken: 'must-not-be-kept' },
          approvalToken: 'must-not-be-kept',
        },
      },
    }), { status: 409 }))

    await expect(testMcpTool('server-1', 'tool-1', { query: 'safe' })).rejects.toMatchObject({
      code: 'MCP_APPROVAL_REQUIRED',
      status: 409,
      details: expect.objectContaining({ approvalRequestId: 'approval-1', runId: 'run-1' }),
    })
    try {
      await testMcpTool('server-1', 'tool-1', { query: 'safe' })
    } catch (error) {
      expect(error).toBeInstanceOf(McpApiError)
      expect(JSON.stringify((error as McpApiError).details)).not.toContain('approvalToken')
    }
  })

  it('lists servers through the same admin HTTP boundary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await listMcpServers()
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/mcp/servers`, expect.objectContaining({
      headers: expect.objectContaining({ 'x-bloom-role': 'admin' }),
    }))
  })
})
