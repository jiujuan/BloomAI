import { describe, expect, it, vi } from 'vitest'
import { McpToolAdapter } from './mcp-tool-adapter'
import type { McpCapabilityBroker } from './capability-broker'

const request = {
  serverId: 'server-1',
  toolId: 'mcp:server-1:echo',
  input: { query: 'hello' },
  sessionId: 'session-1',
  role: 'general',
} as const

describe('McpToolAdapter', () => {
  it('routes agent and manual test invocations through the same broker instance', async () => {
    const broker = {
      execute: vi.fn().mockResolvedValue({ status: 'success' }),
    } as unknown as Pick<McpCapabilityBroker, 'execute'>
    const adapter = new McpToolAdapter({ broker })

    await adapter.execute(request)
    await adapter.test(request)

    expect(broker.execute).toHaveBeenCalledTimes(2)
    expect(broker.execute).toHaveBeenNthCalledWith(1, { ...request, caller: 'agent' })
    expect(broker.execute).toHaveBeenNthCalledWith(2, { ...request, caller: 'manual_test' })
  })

  it('does not expose or invoke a connection manager directly', async () => {
    const broker = { execute: vi.fn().mockResolvedValue({ status: 'success' }) } as unknown as Pick<McpCapabilityBroker, 'execute'>
    const adapter = new McpToolAdapter({ broker })
    expect(adapter).not.toHaveProperty('connectionManager')
    await expect(adapter.execute(request)).resolves.toMatchObject({ status: 'success' })
  })
})
