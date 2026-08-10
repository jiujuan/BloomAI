import { randomUUID } from 'node:crypto'
import { mcpRepo, type ConfirmMcpCatalogResult, type McpCatalogToolInput, type McpServerRecord, type McpToolListOptions } from '../db/repositories/mcp.repo'
import { McpError } from './errors'
import type { McpConnectionManager } from './connection-manager'
import type { McpProviderConnection } from './provider'
import {
  fingerprintMcpCatalogTool,
  hashMcpCatalog,
  hashMcpConfig,
  hashMcpToolSchema,
  normalizeCatalogDescription,
  normalizeCatalogSchema,
  normalizeCatalogToolName,
  sanitizeCatalogValue,
} from './catalog-hash'
import type {
  DiscoveredMcpTool,
  JsonSafeObject,
  JsonSafeValue,
  McpPreview,
  McpPreviewDiff,
  McpServerConnectionConfig,
  McpServerTool,
  McpTransportConfig,
} from './types'

export type McpCatalogRepository = {
  getServer(id: string): McpServerRecord | undefined
  listTools(serverId: string, options?: McpToolListOptions): McpServerTool[]
  confirmCatalog(input: {
    serverId: string
    expectedCatalogVersion: number
    tools: readonly McpCatalogToolInput[]
    removedRemoteNames?: readonly string[]
    now?: number
  }): ConfirmMcpCatalogResult
}

export type McpCatalogPreviewInput = {
  serverId: string
  signal?: AbortSignal
}

export type McpCatalogConfirmInput = {
  serverId: string
  previewId?: string
  previewHash: string
  configHash: string
  catalogVersion: string
}

export type McpToolCatalogServiceOptions = {
  connectionManager: Pick<McpConnectionManager, 'listTools'>
  repository?: McpCatalogRepository
  clock?: () => number
  previewTtlMs?: number
  idFactory?: () => string
}

type NormalizedCatalogTool = McpCatalogToolInput & {
  fingerprint: string
  snapshot: JsonSafeObject
}

type StoredPreview = {
  preview: McpPreview
  configHash: string
  catalogVersion: number
  tools: readonly NormalizedCatalogTool[]
  removedRemoteNames: readonly string[]
}

const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1_000

/**
 * Coordinates the explicit Refresh/Preview/Confirm lifecycle. Discovery is
 * always temporary and only Confirm delegates a catalog mutation to the
 * repository transaction.
 */
export class McpToolCatalogService {
  private readonly connectionManager: Pick<McpConnectionManager, 'listTools'>
  private readonly repository: McpCatalogRepository
  private readonly clock: () => number
  private readonly previewTtlMs: number
  private readonly idFactory: () => string
  private readonly previews = new Map<string, StoredPreview>()
  private readonly confirmed = new Map<string, ConfirmMcpCatalogResult>()

  constructor(options: McpToolCatalogServiceOptions) {
    this.connectionManager = options.connectionManager
    this.repository = options.repository ?? mcpRepo
    this.clock = options.clock ?? (() => Date.now())
    this.previewTtlMs = validatePositiveInteger(options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS, 'preview TTL')
    this.idFactory = options.idFactory ?? randomUUID
  }

  async preview(input: string | McpCatalogPreviewInput): Promise<McpPreview> {
    const { serverId, signal } = normalizePreviewInput(input)
    const server = this.repository.getServer(serverId)
    if (!server) throw new McpError('MCP_SERVER_NOT_FOUND')

    const createdAt = assertTimestamp(this.clock(), 'preview timestamp')
    const configHash = getServerConfigHash(server)
    const connectionConfig = toConnectionConfig(server, configHash)
    let discovered: DiscoveredMcpTool[]
    try {
      discovered = await this.connectionManager.listTools(connectionConfig, {
        mode: 'temporary',
        signal,
      })
    } catch (error) {
      if (error instanceof McpError) throw error
      throw new McpError('MCP_CONNECTION_FAILED', { cause: error })
    }
    if (!Array.isArray(discovered)) throw new McpError('MCP_PROTOCOL_ERROR')

    const tools = normalizeDiscoveredTools(server, discovered, createdAt)
    const existing = this.repository.listTools(serverId, { includeRemoved: true })
    const diff = buildDiff(serverId, existing, tools)
    const catalogVersion = String(server.catalogVersion)
    const previewHash = hashMcpCatalog({
      serverId,
      configHash,
      catalogVersion,
      tools,
    })
    const preview: McpPreview = {
      previewId: assertNonEmpty(this.idFactory(), 'preview id'),
      serverId,
      previewHash,
      configHash,
      catalogVersion,
      diff,
      createdAt,
      expiresAt: createdAt + this.previewTtlMs,
    }
    const stored: StoredPreview = {
      preview,
      configHash,
      catalogVersion: server.catalogVersion,
      tools,
      removedRemoteNames: diff
        .filter((entry) => entry.kind === 'removed')
        .map((entry) => entry.remoteName)
        .sort(),
    }
    this.previews.set(preview.previewId, stored)
    return preview
  }

  confirm(input: McpCatalogConfirmInput): ConfirmMcpCatalogResult {
    const normalized = normalizeConfirmInput(input)
    const server = this.repository.getServer(normalized.serverId)
    if (!server) throw new McpError('MCP_SERVER_NOT_FOUND')

    const idempotencyKey = createConfirmKey(normalized)
    const alreadyConfirmed = this.confirmed.get(idempotencyKey)
    if (alreadyConfirmed) return alreadyConfirmed

    const stored = findStoredPreview(this.previews, normalized)
    if (!stored || this.clock() >= stored.preview.expiresAt) {
      if (stored) this.previews.delete(stored.preview.previewId)
      throw new McpError('MCP_PREVIEW_STALE')
    }
    if (getServerConfigHash(server) !== stored.configHash
      || server.catalogVersion !== stored.catalogVersion
      || normalized.configHash !== stored.preview.configHash
      || normalized.previewHash !== stored.preview.previewHash
      || normalized.catalogVersion !== stored.preview.catalogVersion) {
      throw new McpError('MCP_PREVIEW_STALE')
    }

    const result = this.repository.confirmCatalog({
      serverId: normalized.serverId,
      expectedCatalogVersion: stored.catalogVersion,
      tools: stored.tools,
      removedRemoteNames: stored.removedRemoteNames,
      now: assertTimestamp(this.clock(), 'confirm timestamp'),
    })
    this.confirmed.set(idempotencyKey, result)
    this.previews.delete(stored.preview.previewId)
    return result
  }

  /** Useful for lifecycle shutdown and tests; no persisted data is affected. */
  clearPreviews(): void {
    this.previews.clear()
  }
}

export const createMcpToolCatalogService = (options: McpToolCatalogServiceOptions): McpToolCatalogService => (
  new McpToolCatalogService(options)
)

function normalizePreviewInput(input: string | McpCatalogPreviewInput): McpCatalogPreviewInput {
  if (typeof input === 'string') return { serverId: assertNonEmpty(input, 'server id') }
  if (!input || typeof input !== 'object') throw new McpError('MCP_CONFIG_INVALID')
  return {
    serverId: assertNonEmpty(input.serverId, 'server id'),
    signal: input.signal,
  }
}

function normalizeConfirmInput(input: McpCatalogConfirmInput): McpCatalogConfirmInput {
  if (!input || typeof input !== 'object') throw new McpError('MCP_CONFIG_INVALID')
  return {
    serverId: assertNonEmpty(input.serverId, 'server id'),
    ...(input.previewId === undefined ? {} : { previewId: assertNonEmpty(input.previewId, 'preview id') }),
    previewHash: assertNonEmpty(input.previewHash, 'preview hash'),
    configHash: assertNonEmpty(input.configHash, 'config hash'),
    catalogVersion: assertCatalogVersion(input.catalogVersion),
  }
}

function findStoredPreview(
  previews: Map<string, StoredPreview>,
  input: McpCatalogConfirmInput,
): StoredPreview | undefined {
  for (const stored of previews.values()) {
    if ((input.previewId === undefined || stored.preview.previewId === input.previewId)
      && stored.preview.serverId === input.serverId
      && stored.preview.previewHash === input.previewHash
      && stored.preview.configHash === input.configHash
      && stored.preview.catalogVersion === input.catalogVersion) {
      return stored
    }
  }
  return undefined
}

function getServerConfigHash(server: McpServerRecord): string {
  const config = parseJsonObject(server.configJson)
  return hashMcpConfig({
    serverId: server.id,
    name: server.name,
    transportKind: server.transportKind,
    config,
    secretRefs: server.secretRefs,
  })
}

function toConnectionConfig(server: McpServerRecord, configHash: string): McpServerConnectionConfig {
  const parsed = parseJsonObject(server.configJson)
  const transport = server.transportKind === 'stdio'
    ? toStdioTransport(parsed)
    : toHttpTransport(parsed)
  return {
    serverId: server.id,
    name: server.name,
    transport,
    configVersion: configHash,
    catalogVersion: String(server.catalogVersion),
    // Explicit Preview is a temporary discovery operation. It does not mutate
    // the persisted server enablement state, but the provider boundary still
    // requires an enabled connection config.
    isEnabled: true,
    trustLevel: server.trustLevel,
    secretRefs: server.secretRefs,
  }
}

function toStdioTransport(config: JsonSafeObject): McpTransportConfig {
  if (typeof config.command !== 'string' || !config.command.trim()) throw new McpError('MCP_CONFIG_INVALID')
  const args = config.args === undefined
    ? undefined
    : Array.isArray(config.args) && config.args.every((value) => typeof value === 'string')
      ? config.args
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  const env = config.env === undefined
    ? undefined
    : isStringRecord(config.env)
      ? config.env
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  if (config.cwd !== undefined && typeof config.cwd !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  return {
    kind: 'stdio',
    command: config.command,
    ...(args === undefined ? {} : { args }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    ...(env === undefined ? {} : { env }),
  }
}

function toHttpTransport(config: JsonSafeObject): McpTransportConfig {
  if (typeof config.url !== 'string' || !config.url.trim()) throw new McpError('MCP_CONFIG_INVALID')
  const headers = config.headers === undefined
    ? undefined
    : isStringRecord(config.headers)
      ? config.headers
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  return {
    kind: 'streamable_http',
    url: config.url,
    ...(headers === undefined ? {} : { headers }),
  }
}

function normalizeDiscoveredTools(
  server: McpServerRecord,
  discovered: readonly DiscoveredMcpTool[],
  timestamp: number,
): NormalizedCatalogTool[] {
  const names = new Set<string>()
  const normalized: NormalizedCatalogTool[] = []
  for (const remote of discovered) {
    const remoteName = assertNonEmpty(remote.remoteName, 'remote tool name')
    if (names.has(remoteName)) throw new McpError('MCP_PROTOCOL_ERROR')
    names.add(remoteName)

    const inputAnalysis = normalizeCatalogSchema(remote.inputSchema)
    const outputAnalysis = normalizeCatalogSchema(remote.outputSchema)
    const inputSchema = inputAnalysis.schema ?? {}
    const schemaSupported = remote.schemaSupported !== false
      && inputAnalysis.supported
      && outputAnalysis.supported
    const schemaErrorCode = schemaSupported ? undefined : 'MCP_SCHEMA_UNSUPPORTED' as const
    const outputSchema = outputAnalysis.schema
    const name = normalizeCatalogToolName(remote.name, remoteName)
    const description = normalizeCatalogDescription(remote.description)
    const schemaHash = hashMcpToolSchema(inputSchema, outputSchema)
    const candidate: McpCatalogToolInput = {
      id: `mcp:${server.id}:${remoteName}`,
      remoteName,
      name,
      description,
      inputSchema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      schemaHash,
      schemaSupported,
      ...(schemaErrorCode === undefined ? {} : { schemaErrorCode }),
      // These policy fields are derived here, never accepted from the remote.
      requiresApproval: true,
      riskLevel: 'medium',
      discoveredAt: timestamp,
      updatedAt: timestamp,
    }
    const snapshot = createToolSnapshot(candidate)
    normalized.push({
      ...candidate,
      fingerprint: fingerprintMcpCatalogTool(candidate),
      snapshot,
    })
  }
  return normalized.sort((left, right) => left.remoteName.localeCompare(right.remoteName))
}

function buildDiff(
  serverId: string,
  existing: readonly McpServerTool[],
  discovered: readonly NormalizedCatalogTool[],
): McpPreviewDiff[] {
  const existingByRemote = new Map(existing.map((tool) => [tool.remoteName, tool]))
  const discoveredByRemote = new Map(discovered.map((tool) => [tool.remoteName, tool]))
  const names = new Set([...existingByRemote.keys(), ...discoveredByRemote.keys()])
  return [...names].sort((left, right) => left.localeCompare(right)).map((remoteName) => {
    const before = existingByRemote.get(remoteName)
    const after = discoveredByRemote.get(remoteName)
    if (!before && after) {
      return {
        kind: 'added',
        remoteName,
        toolId: after.id,
        after: after.snapshot,
      }
    }
    if (before && !after) {
      return before.isRemoved
        ? {
            kind: 'unchanged',
            remoteName,
            toolId: before.id || `mcp:${serverId}:${remoteName}`,
            before: createToolSnapshot(before),
          }
        : {
            kind: 'removed',
            remoteName,
            toolId: before.id || `mcp:${serverId}:${remoteName}`,
            before: createToolSnapshot(before),
          }
    }
    if (!before || !after) throw new McpError('MCP_PROTOCOL_ERROR')
    const beforeSnapshot = createToolSnapshot(before)
    const isChanged = before.isRemoved || fingerprintMcpCatalogTool({
      remoteName: before.remoteName,
      name: before.name,
      description: before.description,
      inputSchema: before.inputSchema,
      outputSchema: before.outputSchema,
      schemaSupported: before.schemaSupported,
      schemaErrorCode: before.schemaErrorCode,
    }) !== after.fingerprint
    return {
      kind: isChanged ? 'changed' : 'unchanged',
      remoteName,
      toolId: after.id,
      before: beforeSnapshot,
      after: after.snapshot,
    }
  })
}

function createToolSnapshot(tool: McpCatalogToolInput | McpServerTool): JsonSafeObject {
  const inputAnalysis = normalizeCatalogSchema(tool.inputSchema)
  const outputAnalysis = normalizeCatalogSchema(tool.outputSchema)
  const schemaSupported = tool.schemaSupported !== false
    && inputAnalysis.supported
    && outputAnalysis.supported
  const snapshot: Record<string, JsonSafeValue> = {
    remoteName: tool.remoteName,
    name: normalizeCatalogToolName(tool.name, tool.remoteName),
    description: normalizeCatalogDescription(tool.description),
    inputSchema: sanitizeCatalogValue(inputAnalysis.schema ?? tool.inputSchema) ?? {},
    schemaHash: tool.schemaHash,
    schemaSupported,
  }
  if (tool.outputSchema !== undefined) {
    snapshot.outputSchema = sanitizeCatalogValue(outputAnalysis.schema ?? tool.outputSchema) ?? null
  }
  if (!schemaSupported || tool.schemaErrorCode !== undefined) {
    snapshot.schemaSupported = false
    snapshot.schemaErrorCode = 'MCP_SCHEMA_UNSUPPORTED'
  }
  return snapshot
}

function createConfirmKey(input: McpCatalogConfirmInput): string {
  return [input.serverId, input.previewId ?? '', input.previewHash, input.configHash, input.catalogVersion].join('\u001f')
}

function assertCatalogVersion(value: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new McpError('MCP_CONFIG_INVALID')
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric)) throw new McpError('MCP_CONFIG_INVALID')
  return String(numeric)
}

function parseJsonObject(value: string): JsonSafeObject {
  if (typeof value !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new McpError('MCP_CONFIG_INVALID', { cause: error })
  }
  if (!isJsonSafeObject(parsed)) throw new McpError('MCP_CONFIG_INVALID')
  return parsed
}

function isJsonSafeObject(value: unknown): value is JsonSafeObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
}

function isStringRecord(value: JsonSafeValue): value is JsonSafeObject & Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function assertNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpError('MCP_CONFIG_INVALID')
  return value
}
