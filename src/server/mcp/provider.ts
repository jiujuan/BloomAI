import type {
  DiscoveredMcpTool,
  McpServerConnectionConfig,
} from './types'

/** Internal BloomAI boundary for a connected MCP provider. */
export interface McpProviderConnection {
  listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]>
  executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown>
  disconnect(): Promise<void>
}

/** Internal BloomAI boundary for creating provider connections. */
export interface McpProviderAdapter {
  createConnection(
    config: McpServerConnectionConfig,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection>
}

export type McpConnectionMode = 'cached' | 'temporary'

export type McpConnectOptions = {
  mode?: McpConnectionMode
  signal?: AbortSignal
}

export type McpExecuteOptions = McpConnectOptions & {
  timeoutMs?: number
}
