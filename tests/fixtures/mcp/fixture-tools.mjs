import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export function createFixtureServer(name = 'bloomai-mcp-fixture') {
  const server = new McpServer({ name, version: '0.1.0' })

  server.registerTool(
    'echo',
    {
      description: 'Returns a text content block without structured output.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: `echo:${text}` }],
    }),
  )

  server.registerTool(
    'structured',
    {
      description: 'Returns structured content and a text preview.',
      inputSchema: { value: z.string() },
      outputSchema: { value: z.string(), length: z.number() },
    },
    async ({ value }) => ({
      content: [{ type: 'text', text: `structured:${value}` }],
      structuredContent: { value, length: value.length },
    }),
  )

  server.registerTool(
    'error',
    {
      description: 'Returns an in-band MCP tool error.',
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: message || 'fixture tool error' }],
      isError: true,
    }),
  )

  server.registerTool(
    'delay',
    {
      description: 'Waits for the requested number of milliseconds.',
      inputSchema: { ms: z.number().int().min(0).max(10_000) },
    },
    async ({ ms }, extra) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        if (extra.signal.aborted) {
          onAbort()
          return
        }
        extra.signal.addEventListener('abort', onAbort, { once: true })
      })
      return { content: [{ type: 'text', text: `delayed:${ms}` }] }
    },
  )

  server.registerTool(
    'large',
    {
      description: 'Returns a deterministic large text result.',
      inputSchema: { size: z.number().int().min(1).max(65_536) },
    },
    async ({ size }) => ({
      content: [{ type: 'text', text: 'x'.repeat(size) }],
    }),
  )

  return server
}
