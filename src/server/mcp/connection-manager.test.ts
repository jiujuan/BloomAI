import { describe, expect, it, vi } from 'vitest'
import { McpError } from './errors'
import type { McpProviderAdapter, McpProviderConnection } from './provider'
import { McpConnectionManager } from './connection-manager'
import type { McpServerConnectionConfig } from './types'

function config(overrides: Partial<McpServerConnectionConfig> = {}): McpServerConnectionConfig {
  return {
    serverId: 'server-1',
    name: 'fixture',
    configVersion: 'v1',
    isEnabled: true,
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: ['fixture.mjs'],
    },
    ...overrides,
  }
}

const tools = [{
  serverId: 'server-1',
  serverName: 'fixture',
  localName: 'fixture_echo',
  remoteName: 'echo',
  toolId: 'mcp:server-1:echo',
}] as const

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createConnection(overrides: Partial<McpProviderConnection> = {}): McpProviderConnection & {
  disconnected: { value: boolean }
} {
  const disconnected = { value: false }
  return {
    disconnected,
    listTools: vi.fn().mockResolvedValue(tools),
    executeTool: vi.fn().mockImplementation(async (remoteName: string, input: unknown) => ({
      remoteName,
      input,
    })),
    disconnect: vi.fn().mockImplementation(async () => {
      disconnected.value = true
    }),
    ...overrides,
  }
}

describe('McpConnectionManager', () => {
  it('single-flights cached creation and discovery, reuses the cache, and cleans temporary connections', async () => {
    const connections: McpProviderConnection[] = []
    const adapter: McpProviderAdapter = {
      createConnection: vi.fn(async () => {
        const connection = createConnection()
        connections.push(connection)
        return connection
      }),
    }
    const manager = new McpConnectionManager({ adapter })

    const [firstTools, secondTools] = await Promise.all([
      manager.listTools(config()),
      manager.listTools(config()),
    ])
    expect(firstTools).toEqual(secondTools)
    expect(adapter.createConnection).toHaveBeenCalledOnce()
    expect((connections[0].listTools as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()

    await manager.listTools(config())
    await manager.executeTool(config(), 'echo', { value: 1 })
    expect((connections[0].listTools as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
    expect((connections[0].executeTool as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('echo', { value: 1 }, expect.any(AbortSignal))

    await manager.listTools(config(), { mode: 'temporary' })
    expect(adapter.createConnection).toHaveBeenCalledTimes(2)
    expect((connections[1].disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
    expect((connections[0].disconnect as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()

    await manager.disconnectAll()
    expect((connections[0].disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('invalidates old cached connections when configVersion, secretRefs, or transport changes', async () => {
    const connections: Array<McpProviderConnection & { disconnected: { value: boolean } }> = []
    const adapter: McpProviderAdapter = {
      createConnection: vi.fn(async () => {
        const connection = createConnection()
        connections.push(connection)
        return connection
      }),
    }
    const manager = new McpConnectionManager({ adapter })
    let currentConfig = config()
    let current = await manager.connect(currentConfig)

    for (const nextConfig of [
      config({ configVersion: 'v2' }),
      config({ configVersion: 'v2', secretRefs: ['MCP_TOKEN'] }),
      config({
        configVersion: 'v2',
        secretRefs: ['MCP_TOKEN'],
        transport: { kind: 'stdio', command: process.execPath, args: ['fixture-v2.mjs'] },
      }),
    ]) {
      const next = await manager.connect(nextConfig)
      await expect(current.executeTool('echo', {})).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
      currentConfig = nextConfig
      current = next
    }

    expect(currentConfig.transport).toMatchObject({ args: ['fixture-v2.mjs'] })
    expect(adapter.createConnection).toHaveBeenCalledTimes(4)
    for (const connection of connections.slice(0, -1)) {
      expect((connection.disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
    }
  })

  it('supports explicit reconnect and does not retry a timed-out operation on the old connection', async () => {
    const connections: Array<McpProviderConnection & { disconnected: { value: boolean } }> = []
    const adapter: McpProviderAdapter = {
      createConnection: vi.fn(async () => {
        const connection = connections.length === 0
          ? createConnection({
            executeTool: vi.fn((_remoteName: string, _input: unknown, signal?: AbortSignal) => (
              new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
              })
            )),
          })
          : createConnection()
        connections.push(connection)
        return connection
      }),
    }
    const manager = new McpConnectionManager({ adapter })

    await expect(manager.executeTool(config(), 'delay', {}, { timeoutMs: 20 }))
      .rejects.toMatchObject({ code: 'MCP_TOOL_TIMEOUT' })
    expect((connections[0].executeTool as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('delay', {}, expect.objectContaining({ aborted: true }))
    expect((connections[0].disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()

    await expect(manager.executeTool(config(), 'echo', {})).resolves.toEqual({
      remoteName: 'echo',
      input: {},
    })
    expect(adapter.createConnection).toHaveBeenCalledTimes(2)

    await manager.reconnect(config())
    expect(adapter.createConnection).toHaveBeenCalledTimes(3)
    expect((connections[1].disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
    await expect(manager.executeTool(config(), 'echo', { after: 'reconnect' })).resolves.toEqual({
      remoteName: 'echo',
      input: { after: 'reconnect' },
    })
  })

  it('aborts and invalidates on an external cancellation', async () => {
    const connection = createConnection({
      executeTool: vi.fn((_remoteName: string, _input: unknown, signal?: AbortSignal) => (
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      )),
    })
    const replacement = createConnection()
    let callCount = 0
    const adapter: McpProviderAdapter = {
      createConnection: vi.fn(async () => callCount++ === 0 ? connection : replacement),
    }
    const manager = new McpConnectionManager({ adapter })
    const controller = new AbortController()
    const execution = manager.executeTool(config(), 'delay', {}, { signal: controller.signal })
    controller.abort()

    await expect(execution).rejects.toMatchObject({ code: 'MCP_TOOL_CANCELLED' })
    expect((connection.disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
    await expect(manager.executeTool(config(), 'echo', {})).resolves.toMatchObject({ remoteName: 'echo' })
    expect(adapter.createConnection).toHaveBeenCalledTimes(2)
  })

  it('disconnectAll waits for pending creates and swallows create and disconnect failures', async () => {
    const pending = deferred<McpProviderConnection>()
    const connection = createConnection({
      disconnect: vi.fn().mockRejectedValue(new Error('secret should stay internal')),
    })
    const adapter: McpProviderAdapter = {
      createConnection: vi.fn(() => pending.promise),
    }
    const manager = new McpConnectionManager({ adapter })
    const connectPromise = manager.connect(config())
    const disconnectAll = manager.disconnectAll()

    let settled = false
    void disconnectAll.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    pending.resolve(connection)
    await expect(connectPromise).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
    await expect(disconnectAll).resolves.toBeUndefined()
    expect((connection.disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()

    const failedAdapter: McpProviderAdapter = {
      createConnection: vi.fn().mockRejectedValue(new Error('authorization=secret')),
    }
    const failedManager = new McpConnectionManager({ adapter: failedAdapter })
    await expect(failedManager.connect(config())).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' })
    await expect(failedManager.disconnectAll()).resolves.toBeUndefined()
  })

  it('maps invalid operation options to the stable configuration error', async () => {
    const manager = new McpConnectionManager({
      adapter: {
        createConnection: vi.fn(),
      },
    })
    await expect(manager.executeTool(config(), 'echo', {}, { timeoutMs: 0 }))
      .rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })
    expect((manager as unknown)).toBeDefined()
  })
})
