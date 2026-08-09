import { describe, expect, it } from 'vitest'
import { runMcpSpike } from '../../../scripts/mcp-spike'

describe('Mastra MCP adapter contract spike', () => {
  it('discovers and executes the real stdio and Streamable HTTP fixtures', async () => {
    const report = await runMcpSpike()

    expect(report.package.mastraMcp).toBe('1.15.1')
    expect(report.package.mastraCore).toBe('1.51.0')
    expect(report.package.mcpSdk).toBe('1.30.0')
    expect(report.package.peerDependency).toBe('>=1.0.0-0 <2.0.0-0')
    expect(report.package.nodeEngine).toBe('>=22.13.0')
    expect(report.api.lifecycle).toEqual(['listTools', 'disconnect', 'reconnectServer'])

    for (const transport of [report.stdio, report.http]) {
      const echoToolName = transport.toolNames.find((name) => name.endsWith('_echo'))
      expect(echoToolName).toBeDefined()
      expect(transport.toolIds.echo).toBe(echoToolName)
      expect(transport.mappedRemoteNames).toEqual(expect.arrayContaining(['echo', 'structured', 'error', 'delay', 'large']))
      expect(transport.hasInputSchema.echo).toBe(true)
      expect(transport.hasOutputSchema.structured).toBe(true)
      expect(transport.largeResultLength).toBe(4096)
      expect(transport.errorResult).toMatchObject({ isError: true })
      expect(transport.abortElapsedMs).toBeLessThan(1_500)
      expect(transport.timeoutElapsedMs).toBeLessThan(1_500)
      expect(transport.recoveredAfterTimeout).toBeDefined()
      expect(transport.recoveredAfterReconnect).toBeDefined()
    }

    expect(report.http.sseFallbackDetected).toBe(false)
    expect(report.http.sseFallbackLogMessages).toEqual([])
    expect(report.http.trace.length).toBeGreaterThan(0)
    expect(report.adapterContract.methods).toEqual([
      'listTools(signal?)',
      'executeTool(remoteName, input, signal?)',
      'disconnect()',
    ])
  }, 30_000)
})
