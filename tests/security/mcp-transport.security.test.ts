import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createStdioSpawnOptions,
} from '../../src/server/mcp/transport-policy'
import { MastraMcpAdapter } from '../../src/server/mcp/mastra-adapter'
import { McpSecurityError } from '../../src/server/mcp/types'
import type { McpServerConnectionConfig } from '../../src/server/mcp/types'

function config(overrides: Partial<McpServerConnectionConfig> = {}): McpServerConnectionConfig {
  return {
    serverId: 'security-server',
    name: 'security-fixture',
    configVersion: 'config-v1',
    isEnabled: true,
    transport: {
      kind: 'streamable_http',
      url: 'https://public.example/mcp',
    },
    ...overrides,
  }
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function expectCode(error: unknown, code: string): void {
  expect(error).toMatchObject({ code, message: expect.stringContaining(`${code}:`) })
}

describe('MCP Task 10 transport security boundaries', () => {
  it('rejects a stdio cwd outside the explicitly allowed roots before spawning', () => {
    const outsideRoot = resolve(process.cwd(), '..')

    expect(() => createStdioSpawnOptions({
      kind: 'stdio',
      command: process.execPath,
      args: ['fixture.mjs'],
      cwd: outsideRoot,
    }, {
      allowedCwdRoots: [process.cwd()],
    })).toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('revalidates DNS on every HTTP request and blocks DNS rebinding', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }])
    const httpFetch = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      httpEnvironment: 'production',
      lookup,
      httpFetch,
    })
    const connection = await adapter.createConnection(config())

    await expect(connection.listTools()).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('rejects unsafe redirect targets and never follows redirects', async () => {
    const httpFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://169.254.169.254/latest/meta-data' },
    }))
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      httpEnvironment: 'production',
      lookup: publicLookup,
      httpFetch,
    })
    const connection = await adapter.createConnection(config())

    await expect(connection.listTools()).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed on Streamable HTTP protocol errors without legacy SSE fallback', async () => {
    const requests: Array<{ method: string; url: string }> = []
    const httpFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? 'GET',
        url: String(url),
      })
      return new Response(JSON.stringify({ error: 'streamable HTTP unavailable' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      httpEnvironment: 'development',
      httpFetch,
    })
    const connection = await adapter.createConnection(config({
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:9876/mcp',
      },
    }))

    await expect(connection.listTools()).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('POST')
  })
})
