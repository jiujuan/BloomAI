import { mcpRepo, type McpServerRecord, type McpToolRecord, type McpRunRecord } from '../db/repositories/mcp.repo'
import { mcpCapabilityBroker, mcpConnectionManager } from './composition-root'
import { McpCapabilityBroker, type McpBrokerSuccess, type McpBrokerDenied } from './capability-broker'
import { McpConnectionManager } from './connection-manager'
import { getMcpErrorCode, McpError } from './errors'
import { isMcpClientEnabled, type EnvironmentLike } from './feature-flag'
import { hashMcpConfig, sanitizeCatalogValue } from './catalog-hash'
import { McpToolCatalogService, type McpCatalogConfirmInput } from './tool-catalog'
import { parseAllowedEnvironmentNames, parseSecretReference } from './secret-resolver'
import { hashMcpTransportConfig, validateStdioTransport } from './transport-policy'
import { MCP_RESULT_REDACTED_VALUE, isJsonSafeValue, normalizeMcpResult } from './result-normalizer'
import type {
  DiscoveredMcpTool,
  JsonSafeObject,
  JsonSafeValue,
  McpApprovalRequest,
  McpPreview,
  McpServerConnectionConfig,
  McpToolRun,
  McpTransportConfig,
  McpTransportKind,
  McpTrustLevel,
  NormalizedMcpResult,
} from './types'

export type { McpServerRecord, McpToolRecord, McpRunRecord }

export type McpServiceRepository = Pick<
  typeof mcpRepo,
  | 'listServers'
  | 'getServer'
  | 'createServer'
  | 'updateServer'
  | 'setServerEnabled'
  | 'setServerTrust'
  | 'deleteServer'
  | 'getTool'
  | 'listTools'
  | 'setToolEnabled'
  | 'confirmCatalog'
  | 'listRuns'
>

export type McpServiceConnectionManager = Pick<McpConnectionManager, 'listTools'>
export type McpServiceCatalog = Pick<McpToolCatalogService, 'preview' | 'confirm' | 'clearPreviews'>
export type McpServiceBroker = Pick<McpCapabilityBroker, 'execute' | 'approve' | 'deny' | 'getApprovalRequest'>

export type McpServerCreateInput = {
  id?: unknown
  name: unknown
  transportKind: unknown
  config: unknown
}

export type McpServerUpdateInput = {
  name?: unknown
  transportKind?: unknown
  config?: unknown
}

export type McpToolUpdateInput = {
  enabled?: unknown
  isEnabled?: unknown
}

export type McpToolTestOptions = {
  sessionId: string
  role?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export type McpApprovalOptions = Pick<McpToolTestOptions, 'signal' | 'timeoutMs'>

export type McpRunQueryOptions = {
  toolId?: string
  status?: McpRunRecord['status']
  limit?: number
}

export type SafeMcpTransport =
  | {
      kind: 'stdio'
      command: string
      args: readonly string[]
      cwd?: string
      envNames: readonly string[]
    }
  | {
      kind: 'streamable_http'
      url: string
      origin: string
      headers: readonly string[]
    }

export type SafeMcpServer = {
  id: string
  name: string
  transport: SafeMcpTransport
  connectionStatus: McpServerRecord['connectionStatus']
  isEnabled: boolean
  trustLevel: McpServerRecord['trustLevel']
  catalogVersion: number
  lastErrorCode: McpServerRecord['lastErrorCode']
  lastErrorAt: number | null
  createdAt: number
  updatedAt: number
}

export type SafeMcpTool = {
  id: string
  serverId: string
  remoteName: string
  name: string
  description: string
  inputSchema: JsonSafeValue
  outputSchema?: JsonSafeValue
  schemaHash: string
  schemaSupported: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
  isEnabled: boolean
  isRemoved: boolean
  requiresApproval: boolean
  riskLevel: McpToolRecord['riskLevel']
  discoveredAt: number
  updatedAt: number
  removedAt: number | null
}

export type SafeMcpRun = {
  id: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId?: string | null
  agentRole?: string | null
  status: McpToolRun['status']
  inputHash: string
  safeInput: JsonSafeValue | null
  safeOutput: McpToolRun['safeOutput'] | null
  errorCode?: McpToolRun['errorCode']
  durationMs?: number | null
  createdAt: number
  completedAt?: number | null
}

export type SafeMcpPreview = {
  previewId: string
  serverId: string
  previewHash: string
  configHash: string
  catalogVersion: string
  diff: readonly {
    kind: McpPreview['diff'][number]['kind']
    remoteName: string
    toolId?: string
    before?: JsonSafeValue
    after?: JsonSafeValue
  }[]
  createdAt: number
  expiresAt: number
}

export type McpServiceOptions = {
  repository?: McpServiceRepository
  connectionManager?: McpServiceConnectionManager
  catalog?: McpServiceCatalog
  broker?: McpServiceBroker
  env?: EnvironmentLike
  clock?: () => number
}

/**
 * The application-facing MCP management facade. Routes call this class rather
 * than the repository, provider adapter, or broker directly so that feature
 * flags, server-derived policy, config validation, and safe DTO boundaries are
 * enforced consistently for every HTTP operation.
 */
export class McpService {
  private readonly repository: McpServiceRepository
  private readonly connectionManager: McpServiceConnectionManager
  private readonly catalog: McpServiceCatalog
  private readonly broker: McpServiceBroker
  private readonly env: EnvironmentLike
  private readonly clock: () => number

  constructor(options: McpServiceOptions = {}) {
    this.repository = options.repository ?? mcpRepo
    this.connectionManager = options.connectionManager ?? mcpConnectionManager
    this.catalog = options.catalog ?? new McpToolCatalogService({
      connectionManager: this.connectionManager,
      repository: this.repository,
    })
    this.broker = options.broker ?? mcpCapabilityBroker
    this.env = options.env ?? process.env
    this.clock = options.clock ?? (() => Date.now())
  }

  listServers(): McpServerRecord[] {
    this.assertEnabled()
    return this.repository.listServers()
  }

  getServer(serverId: string): McpServerRecord {
    this.assertEnabled()
    return this.requireServer(serverId)
  }

  createServer(input: McpServerCreateInput): McpServerRecord {
    this.assertEnabled()
    const id = optionalNonEmpty(input.id)
    const name = nonEmpty(input.name)
    const transportKind = normalizeTransportKind(input.transportKind)
    const normalized = normalizeServerConfig(transportKind, input.config, this.env)
    return this.repository.createServer({
      ...(id === undefined ? {} : { id }),
      name,
      transportKind,
      configJson: JSON.stringify(normalized.config),
      secretRefs: normalized.secretRefs,
      // Client-provided trust and enablement are intentionally not accepted.
      isEnabled: false,
      trustLevel: 'untrusted',
      connectionStatus: 'unknown',
      catalogVersion: 0,
      lastErrorCode: null,
      lastErrorAt: null,
      createdAt: this.clock(),
      updatedAt: this.clock(),
    })
  }

  updateServer(serverId: string, input: McpServerUpdateInput): McpServerRecord {
    this.assertEnabled()
    const current = this.requireServer(serverId)
    if (!input || typeof input !== 'object') throw new McpError('MCP_CONFIG_INVALID')

    const name = input.name === undefined ? current.name : nonEmpty(input.name)
    const transportKind = input.transportKind === undefined
      ? current.transportKind
      : normalizeTransportKind(input.transportKind)
    const configChanged = input.config !== undefined
    const transportChanged = transportKind !== current.transportKind
    const nameChanged = name !== current.name
    const securityReset = configChanged || transportChanged || nameChanged

    let configJson: string | undefined
    let secretRefs: readonly string[] | undefined
    if (configChanged || transportChanged) {
      const normalized = normalizeServerConfig(
        transportKind,
        configChanged ? input.config : parseStoredConfig(current.configJson),
        this.env,
      )
      configJson = JSON.stringify(normalized.config)
      secretRefs = normalized.secretRefs
    }

    if (!securityReset && name === current.name && transportKind === current.transportKind && !configChanged) {
      return current
    }

    this.catalog.clearPreviews()
    return this.repository.updateServer(serverId, {
      ...(nameChanged ? { name } : {}),
      ...(transportChanged ? { transportKind } : {}),
      ...(configJson === undefined ? {} : { configJson }),
      ...(secretRefs === undefined ? {} : { secretRefs }),
      ...(securityReset
        ? {
            isEnabled: false,
            trustLevel: 'untrusted' as const,
            connectionStatus: 'unknown' as const,
            lastErrorCode: null,
            lastErrorAt: null,
          }
        : {}),
      updatedAt: this.clock(),
    })
  }

  deleteServer(serverId: string): { deleted: true } {
    this.assertEnabled()
    this.requireServer(serverId)
    this.catalog.clearPreviews()
    this.repository.deleteServer(serverId)
    return { deleted: true }
  }

  async testConnection(serverId: string, signal?: AbortSignal): Promise<{
    server: McpServerRecord
    tools: readonly DiscoveredMcpTool[]
  }> {
    this.assertEnabled()
    const server = this.requireServer(serverId)
    let config: McpServerConnectionConfig
    try {
      config = createConnectionConfig(server, this.env, true)
    } catch (error) {
      const mapped = mapMcpFailure(error, 'MCP_CONFIG_INVALID')
      this.markConnectionError(server, mapped)
      throw mapped
    }

    try {
      const tools = await this.connectionManager.listTools(config, { mode: 'temporary', signal })
      if (!Array.isArray(tools)) throw new McpError('MCP_PROTOCOL_ERROR')
      const updated = this.repository.updateServer(server.id, {
        connectionStatus: 'healthy',
        lastErrorCode: null,
        lastErrorAt: null,
        updatedAt: this.clock(),
      })
      return { server: updated, tools: tools.map(toSafeDiscoveredTool) }
    } catch (error) {
      const mapped = mapMcpFailure(error, 'MCP_CONNECTION_FAILED')
      this.markConnectionError(server, mapped)
      throw mapped
    }
  }

  async previewTools(serverId: string, signal?: AbortSignal): Promise<McpPreview> {
    this.assertEnabled()
    this.requireServer(serverId)
    try {
      const preview = await this.catalog.preview({ serverId, signal })
      return toSafePreview(preview)
    } catch (error) {
      const mapped = mapMcpFailure(error, 'MCP_CONNECTION_FAILED')
      if (mapped.code !== 'MCP_PREVIEW_STALE') this.markConnectionError(this.requireServer(serverId), mapped)
      throw mapped
    }
  }

  confirmTools(input: McpCatalogConfirmInput): { server: McpServerRecord; tools: McpToolRecord[] } {
    this.assertEnabled()
    const serverId = nonEmpty(input?.serverId)
    this.requireServer(serverId)
    try {
      const result = this.catalog.confirm({
        serverId,
        ...(input.previewId === undefined ? {} : { previewId: input.previewId }),
        previewHash: input.previewHash,
        configHash: input.configHash,
        catalogVersion: input.catalogVersion,
      })
      return {
        server: result.server,
        tools: result.tools,
      }
    } catch (error) {
      throw mapMcpFailure(error, 'MCP_PREVIEW_STALE')
    }
  }

  enableServer(serverId: string): McpServerRecord {
    this.assertEnabled()
    this.requireServer(serverId)
    return this.repository.setServerEnabled(serverId, true)
  }

  disableServer(serverId: string): McpServerRecord {
    this.assertEnabled()
    this.requireServer(serverId)
    return this.repository.setServerEnabled(serverId, false)
  }

  trustServer(serverId: string, trustLevel: unknown): McpServerRecord {
    this.assertEnabled()
    this.requireServer(serverId)
    if (trustLevel !== 'untrusted' && trustLevel !== 'reviewed' && trustLevel !== 'trusted') {
      throw new McpError('MCP_CONFIG_INVALID')
    }
    return this.repository.setServerTrust(serverId, trustLevel)
  }

  listTools(serverId: string, options: { includeRemoved?: boolean } = {}): McpToolRecord[] {
    this.assertEnabled()
    this.requireServer(serverId)
    return this.repository.listTools(serverId, options).map(toSafeToolRecord)
  }

  updateTool(serverId: string, toolId: string, input: McpToolUpdateInput): McpToolRecord {
    this.assertEnabled()
    this.requireTool(serverId, toolId)
    if (!input || typeof input !== 'object') throw new McpError('MCP_CONFIG_INVALID')
    const hasEnabled = Object.prototype.hasOwnProperty.call(input, 'enabled')
    const hasIsEnabled = Object.prototype.hasOwnProperty.call(input, 'isEnabled')
    if (!hasEnabled && !hasIsEnabled) return toSafeToolRecord(this.repository.getTool(toolId)!)
    const enabled = hasEnabled ? input.enabled : input.isEnabled
    if (typeof enabled !== 'boolean') throw new McpError('MCP_CONFIG_INVALID')
    // riskLevel/requiresApproval are deliberately ignored: both are server
    // derived catalog policy and cannot be overridden by an HTTP client.
    return toSafeToolRecord(this.repository.setToolEnabled(toolId, enabled))
  }

  async testTool(
    serverId: string,
    toolId: string,
    input: unknown,
    options: McpToolTestOptions,
  ): Promise<McpBrokerSuccess> {
    this.assertEnabled()
    this.requireTool(serverId, toolId)
    const sessionId = nonEmpty(options?.sessionId)
    return this.broker.execute({
      serverId,
      toolId,
      input,
      sessionId,
      ...(options.role === undefined ? {} : { role: options.role }),
      caller: 'manual_test',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
  }

  async approve(
    serverId: string,
    requestId: string,
    options: McpApprovalOptions = {},
  ): Promise<McpBrokerSuccess> {
    this.assertEnabled()
    const request = this.requireApproval(requestId)
    if (request.serverId !== serverId) throw new McpError('MCP_APPROVAL_INVALID')
    return this.broker.approve(requestId, options)
  }

  async deny(serverId: string, requestId: string): Promise<McpBrokerDenied> {
    this.assertEnabled()
    const request = this.requireApproval(requestId)
    if (request.serverId !== serverId) throw new McpError('MCP_APPROVAL_INVALID')
    return this.broker.deny(requestId)
  }

  listRuns(serverId: string, options: McpRunQueryOptions = {}): McpRunRecord[] {
    // Historical audit remains queryable even when MCP is disabled.
    this.requireServer(serverId)
    if (options.toolId !== undefined && typeof options.toolId !== 'string') {
      throw new McpError('MCP_CONFIG_INVALID')
    }
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new McpError('MCP_CONFIG_INVALID')
    }
    return this.repository.listRuns({
      serverId,
      ...(options.toolId === undefined ? {} : { toolId: options.toolId }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }).map(toSafeRunRecord)
  }

  private assertEnabled(): void {
    if (!isMcpClientEnabled(this.env)) throw new McpError('MCP_DISABLED')
  }

  private requireServer(serverId: string): McpServerRecord {
    const id = nonEmpty(serverId)
    const server = this.repository.getServer(id)
    if (!server) throw new McpError('MCP_SERVER_NOT_FOUND')
    return server
  }

  private requireTool(serverId: string, toolId: string): McpToolRecord {
    this.requireServer(serverId)
    const tool = this.repository.getTool(toolId)
    if (!tool || tool.serverId !== serverId) throw new McpError('MCP_TOOL_NOT_FOUND')
    return tool
  }

  private requireApproval(requestId: string): McpApprovalRequest {
    const id = nonEmpty(requestId)
    const request = this.broker.getApprovalRequest(id)
    if (!request || request.consumedAt !== null) throw new McpError('MCP_APPROVAL_INVALID')
    return request
  }

  private markConnectionError(server: McpServerRecord, error: McpError): void {
    try {
      this.repository.updateServer(server.id, {
        connectionStatus: 'error',
        lastErrorCode: error.code,
        lastErrorAt: this.clock(),
        updatedAt: this.clock(),
      })
    } catch {
      // The original stable connection error is more useful than a secondary
      // repository failure and must never expose its cause.
    }
  }
}

export function toSafeMcpServer(server: McpServerRecord): SafeMcpServer {
  const config = parseStoredConfig(server.configJson)
  const transport = normalizeServerTransport(server.transportKind, config)
  return {
    id: server.id,
    name: server.name,
    transport: toSafeTransport(transport),
    connectionStatus: server.connectionStatus,
    isEnabled: server.isEnabled,
    trustLevel: server.trustLevel,
    catalogVersion: server.catalogVersion,
    lastErrorCode: server.lastErrorCode,
    lastErrorAt: server.lastErrorAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

export function toSafeMcpTool(tool: McpToolRecord): SafeMcpTool {
  return toSafeToolRecord(tool)
}

export function toSafeMcpRun(run: McpRunRecord): SafeMcpRun {
  return toSafeRunRecord(run)
}

export function toSafeMcpResult(result: unknown): NormalizedMcpResult {
  try {
    return normalizeMcpResult(result)
  } catch {
    return {
      content: [MCP_RESULT_REDACTED_VALUE],
      isError: true,
      truncated: true,
    }
  }
}

export function toSafeMcpPreview(preview: McpPreview): SafeMcpPreview {
  return toSafePreview(preview)
}

function toSafeToolRecord(tool: McpToolRecord): SafeMcpTool {
  const inputSchema = sanitizeCatalogValue(tool.inputSchema) ?? {}
  const outputSchema = tool.outputSchema === undefined ? undefined : sanitizeCatalogValue(tool.outputSchema)
  const schemaSupported = tool.schemaSupported !== false
  return {
    id: tool.id,
    serverId: tool.serverId,
    remoteName: tool.remoteName,
    name: tool.name,
    description: sanitizeText(tool.description),
    inputSchema,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    schemaHash: tool.schemaHash,
    schemaSupported,
    ...(schemaSupported ? {} : { schemaErrorCode: 'MCP_SCHEMA_UNSUPPORTED' as const }),
    isEnabled: tool.isEnabled,
    isRemoved: tool.isRemoved,
    requiresApproval: tool.requiresApproval,
    riskLevel: tool.riskLevel,
    discoveredAt: tool.discoveredAt,
    updatedAt: tool.updatedAt,
    removedAt: tool.removedAt,
  }
}

function toSafeRunRecord(run: McpRunRecord): SafeMcpRun {
  return {
    id: run.id,
    serverId: run.serverId,
    toolId: run.toolId,
    remoteName: run.remoteName,
    sessionId: run.sessionId ?? null,
    agentRole: run.agentRole ?? null,
    status: run.status,
    inputHash: run.inputHash,
    safeInput: run.safeInput === undefined || run.safeInput === null
      ? null
      : sanitizeCatalogValue(run.safeInput) ?? '[REDACTED]',
    safeOutput: run.safeOutput === undefined || run.safeOutput === null
      ? null
      : toSafeMcpResult(run.safeOutput),
    errorCode: run.errorCode ?? null,
    durationMs: run.durationMs ?? null,
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? null,
  }
}

function toSafePreview(preview: McpPreview): SafeMcpPreview {
  return {
    previewId: preview.previewId,
    serverId: preview.serverId,
    previewHash: preview.previewHash,
    configHash: preview.configHash,
    catalogVersion: preview.catalogVersion,
    diff: preview.diff.map((entry) => ({
      kind: entry.kind,
      remoteName: entry.remoteName,
      ...(entry.toolId === undefined ? {} : { toolId: entry.toolId }),
      ...(entry.before === undefined ? {} : { before: sanitizeCatalogValue(entry.before) }),
      ...(entry.after === undefined ? {} : { after: sanitizeCatalogValue(entry.after) }),
    })),
    createdAt: preview.createdAt,
    expiresAt: preview.expiresAt,
  }
}

function toSafeDiscoveredTool(tool: DiscoveredMcpTool): DiscoveredMcpTool {
  return {
    serverId: tool.serverId,
    serverName: tool.serverName,
    localName: sanitizeText(tool.localName),
    remoteName: sanitizeText(tool.remoteName),
    toolId: tool.toolId,
    name: tool.name === undefined ? undefined : sanitizeText(tool.name),
    description: tool.description === undefined ? undefined : sanitizeText(tool.description),
    inputSchema: sanitizeCatalogValue(tool.inputSchema),
    outputSchema: sanitizeCatalogValue(tool.outputSchema),
    schemaHash: tool.schemaHash,
    schemaSupported: tool.schemaSupported,
    schemaErrorCode: tool.schemaErrorCode,
  }
}

function normalizeServerConfig(
  transportKind: McpTransportKind,
  value: unknown,
  env: EnvironmentLike,
): { config: JsonSafeObject; transport: McpTransportConfig; secretRefs: readonly string[] } {
  const config = asJsonObject(value)
  const transport = normalizeServerTransport(transportKind, config)
  // The transport hash performs the shared URL/header/stdio policy checks
  // without resolving secret values into this management layer.
  hashMcpTransportConfig(transport)
  const secretRefs = collectSecretReferences(transport)
  const allowedNames = parseAllowedEnvironmentNames(env.MCP_ALLOWED_ENV_NAMES)
  for (const reference of secretRefs) {
    const parsed = parseSecretReference(reference)
    if (!parsed || !allowedNames.has(parsed.name)) throw new McpError('MCP_CONFIG_INVALID')
  }
  const normalizedConfig = transportToJsonObject(transport)
  return { config: normalizedConfig, transport, secretRefs }
}

function createConnectionConfig(
  server: McpServerRecord,
  env: EnvironmentLike,
  isEnabled: boolean,
): McpServerConnectionConfig {
  const normalized = normalizeServerConfig(server.transportKind, parseStoredConfig(server.configJson), env)
  const configVersion = hashMcpConfig({
    serverId: server.id,
    name: server.name,
    transportKind: server.transportKind,
    config: normalized.config,
    secretRefs: normalized.secretRefs,
  })
  return {
    serverId: server.id,
    name: server.name,
    transport: normalized.transport,
    configVersion,
    catalogVersion: String(server.catalogVersion),
    isEnabled,
    trustLevel: server.trustLevel,
    secretRefs: normalized.secretRefs,
  }
}

function parseStoredConfig(configJson: string): JsonSafeObject {
  if (typeof configJson !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  let value: unknown
  try {
    value = JSON.parse(configJson)
  } catch (error) {
    throw new McpError('MCP_CONFIG_INVALID', { cause: error })
  }
  return asJsonObject(value)
}

function normalizeServerTransport(kind: McpTransportKind, config: JsonSafeObject): McpTransportConfig {
  if (kind === 'stdio') {
    if (typeof config.command !== 'string') throw new McpError('MCP_CONFIG_INVALID')
    const transport: McpTransportConfig = {
      kind: 'stdio',
      command: config.command,
      args: config.args === undefined ? [] : asStringArray(config.args),
      ...(config.cwd === undefined ? {} : { cwd: asString(config.cwd) }),
      env: config.env === undefined ? {} : asStringRecord(config.env),
    }
    try {
      const validated = validateStdioTransport(transport, { validateCwd: false })
      return {
        kind: 'stdio',
        command: validated.command,
        args: validated.args,
        ...(validated.cwd === undefined ? {} : { cwd: validated.cwd }),
        env: validated.env,
      }
    } catch (error) {
      throw mapMcpFailure(error, 'MCP_CONFIG_INVALID')
    }
  }

  if (kind === 'streamable_http') {
    const url = asString(config.url)
    const headers = config.headers === undefined ? {} : asStringRecord(config.headers)
    return { kind: 'streamable_http', url, headers }
  }
  throw new McpError('MCP_CONFIG_INVALID')
}

function transportToJsonObject(transport: McpTransportConfig): JsonSafeObject {
  if (transport.kind === 'stdio') {
    return {
      command: transport.command,
      args: [...(transport.args ?? [])],
      ...(transport.cwd === undefined ? {} : { cwd: transport.cwd }),
      env: { ...(transport.env ?? {}) },
    }
  }
  return {
    url: typeof transport.url === 'string' ? transport.url : transport.url.href,
    headers: { ...(transport.headers ?? {}) },
  }
}

function toSafeTransport(transport: McpTransportConfig): SafeMcpTransport {
  if (transport.kind === 'stdio') {
    return {
      kind: 'stdio',
      command: summarizeText(transport.command),
      args: (transport.args ?? []).map((arg) => isSafeReference(arg) ? arg : summarizeArgument(arg)),
      ...(transport.cwd === undefined ? {} : { cwd: summarizeText(transport.cwd) }),
      envNames: Object.keys(transport.env ?? {}).sort(),
    }
  }
  const url = new URL(typeof transport.url === 'string' ? transport.url : transport.url.href)
  const origin = url.origin
  return {
    kind: 'streamable_http',
    url: origin,
    origin,
    headers: Object.keys(transport.headers ?? {}).sort(),
  }
}

function collectSecretReferences(value: unknown, output = new Set<string>()): readonly string[] {
  if (typeof value === 'string') {
    if (parseSecretReference(value)) output.add(value)
    return [...output].sort()
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSecretReferences(entry, output)
    return [...output].sort()
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectSecretReferences(entry, output)
  }
  return [...output].sort()
}

function asJsonObject(value: unknown): JsonSafeObject {
  if (!isJsonSafeValue(value) || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError('MCP_CONFIG_INVALID')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new McpError('MCP_CONFIG_INVALID')
  return value as JsonSafeObject
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new McpError('MCP_CONFIG_INVALID')
  }
  return [...value]
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpError('MCP_CONFIG_INVALID')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new McpError('MCP_CONFIG_INVALID')
  const entries = Object.entries(value)
  if (entries.some(([, entry]) => typeof entry !== 'string')) throw new McpError('MCP_CONFIG_INVALID')
  return Object.fromEntries(entries) as Record<string, string>
}

function normalizeTransportKind(value: unknown): McpTransportKind {
  if (value !== 'stdio' && value !== 'streamable_http') throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function nonEmpty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new McpError('MCP_CONFIG_INVALID')
  return value.trim()
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return nonEmpty(value)
}

function mapMcpFailure(error: unknown, fallback: McpError['code']): McpError {
  if (error instanceof McpError) return error
  const code = getMcpErrorCode(error)
  return new McpError(code ?? fallback, code === undefined ? { cause: error } : {})
}

function summarizeText(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`
}

function summarizeArgument(value: string): string {
  if (isSafeReference(value)) return value
  if (/^-{1,2}[A-Za-z0-9][A-Za-z0-9._:-]*=/.test(value)) {
    return `${value.slice(0, value.indexOf('=') + 1)}[REDACTED]`
  }
  if (/^-{1,2}[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return summarizeText(value)
  return '[REDACTED]'
}

function summarizeCommand(value: string): string {
  return containsSensitiveText(value) ? '[REDACTED]' : summarizeText(value)
}

function summarizePath(value: string): string {
  return containsSensitiveText(value) ? '[REDACTED]' : summarizeText(value)
}

function containsSensitiveText(value: string): boolean {
  return /(token|secret|password|authorization|cookie|credential|apikey|bearer)/i.test(value)
}

function sanitizeText(value: string): string {
  return summarizeText(value.replace(/[\u0000-\u001f\u007f]/g, ' '))
}

function isSafeReference(value: string): boolean {
  return parseSecretReference(value) !== null
}
