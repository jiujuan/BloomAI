import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpError } from './errors'
import { MastraMcpAdapter, type MastraMcpClientLike, type MastraMcpClientOptions } from './mastra-adapter'
import type { McpServerConnectionConfig } from './types'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../')
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/mcp')
const stdioFixturePath = path.join(fixtureRoot, 'stdio-server.mjs')
const httpFixturePath = path.join(fixtureRoot, 'http-server.mjs')
const children: ChildProcess[] = []

function config(overrides: Partial<McpServerConnectionConfig> = {}): McpServerConnectionConfig {
  return {
    serverId: 'server-1',
    name: 'fixture',
    configVersion: 'config-v1',
    isEnabled: true,
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [stdioFixturePath],
      cwd: repoRoot,
    },
    ...overrides,
  }
}

function expectCode(error: unknown, code: string): void {
  expect(error).toMatchObject({
    code,
    message: expect.stringContaining(`${code}:`),
  })
}

async function waitForReady(child: ChildProcess): Promise<number> {
  if (!child.stdout) throw new Error('fixture stdout is unavailable')
  const readline = createInterface({ input: child.stdout })
  try {
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture did not become ready')), 5_000)
      const onExit = (code: number | null) => {
        clearTimeout(timer)
        reject(new Error(`fixture exited before ready: ${code ?? 'unknown'}`))
      }
      child.once('exit', onExit)
      readline.on('line', (line) => {
        const match = /^READY (\d+)$/.exec(line.trim())
        if (!match) return
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        resolve(Number(match[1]))
      })
    })
  } finally {
    readline.close()
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild))
})

describe('MastraMcpAdapter', () => {
  it('constructs the verified stdio definition, resolves secrets only in memory, and maps namespaced tools', async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      structuredContent: { ok: true },
      isError: false,
    })
    const fakeTools = {
      fixture_echo: {
        id: 'fixture_echo',
        description: 'echo',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        execute,
      },
      fixture_other: {
        id: 'attacker-controlled-id',
        description: 'other',
        inputSchema: { type: 'object' },
        execute,
      },
    }
    const client: MastraMcpClientLike = {
      listTools: vi.fn().mockResolvedValue(fakeTools),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    const clientFactory = vi.fn<[MastraMcpClientOptions], MastraMcpClientLike>(() => client)
    const adapter = new MastraMcpAdapter({
      env: {
        MCP_CLIENT_ENABLED: 'true',
        MCP_ALLOWED_ENV_NAMES: 'MCP_TOKEN',
        MCP_TOKEN: 'secret-token',
      },
      clientFactory,
    })

    const connection = await adapter.createConnection(config({
      transport: {
        kind: 'stdio',
        command: process.execPath,
        args: [stdioFixturePath, '--token', '${env:MCP_TOKEN}'],
        env: { FIXTURE_TOKEN: '${env:MCP_TOKEN}' },
        cwd: repoRoot,
      },
    }))

    expect(clientFactory).toHaveBeenCalledOnce()
    const clientOptions = clientFactory.mock.calls[0]?.[0]
    if (!clientOptions) throw new Error('client factory was not called')
    expect(clientOptions.servers.fixture).toMatchObject({
      command: process.execPath,
      args: [stdioFixturePath, '--token', 'secret-token'],
      cwd: repoRoot,
      env: { FIXTURE_TOKEN: 'secret-token' },
    })
    expect(clientOptions.servers.fixture).toMatchObject({ onToolError: 'return' })
    expect(clientOptions.servers.fixture).not.toMatchObject({ shell: true })

    const discovered = await connection.listTools()
    expect(discovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: 'server-1',
        serverName: 'fixture',
        localName: 'fixture_echo',
        remoteName: 'echo',
        toolId: 'mcp:server-1:echo',
        name: 'mcp:server-1:echo',
        schemaSupported: true,
        schemaHash: expect.any(String),
      }),
      expect.objectContaining({
        localName: 'fixture_other',
        remoteName: 'other',
        toolId: 'mcp:server-1:other',
      }),
    ]))

    const signal = new AbortController().signal
    await expect(connection.executeTool('echo', { text: 'hello' }, signal)).resolves.toEqual({
      content: [{ type: 'text', text: 'hello' }],
      structuredContent: { ok: true },
      isError: false,
      truncated: false,
    })
    expect(execute).toHaveBeenCalledWith({ text: 'hello' }, { abortSignal: signal })
    await connection.disconnect()
    await connection.disconnect()
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('maps in-band MCP errors to the normalized result without treating text as the error marker', async () => {
    const client: MastraMcpClientLike = {
      listTools: vi.fn().mockResolvedValue({
        fixture_error: {
          id: 'fixture_error',
          inputSchema: { type: 'object' },
          execute: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'remote error' }],
            isError: true,
          }),
        },
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      clientFactory: () => client,
    })
    const connection = await adapter.createConnection(config())

    await expect(connection.executeTool('error', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'remote error' }],
      isError: true,
      truncated: false,
    })
  })

  it('rejects tools outside the expected namespace and never uses the Mastra id as the remote name', async () => {
    const client: MastraMcpClientLike = {
      listTools: vi.fn().mockResolvedValue({
        wrong_echo: {
          id: 'fixture_echo',
          execute: vi.fn(),
        },
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      clientFactory: () => client,
    })
    const connection = await adapter.createConnection(config())

    await expect(connection.listTools()).rejects.toMatchObject({ code: 'MCP_PROTOCOL_ERROR' })
  })

  it('fails closed when the feature flag or explicit server enablement is missing', async () => {
    const clientFactory = vi.fn(() => ({
      listTools: vi.fn(),
      disconnect: vi.fn(),
    }))
    await expect(new MastraMcpAdapter({ clientFactory }).createConnection(config()))
      .rejects.toMatchObject({ code: 'MCP_DISABLED' })
    await expect(new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      clientFactory,
    }).createConnection(config({ isEnabled: undefined })))
      .rejects.toMatchObject({ code: 'MCP_SERVER_DISABLED' })
    expect(clientFactory).not.toHaveBeenCalled()
  })

  it('maps discovery, execution, protocol, cancellation, and disconnect failures to safe stable codes', async () => {
    const listTools = vi.fn().mockRejectedValue(new Error('https://secret.example/token'))
    const disconnect = vi.fn().mockRejectedValue(new Error('child secret / token'))
    const execute = vi.fn().mockRejectedValue(new Error('remote secret payload'))
    const client: MastraMcpClientLike = {
      listTools,
      disconnect,
    }
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      clientFactory: () => client,
    })
    const connection = await adapter.createConnection(config())

    await expect(connection.listTools()).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })

    client.listTools = vi.fn().mockResolvedValue({
      fixture_echo: { id: 'fixture_echo', execute },
    })
    await expect(connection.executeTool('echo', {})).rejects.toMatchObject({ code: 'MCP_TOOL_ERROR' })

    const aborted = new AbortController()
    aborted.abort()
    await expect(connection.executeTool('echo', {}, aborted.signal)).rejects.toMatchObject({ code: 'MCP_TOOL_CANCELLED' })

    await expect(connection.disconnect()).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
    await expect(connection.disconnect()).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
  })

  it('runs the real stdio fixture through the adapter', async () => {
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
    })
    const connection = await adapter.createConnection(config({
      transport: {
        kind: 'stdio',
        command: process.execPath,
        args: [stdioFixturePath],
        cwd: repoRoot,
      },
    }))
    const tools = await connection.listTools()
    expect(tools.map((tool) => tool.remoteName)).toEqual(expect.arrayContaining(['echo', 'structured', 'error', 'delay', 'large']))
    await expect(connection.executeTool('echo', { text: 'adapter' })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'echo:adapter' }],
      isError: false,
    })
    await connection.disconnect()
  })

  it('runs the real Streamable HTTP fixture through the adapter without credentials in the public result', async () => {
    const child = spawn(process.execPath, [httpFixturePath, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    children.push(child)
    const port = await waitForReady(child)

    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
      httpEnvironment: 'development',
    })
    const connection = await adapter.createConnection(config({
      transport: {
        kind: 'streamable_http',
        url: `http://127.0.0.1:${port}/mcp`,
      },
    }))
    const tools = await connection.listTools()
    expect(tools.map((tool) => tool.remoteName)).toEqual(expect.arrayContaining(['echo', 'structured']))
    const result = await connection.executeTool('structured', { value: 'http' })
    expect(result).toMatchObject({
      content: [],
      structuredContent: { value: 'http', length: 4 },
      isError: false,
    })
    expect(JSON.stringify(result)).not.toContain('Authorization')
    await connection.disconnect()
  })

  it('does not expose sensitive tool input through Mastra logging', async () => {
    const methods = ['debug', 'info', 'warn', 'error'] as const
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    const secretInput = 'task-10-secret-input'
    const approvalToken = 'approval-token-never-log'
    const adapter = new MastraMcpAdapter({
      env: { MCP_CLIENT_ENABLED: 'true' },
    })
    const connection = await adapter.createConnection(config())

    try {
      await connection.listTools()
      await connection.executeTool('echo', {
        text: secretInput,
        authorization: `Bearer ${approvalToken}`,
      })
    } finally {
      await connection.disconnect()
      for (const spy of spies) spy.mockRestore()
    }

    const logged = spies.flatMap((spy) => spy.mock.calls)
      .map((args) => JSON.stringify(args))
      .join('\n')
    expect(logged).not.toContain(secretInput)
    expect(logged).not.toContain(approvalToken)
    expect(logged).not.toContain('Bearer')
  })

})
