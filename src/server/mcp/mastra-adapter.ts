import { createHash, randomUUID } from 'node:crypto'
import { MCPClient, type MastraMCPServerDefinition } from '@mastra/mcp'
import { normalizeMcpResult } from './result-normalizer'
import { analyzeMcpSchema } from './schema-support'
import { assertMcpClientEnabled, type EnvironmentLike } from './feature-flag'
import { createSecretResolver, resolveSecretReferences, type SecretResolver } from './secret-resolver'
import {
  createHttpRequestOptions,
  createStdioSpawnOptions,
  type DnsLookup,
  type McpHttpEnvironment,
} from './transport-policy'
import { McpError } from './errors'
import {
  createMcpToolId,
  McpSecurityError,
  type DiscoveredMcpTool,
  type JsonSafeValue,
  type McpServerConnectionConfig,
  type McpTransportConfig,
} from './types'
import type { McpProviderAdapter, McpProviderConnection } from './provider'

export type MastraMcpToolContext = {
  abortSignal?: AbortSignal
}

export type MastraMcpToolLike = {
  id?: unknown
  description?: unknown
  inputSchema?: unknown
  outputSchema?: unknown
  execute: (input: unknown, context?: MastraMcpToolContext) => Promise<unknown>
}

export interface MastraMcpClientLike {
  listTools(): Promise<Record<string, MastraMcpToolLike>>
  disconnect(): Promise<void>
}

export type MastraMcpClientOptions = {
  id: string
  servers: Record<string, MastraMCPServerDefinition>
  timeout?: number
}

export type MastraMcpClientFactory = (options: MastraMcpClientOptions) => MastraMcpClientLike

export type MastraMcpAdapterOptions = {
  env?: EnvironmentLike
  secretResolver?: SecretResolver
  httpEnvironment?: McpHttpEnvironment
  lookup?: DnsLookup
  timeoutMs?: number
  clientFactory?: MastraMcpClientFactory
}

/**
 * Mastra-specific implementation of the BloomAI MCP provider boundary.
 *
 * This is deliberately the only production module in the MCP layer that imports
 * `@mastra/mcp`. Callers receive BloomAI discovery records and normalized safe
 * results, never Mastra Tool objects.
 */
export class MastraMcpAdapter implements McpProviderAdapter {
  private readonly env: EnvironmentLike
  private readonly secretResolver: SecretResolver
  private readonly httpEnvironment?: McpHttpEnvironment
  private readonly lookup?: DnsLookup
  private readonly timeoutMs?: number
  private readonly clientFactory: MastraMcpClientFactory

  constructor(options: MastraMcpAdapterOptions = {}) {
    this.env = options.env ?? process.env
    this.secretResolver = options.secretResolver ?? createSecretResolver({ env: this.env })
    this.httpEnvironment = options.httpEnvironment
    this.lookup = options.lookup
    this.timeoutMs = validateTimeout(options.timeoutMs)
    this.clientFactory = options.clientFactory ?? ((clientOptions) => (
      new MCPClient(clientOptions) as unknown as MastraMcpClientLike
    ))
  }

  async createConnection(
    config: McpServerConnectionConfig,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection> {
    assertMcpClientEnabled(this.env)
    if (config?.isEnabled !== true) throw new McpError('MCP_SERVER_DISABLED')
    assertValidConnectionConfig(config)
    throwIfAborted(signal)

    try {
      const serverName = config.name
      const definition = await this.toMastraServerDefinition(config.transport)
      throwIfAborted(signal)
      const client = this.clientFactory({
        id: `bloomai-mcp-${randomUUID()}`,
        servers: { [serverName]: definition },
        ...(this.timeoutMs === undefined ? {} : { timeout: this.timeoutMs }),
      })
      return new MastraMcpConnection({
        client,
        serverId: config.serverId,
        serverName,
      })
    } catch (error) {
      if (error instanceof McpSecurityError || error instanceof McpError) throw error
      if (signal?.aborted || isAbortLike(error)) throw new McpError('MCP_TOOL_CANCELLED')
      throw new McpError('MCP_CONNECTION_FAILED')
    }
  }

  private async toMastraServerDefinition(transport: McpTransportConfig): Promise<MastraMCPServerDefinition> {
    if (transport.kind === 'stdio') {
      const spawnOptions = createStdioSpawnOptions(transport, {
        processEnv: this.env,
        secretResolver: this.secretResolver,
      })
      const args = resolveSecretReferences(spawnOptions.args, this.secretResolver)
      // Mastra's public definition does not expose shell, but the validated
      // spawn policy is retained on the definition for the downstream transport
      // boundary and explicitly remains false.
      return {
        command: spawnOptions.command,
        args,
        env: spawnOptions.options.env,
        ...(spawnOptions.options.cwd === undefined ? {} : { cwd: spawnOptions.options.cwd }),
        stderr: 'pipe',
        shell: false,
        onToolError: 'return',
      } as unknown as MastraMCPServerDefinition
    }

    const request = await createHttpRequestOptions(transport, {
      environment: this.httpEnvironment,
      lookup: this.lookup,
      secretResolver: this.secretResolver,
    })
    return {
      url: request.url,
      requestInit: {
        headers: request.headers,
        redirect: request.redirect,
      },
      onToolError: 'return',
    }
  }
}

/** Backwards-compatible descriptive alias for the provider adapter. */
export const MastraMcpProviderAdapter = MastraMcpAdapter
export const createMastraMcpAdapter = (options: MastraMcpAdapterOptions = {}): MastraMcpAdapter => (
  new MastraMcpAdapter(options)
)

class MastraMcpConnection implements McpProviderConnection {
  private readonly client: MastraMcpClientLike
  private readonly serverId: string
  private readonly serverName: string
  private readonly toolsByRemoteName = new Map<string, MastraMcpToolLike>()
  private disconnected = false
  private disconnectPromise?: Promise<void>
  private discoveryPromise?: Promise<DiscoveredMcpTool[]>

  constructor(options: {
    client: MastraMcpClientLike
    serverId: string
    serverName: string
  }) {
    this.client = options.client
    this.serverId = options.serverId
    this.serverName = options.serverName
  }

  async listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]> {
    this.assertUsable()
    throwIfAborted(signal)
    if (this.discoveryPromise) return this.awaitDiscovery(this.discoveryPromise, signal)

    const promise = this.discoverTools()
    this.discoveryPromise = promise
    try {
      return await this.awaitDiscovery(promise, signal)
    } finally {
      if (this.discoveryPromise === promise) this.discoveryPromise = undefined
    }
  }

  async executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    this.assertUsable()
    throwIfAborted(signal)
    if (typeof remoteName !== 'string' || remoteName.length === 0) {
      throw new McpError('MCP_TOOL_NOT_FOUND')
    }

    let tool = this.toolsByRemoteName.get(remoteName)
    if (!tool) {
      await this.listTools(signal)
      tool = this.toolsByRemoteName.get(remoteName)
    }
    if (!tool) throw new McpError('MCP_TOOL_NOT_FOUND')

    try {
      const rawResult = await tool.execute(input, { abortSignal: signal })
      if (signal?.aborted) throw new McpError('MCP_TOOL_CANCELLED')
      return normalizeMastraToolResult(rawResult)
    } catch (error) {
      if (error instanceof McpError) throw error
      if (signal?.aborted || isAbortLike(error)) throw new McpError('MCP_TOOL_CANCELLED')
      throw new McpError('MCP_TOOL_ERROR')
    }
  }

  disconnect(): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise
    this.disconnected = true
    this.toolsByRemoteName.clear()
    this.disconnectPromise = this.client.disconnect().catch((error) => {
      if (error instanceof McpError || error instanceof McpSecurityError) throw error
      throw new McpError('MCP_CONNECTION_FAILED')
    })
    return this.disconnectPromise
  }

  private async discoverTools(): Promise<DiscoveredMcpTool[]> {
    let rawTools: Record<string, MastraMcpToolLike>
    try {
      rawTools = await this.client.listTools()
    } catch (error) {
      if (error instanceof McpError || error instanceof McpSecurityError) throw error
      throw new McpError('MCP_CONNECTION_FAILED')
    }

    if (!isRecord(rawTools)) throw new McpError('MCP_PROTOCOL_ERROR')
    const prefix = `${this.serverName}_`
    const discovered: DiscoveredMcpTool[] = []
    const nextTools = new Map<string, MastraMcpToolLike>()

    try {
      for (const [localName, tool] of Object.entries(rawTools)) {
        if (!localName.startsWith(prefix) || localName.length === prefix.length || !isRecord(tool)) {
          throw new McpError('MCP_PROTOCOL_ERROR')
        }
        if (typeof tool.execute !== 'function') throw new McpError('MCP_PROTOCOL_ERROR')
        const remoteName = localName.slice(prefix.length)
        const toolId = createMcpToolId(this.serverId, remoteName)
        const schemas = await mapToolSchemas(tool)
        const description = typeof tool.description === 'string' ? tool.description : undefined
        discovered.push({
          serverId: this.serverId,
          serverName: this.serverName,
          localName,
          remoteName,
          toolId,
          name: toolId,
          ...(description === undefined ? {} : { description }),
          ...(schemas.inputSchema === undefined ? {} : { inputSchema: schemas.inputSchema }),
          ...(schemas.outputSchema === undefined ? {} : { outputSchema: schemas.outputSchema }),
          ...(schemas.schemaHash === undefined ? {} : { schemaHash: schemas.schemaHash }),
          ...(schemas.schemaSupported === undefined ? {} : { schemaSupported: schemas.schemaSupported }),
          ...(schemas.schemaErrorCode === undefined ? {} : { schemaErrorCode: schemas.schemaErrorCode }),
        })
        nextTools.set(remoteName, tool)
      }
    } catch (error) {
      if (error instanceof McpError || error instanceof McpSecurityError) throw error
      throw new McpError('MCP_PROTOCOL_ERROR')
    }

    this.toolsByRemoteName.clear()
    for (const [remoteName, tool] of nextTools) this.toolsByRemoteName.set(remoteName, tool)
    return discovered
  }

  private async awaitDiscovery(
    promise: Promise<DiscoveredMcpTool[]>,
    signal?: AbortSignal,
  ): Promise<DiscoveredMcpTool[]> {
    if (!signal) return promise
    return awaitWithAbort(promise, signal)
  }

  private assertUsable(): void {
    if (this.disconnected) throw new McpError('MCP_CONNECTION_FAILED')
  }
}

function normalizeMastraToolResult(rawResult: unknown) {
  if (isRecord(rawResult) && Array.isArray(rawResult.content)) {
    return normalizeMcpResult(rawResult)
  }
  if (rawResult === undefined) return normalizeMcpResult({ content: [] })
  return normalizeMcpResult({ content: [], structuredContent: rawResult })
}

type MappedSchemas = {
  inputSchema?: JsonSafeValue
  outputSchema?: JsonSafeValue
  schemaHash?: string
  schemaSupported?: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
}

async function mapToolSchemas(tool: MastraMcpToolLike): Promise<MappedSchemas> {
  const input = await materializeSchema(tool.inputSchema, 'input')
  const output = await materializeSchema(tool.outputSchema, 'output')
  const inputAnalysis = input === undefined ? undefined : analyzeMcpSchema(input)
  const outputAnalysis = output === undefined ? undefined : analyzeMcpSchema(output)
  const supported = (inputAnalysis?.supported ?? true) && (outputAnalysis?.supported ?? true)
  const schemaErrorCode = supported ? undefined : 'MCP_SCHEMA_UNSUPPORTED' as const
  const inputSchema = inputAnalysis?.supported ? inputAnalysis.normalizedSchema : safeJsonValue(input)
  const outputSchema = outputAnalysis?.supported ? outputAnalysis.normalizedSchema : safeJsonValue(output)
  const schemaHash = supported && (inputAnalysis || outputAnalysis)
    ? hashSchemaPair(inputAnalysis?.normalizedSchema, outputAnalysis?.normalizedSchema)
    : undefined
  return {
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(schemaHash === undefined ? {} : { schemaHash }),
    schemaSupported: supported,
    ...(schemaErrorCode === undefined ? {} : { schemaErrorCode }),
  }
}

async function materializeSchema(schema: unknown, direction: 'input' | 'output'): Promise<unknown> {
  if (schema === undefined) return undefined
  if (!isRecord(schema)) return schema
  const standard = schema['~standard']
  if (isRecord(standard) && isRecord(standard.jsonSchema)) {
    const converter = standard.jsonSchema[direction]
    if (typeof converter === 'function') {
      try {
        return await converter({ target: 'draft-07' })
      } catch {
        return schema
      }
    }
  }
  return schema
}

function safeJsonValue(value: unknown): JsonSafeValue | undefined {
  if (value === undefined) return undefined
  try {
    return normalizeMcpResult({ content: [value] }).content[0]
  } catch {
    return undefined
  }
}

function hashSchemaPair(input: unknown, output: unknown): string {
  const canonical = canonicalJson({ input: input ?? null, output: output ?? null })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
  )).join(',')}}`
}

function assertValidConnectionConfig(config: McpServerConnectionConfig): void {
  if (!config || typeof config !== 'object'
    || typeof config.serverId !== 'string' || !config.serverId.trim()
    || typeof config.name !== 'string' || !config.name.trim()
    || typeof config.configVersion !== 'string' || !config.configVersion.trim()
    || !config.transport || typeof config.transport !== 'object') {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (/^[\u0000-\u001f\u007f]/.test(config.name) || config.name.includes('\u0000')) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
}

function validateTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value <= 0) throw new McpSecurityError('MCP_CONFIG_INVALID')
  return value
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new McpError('MCP_TOOL_CANCELLED')
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || isRecord(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR')
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(new McpError('MCP_TOOL_CANCELLED'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      void promise.catch(() => undefined)
      reject(new McpError('MCP_TOOL_CANCELLED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
