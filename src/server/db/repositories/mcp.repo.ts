import { and, asc, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import {
  mcp_server_tools,
  mcp_servers,
  mcp_tool_runs,
  type McpServerRow,
  type McpServerToolRow,
  type McpToolRunRow,
} from '../schema'
import { McpError } from '../../mcp/errors'
import { normalizeMcpResult, isJsonSafeValue } from '../../mcp/result-normalizer'
import { parseSecretReference } from '../../mcp/secret-resolver'
import {
  canTransitionMcpRun,
  createMcpToolId,
  isMcpRunStatus,
  MCP_ERROR_CODES,
  type JsonSafeValue,
  type McpErrorCode,
  type McpRiskLevel,
  type McpRunStatus,
  type McpServerTool,
  type McpToolRun,
  type McpTransportKind,
  type McpTrustLevel,
  type NormalizedMcpResult,
} from '../../mcp/types'

export type McpConnectionStatus = 'unknown' | 'healthy' | 'error' | 'disabled'

export type McpServerRecord = {
  id: string
  name: string
  transportKind: McpTransportKind
  configJson: string
  secretRefs: readonly string[]
  isEnabled: boolean
  trustLevel: McpTrustLevel
  connectionStatus: McpConnectionStatus
  catalogVersion: number
  lastErrorCode: McpErrorCode | null
  lastErrorAt: number | null
  createdAt: number
  updatedAt: number
}

export type CreateMcpServerInput = {
  id?: string
  name: string
  transportKind: McpTransportKind
  configJson: string
  secretRefs?: readonly string[]
  isEnabled?: boolean
  trustLevel?: McpTrustLevel
  connectionStatus?: McpConnectionStatus
  catalogVersion?: number
  lastErrorCode?: McpErrorCode | null
  lastErrorAt?: number | null
  createdAt?: number
  updatedAt?: number
}

export type UpdateMcpServerInput = {
  name?: string
  transportKind?: McpTransportKind
  configJson?: string
  secretRefs?: readonly string[]
  isEnabled?: boolean
  trustLevel?: McpTrustLevel
  connectionStatus?: McpConnectionStatus
  lastErrorCode?: McpErrorCode | null
  lastErrorAt?: number | null
  updatedAt?: number
}

export type McpCatalogToolInput = {
  id?: string
  remoteName: string
  name: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  schemaHash: string
  requiresApproval?: boolean
  riskLevel?: McpRiskLevel
  discoveredAt?: number
  updatedAt?: number
}

export type ConfirmMcpCatalogInput = {
  serverId: string
  expectedCatalogVersion: number
  tools: readonly McpCatalogToolInput[]
  removedRemoteNames?: readonly string[]
  now?: number
}

export type ConfirmMcpCatalogResult = {
  server: McpServerRecord
  tools: McpServerTool[]
}

export type McpToolListOptions = {
  includeRemoved?: boolean
}

export type CreateMcpToolRunInput = {
  id?: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId?: string | null
  agentRole?: string | null
  status: McpRunStatus
  inputHash: string
  safeInput?: unknown | null
  safeOutput?: unknown | null
  errorCode?: McpErrorCode | null
  durationMs?: number | null
  createdAt?: number
  completedAt?: number | null
}

export type UpdateMcpToolRunInput = {
  status: McpRunStatus
  safeOutput?: unknown | null
  errorCode?: McpErrorCode | null
  durationMs?: number | null
  completedAt?: number | null
}

export type McpRunListOptions = {
  serverId?: string
  toolId?: string
  remoteName?: string
  status?: McpRunStatus
  limit?: number
}

export type McpToolRecord = McpServerTool
export type McpRunRecord = McpToolRun

const TERMINAL_RUN_STATUSES = new Set<McpRunStatus>(['success', 'error', 'denied', 'cancelled'])
const VALID_CONNECTION_STATUSES = new Set<McpConnectionStatus>(['unknown', 'healthy', 'error', 'disabled'])
const VALID_TRANSPORT_KINDS = new Set<McpTransportKind>(['stdio', 'streamable_http'])
const VALID_TRUST_LEVELS = new Set<McpTrustLevel>(['untrusted', 'reviewed', 'trusted'])
const VALID_RISK_LEVELS = new Set<McpRiskLevel>(['low', 'medium', 'high'])
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|apikey|credential|privatekey)/

export const mcpRepo = {
  getServer(id: string): McpServerRecord | undefined {
    const row = getOrmDb().select().from(mcp_servers).where(eq(mcp_servers.id, id)).get() as McpServerRow | undefined
    return row ? mapServerRow(row) : undefined
  },

  listServers(): McpServerRecord[] {
    return getOrmDb().select().from(mcp_servers).orderBy(desc(mcp_servers.updated_at)).all().map((row) => mapServerRow(row as McpServerRow))
  },

  createServer(input: CreateMcpServerInput): McpServerRecord {
    const id = input.id ?? uuidv4()
    const now = Date.now()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? now
    const values = {
      id: assertNonEmpty(id, 'server id'),
      name: assertNonEmpty(input.name, 'server name'),
      transport_kind: assertTransportKind(input.transportKind),
      config_json: serializeConfigJson(input.configJson),
      secret_refs_json: serializeSecretRefs(input.secretRefs ?? []),
      is_enabled: toSqliteBoolean(input.isEnabled ?? false),
      trust_level: assertTrustLevel(input.trustLevel ?? 'untrusted'),
      connection_status: assertConnectionStatus(input.connectionStatus ?? 'unknown'),
      catalog_version: assertNonNegativeInteger(input.catalogVersion ?? 0, 'catalog version'),
      last_error_code: assertErrorCode(input.lastErrorCode ?? null),
      last_error_at: input.lastErrorAt ?? null,
      created_at: assertTimestamp(createdAt, 'createdAt'),
      updated_at: assertTimestamp(updatedAt, 'updatedAt'),
    }

    try {
      getOrmDb().insert(mcp_servers).values(values).run()
    } catch (error) {
      throw new McpError('MCP_CONFIG_INVALID', { cause: error })
    }
    return this.getServer(id)!
  },

  updateServer(id: string, input: UpdateMcpServerInput): McpServerRecord {
    const current = getServerRow(id)
    const patch: Record<string, unknown> = {
      updated_at: assertTimestamp(input.updatedAt ?? Date.now(), 'updatedAt'),
    }
    if (input.name !== undefined) patch.name = assertNonEmpty(input.name, 'server name')
    if (input.transportKind !== undefined) patch.transport_kind = assertTransportKind(input.transportKind)
    if (input.configJson !== undefined) patch.config_json = serializeConfigJson(input.configJson)
    if (input.secretRefs !== undefined) patch.secret_refs_json = serializeSecretRefs(input.secretRefs)
    if (input.isEnabled !== undefined) patch.is_enabled = toSqliteBoolean(input.isEnabled)
    if (input.trustLevel !== undefined) patch.trust_level = assertTrustLevel(input.trustLevel)
    if (input.connectionStatus !== undefined) patch.connection_status = assertConnectionStatus(input.connectionStatus)
    if (input.lastErrorCode !== undefined) patch.last_error_code = assertErrorCode(input.lastErrorCode)
    if (input.lastErrorAt !== undefined) patch.last_error_at = input.lastErrorAt

    try {
      getOrmDb().update(mcp_servers).set(patch).where(eq(mcp_servers.id, current.id)).run()
    } catch (error) {
      throw new McpError('MCP_CONFIG_INVALID', { cause: error })
    }
    return this.getServer(id)!
  },

  setServerEnabled(id: string, enabled: boolean): McpServerRecord {
    const current = getServerRow(id)
    const nextStatus = enabled && current.connection_status === 'disabled' ? 'unknown' : enabled ? current.connection_status : 'disabled'
    return this.updateServer(id, { isEnabled: enabled, connectionStatus: nextStatus })
  },

  setServerTrust(id: string, trustLevel: McpTrustLevel): McpServerRecord {
    getServerRow(id)
    return this.updateServer(id, { trustLevel })
  },

  deleteServer(id: string): boolean {
    getServerRowOrUndefined(id)
    try {
      const result = getOrmDb().delete(mcp_servers).where(eq(mcp_servers.id, id)).run() as { changes?: number | bigint }
      return getChanges(result) > 0
    } catch (error) {
      // Historical tools/runs intentionally make deletion restrictive; callers must disable instead.
      throw new McpError('MCP_CONFIG_INVALID', { cause: error })
    }
  },

  getTool(id: string): McpToolRecord | undefined {
    const row = getOrmDb().select().from(mcp_server_tools).where(eq(mcp_server_tools.id, id)).get() as McpServerToolRow | undefined
    return row ? mapToolRow(row) : undefined
  },

  getToolByRemoteName(serverId: string, remoteName: string): McpToolRecord | undefined {
    const row = getOrmDb().select().from(mcp_server_tools)
      .where(and(eq(mcp_server_tools.server_id, serverId), eq(mcp_server_tools.remote_name, remoteName)))
      .get() as McpServerToolRow | undefined
    return row ? mapToolRow(row) : undefined
  },

  listTools(serverId: string, options: McpToolListOptions = {}): McpToolRecord[] {
    const condition = options.includeRemoved
      ? eq(mcp_server_tools.server_id, serverId)
      : and(eq(mcp_server_tools.server_id, serverId), eq(mcp_server_tools.is_removed, 0))
    return getOrmDb().select().from(mcp_server_tools).where(condition).orderBy(asc(mcp_server_tools.remote_name)).all()
      .map((row) => mapToolRow(row as McpServerToolRow))
  },

  confirmCatalog(input: ConfirmMcpCatalogInput): ConfirmMcpCatalogResult {
    const serverId = assertNonEmpty(input.serverId, 'server id')
    const expectedCatalogVersion = assertNonNegativeInteger(input.expectedCatalogVersion, 'catalog version')
    const now = assertTimestamp(input.now ?? Date.now(), 'catalog timestamp')
    const tools = input.tools.map(normalizeCatalogToolInput)
    const remoteNames = new Set<string>()
    for (const tool of tools) {
      if (remoteNames.has(tool.remoteName)) throw new McpError('MCP_CONFIG_INVALID')
      remoteNames.add(tool.remoteName)
    }
    const removedRemoteNames = new Set((input.removedRemoteNames ?? []).map((remoteName) => assertNonEmpty(remoteName, 'remote tool name')))

    return getOrmDb().transaction((tx) => {
      const serverRow = tx.select().from(mcp_servers).where(eq(mcp_servers.id, serverId)).get() as McpServerRow | undefined
      if (!serverRow) throw new McpError('MCP_SERVER_NOT_FOUND')
      if (Number(serverRow.catalog_version) !== expectedCatalogVersion) throw new McpError('MCP_PREVIEW_STALE')

      const existingRows = tx.select().from(mcp_server_tools).where(eq(mcp_server_tools.server_id, serverId)).all() as McpServerToolRow[]
      const existingByRemote = new Map(existingRows.map((row) => [row.remote_name, row]))

      for (const tool of tools) {
        const existing = existingByRemote.get(tool.remoteName)
        const inputSchemaJson = JSON.stringify(tool.inputSchema)
        const outputSchemaJson = tool.outputSchema === undefined ? null : JSON.stringify(tool.outputSchema)
        const expectedToolId = createMcpToolId(serverId, tool.remoteName)
        if (tool.id !== undefined && tool.id !== expectedToolId) throw new McpError('MCP_CONFIG_INVALID')
        if (existing && existing.id !== expectedToolId) throw new McpError('MCP_CONFIG_INVALID')
        const id = expectedToolId
        const metadataChanged = !existing
          || existing.name !== tool.name
          || existing.description !== tool.description
          || existing.input_schema_json !== inputSchemaJson
          || existing.output_schema_json !== outputSchemaJson
          || existing.schema_hash !== tool.schemaHash
          || Number(existing.is_removed) === 1
        const updatedAt = assertTimestamp(tool.updatedAt ?? now, 'tool updatedAt')

        if (!existing) {
          tx.insert(mcp_server_tools).values({
            id,
            server_id: serverId,
            remote_name: tool.remoteName,
            name: tool.name,
            description: tool.description,
            input_schema_json: inputSchemaJson,
            output_schema_json: outputSchemaJson,
            schema_hash: tool.schemaHash,
            is_enabled: 0,
            is_removed: 0,
            requires_approval: toSqliteBoolean(tool.requiresApproval ?? true),
            risk_level: tool.riskLevel ?? 'medium',
            discovered_at: assertTimestamp(tool.discoveredAt ?? now, 'tool discoveredAt'),
            updated_at: updatedAt,
            removed_at: null,
          }).run()
        } else {
          tx.update(mcp_server_tools).set({
            name: tool.name,
            description: tool.description,
            input_schema_json: inputSchemaJson,
            output_schema_json: outputSchemaJson,
            schema_hash: tool.schemaHash,
            is_enabled: metadataChanged ? 0 : existing.is_enabled,
            is_removed: 0,
            updated_at: updatedAt,
            removed_at: null,
          }).where(eq(mcp_server_tools.id, existing.id)).run()
        }
      }

      for (const existing of existingRows) {
        if (!remoteNames.has(existing.remote_name) && removedRemoteNames.has(existing.remote_name)) {
          tx.update(mcp_server_tools).set({
            is_enabled: 0,
            is_removed: 1,
            removed_at: now,
            updated_at: now,
          }).where(eq(mcp_server_tools.id, existing.id)).run()
        }
      }

      const versionUpdate = tx.update(mcp_servers).set({
        catalog_version: expectedCatalogVersion + 1,
        updated_at: now,
      }).where(and(eq(mcp_servers.id, serverId), eq(mcp_servers.catalog_version, expectedCatalogVersion))).run() as { changes?: number | bigint }
      if (getChanges(versionUpdate) !== 1) throw new McpError('MCP_PREVIEW_STALE')

      const updatedServer = tx.select().from(mcp_servers).where(eq(mcp_servers.id, serverId)).get() as McpServerRow
      const updatedTools = tx.select().from(mcp_server_tools).where(eq(mcp_server_tools.server_id, serverId)).orderBy(asc(mcp_server_tools.remote_name)).all()
      return {
        server: mapServerRow(updatedServer),
        tools: updatedTools.map((row) => mapToolRow(row as McpServerToolRow)),
      }
    })
  },

  setToolEnabled(id: string, enabled: boolean): McpToolRecord {
    const current = getToolRow(id)
    if (enabled && Number(current.is_removed) === 1) throw new McpError('MCP_TOOL_DISABLED')
    getOrmDb().update(mcp_server_tools).set({ is_enabled: toSqliteBoolean(enabled), updated_at: Date.now() }).where(eq(mcp_server_tools.id, id)).run()
    return this.getTool(id)!
  },

  softDeleteTool(id: string, removedAt = Date.now()): McpToolRecord {
    getToolRow(id)
    const timestamp = assertTimestamp(removedAt, 'removedAt')
    getOrmDb().update(mcp_server_tools).set({ is_enabled: 0, is_removed: 1, removed_at: timestamp, updated_at: timestamp }).where(eq(mcp_server_tools.id, id)).run()
    return this.getTool(id)!
  },

  createRun(input: CreateMcpToolRunInput): McpRunRecord {
    const server = getServerRow(input.serverId)
    const tool = getToolRow(input.toolId)
    if (tool.server_id !== server.id || tool.remote_name !== input.remoteName) throw new McpError('MCP_TOOL_NOT_FOUND')
    const id = input.id ?? uuidv4()
    const status = assertRunStatus(input.status)
    const createdAt = assertTimestamp(input.createdAt ?? Date.now(), 'createdAt')
    const safeInput = normalizeSafeInput(input.safeInput)
    const safeOutput = normalizeSafeOutput(input.safeOutput)
    const completedAt = input.completedAt === undefined
      ? TERMINAL_RUN_STATUSES.has(status) ? createdAt : null
      : input.completedAt
    const values = {
      id: assertNonEmpty(id, 'run id'),
      server_id: server.id,
      tool_id: tool.id,
      remote_name: assertNonEmpty(input.remoteName, 'remote tool name'),
      session_id: input.sessionId ?? null,
      agent_role: input.agentRole ?? null,
      status,
      input_hash: assertNonEmpty(input.inputHash, 'input hash'),
      safe_input_json: safeInput === null ? null : JSON.stringify(safeInput),
      safe_output_json: safeOutput === null ? null : JSON.stringify(safeOutput),
      error_code: assertErrorCode(input.errorCode ?? null),
      duration_ms: input.durationMs ?? null,
      created_at: createdAt,
      completed_at: completedAt,
    }
    try {
      getOrmDb().insert(mcp_tool_runs).values(values).run()
    } catch (error) {
      throw new McpError('MCP_CONFIG_INVALID', { cause: error })
    }
    return this.getRun(id)!
  },

  updateRunStatus(id: string, input: UpdateMcpToolRunInput): McpRunRecord {
    const current = getRunRow(id)
    const nextStatus = assertRunStatus(input.status)
    const currentStatus = current.status as McpRunStatus
    if (currentStatus !== nextStatus && !canTransitionMcpRun(currentStatus, nextStatus)) {
      throw new McpError('MCP_CONFIG_INVALID')
    }

    const patch: Record<string, unknown> = { status: nextStatus }
    if (Object.prototype.hasOwnProperty.call(input, 'safeOutput')) {
      const safeOutput = normalizeSafeOutput(input.safeOutput)
      patch.safe_output_json = safeOutput === null ? null : JSON.stringify(safeOutput)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'errorCode')) patch.error_code = assertErrorCode(input.errorCode ?? null)
    if (Object.prototype.hasOwnProperty.call(input, 'durationMs')) patch.duration_ms = input.durationMs ?? null
    if (Object.prototype.hasOwnProperty.call(input, 'completedAt')) patch.completed_at = input.completedAt ?? null
    else if (TERMINAL_RUN_STATUSES.has(nextStatus) && current.completed_at === null) patch.completed_at = Date.now()

    try {
      getOrmDb().update(mcp_tool_runs).set(patch).where(eq(mcp_tool_runs.id, id)).run()
    } catch (error) {
      throw new McpError('MCP_CONFIG_INVALID', { cause: error })
    }
    return this.getRun(id)!
  },

  getRun(id: string): McpRunRecord | undefined {
    const row = getOrmDb().select().from(mcp_tool_runs).where(eq(mcp_tool_runs.id, id)).get() as McpToolRunRow | undefined
    return row ? mapRunRow(row) : undefined
  },

  listRuns(options: McpRunListOptions = {}): McpRunRecord[] {
    const conditions = []
    if (options.serverId !== undefined) conditions.push(eq(mcp_tool_runs.server_id, options.serverId))
    if (options.toolId !== undefined) conditions.push(eq(mcp_tool_runs.tool_id, options.toolId))
    if (options.remoteName !== undefined) conditions.push(eq(mcp_tool_runs.remote_name, options.remoteName))
    if (options.status !== undefined) conditions.push(eq(mcp_tool_runs.status, assertRunStatus(options.status)))
    const query = getOrmDb().select().from(mcp_tool_runs)
    const rows = conditions.length > 0 ? query.where(and(...conditions)) : query
    const limit = options.limit === undefined ? 100 : assertPositiveInteger(options.limit, 'run limit')
    return rows.orderBy(desc(mcp_tool_runs.created_at)).limit(limit).all().map((row) => mapRunRow(row as McpToolRunRow))
  },
}

function getServerRow(id: string): McpServerRow {
  const row = getServerRowOrUndefined(id)
  if (!row) throw new McpError('MCP_SERVER_NOT_FOUND')
  return row
}

function getServerRowOrUndefined(id: string): McpServerRow | undefined {
  return getOrmDb().select().from(mcp_servers).where(eq(mcp_servers.id, id)).get() as McpServerRow | undefined
}

function getToolRow(id: string): McpServerToolRow {
  const row = getOrmDb().select().from(mcp_server_tools).where(eq(mcp_server_tools.id, id)).get() as McpServerToolRow | undefined
  if (!row) throw new McpError('MCP_TOOL_NOT_FOUND')
  return row
}

function getRunRow(id: string): McpToolRunRow {
  const row = getOrmDb().select().from(mcp_tool_runs).where(eq(mcp_tool_runs.id, id)).get() as McpToolRunRow | undefined
  if (!row) throw new McpError('MCP_TOOL_NOT_FOUND')
  return row
}

function mapServerRow(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transportKind: row.transport_kind as McpTransportKind,
    configJson: row.config_json,
    secretRefs: parseStoredSecretRefs(row.secret_refs_json),
    isEnabled: Number(row.is_enabled) === 1,
    trustLevel: row.trust_level as McpTrustLevel,
    connectionStatus: row.connection_status as McpConnectionStatus,
    catalogVersion: Number(row.catalog_version),
    lastErrorCode: row.last_error_code as McpErrorCode | null,
    lastErrorAt: row.last_error_at === null ? null : Number(row.last_error_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function mapToolRow(row: McpServerToolRow): McpToolRecord {
  const outputSchema = row.output_schema_json === null ? undefined : parseStoredJson(row.output_schema_json)
  return {
    id: row.id,
    serverId: row.server_id,
    remoteName: row.remote_name,
    name: row.name,
    description: row.description,
    inputSchema: parseStoredJson(row.input_schema_json),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    schemaHash: row.schema_hash,
    isEnabled: Number(row.is_enabled) === 1,
    isRemoved: Number(row.is_removed) === 1,
    requiresApproval: Number(row.requires_approval) === 1,
    riskLevel: row.risk_level as McpRiskLevel,
    discoveredAt: Number(row.discovered_at),
    updatedAt: Number(row.updated_at),
    removedAt: row.removed_at === null ? null : Number(row.removed_at),
  }
}

function mapRunRow(row: McpToolRunRow): McpRunRecord {
  const safeInput = row.safe_input_json === null ? null : normalizeSafeInput(parseStoredJson(row.safe_input_json))
  const safeOutput = row.safe_output_json === null ? null : normalizeSafeOutput(parseStoredJson(row.safe_output_json))
  return {
    id: row.id,
    serverId: row.server_id,
    toolId: row.tool_id,
    remoteName: row.remote_name,
    sessionId: row.session_id,
    agentRole: row.agent_role,
    status: row.status as McpRunStatus,
    inputHash: row.input_hash,
    safeInput,
    safeOutput,
    errorCode: row.error_code as McpErrorCode | null,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: Number(row.created_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
  }
}

function normalizeCatalogToolInput(input: McpCatalogToolInput): McpCatalogToolInput {
  const remoteName = assertNonEmpty(input.remoteName, 'remote tool name')
  const name = assertNonEmpty(input.name, 'tool name')
  const description = typeof input.description === 'string' ? input.description : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  const schemaHash = assertNonEmpty(input.schemaHash, 'schema hash')
  if (!isJsonSafeValue(input.inputSchema) || input.inputSchema === undefined) throw new McpError('MCP_CONFIG_INVALID')
  if (input.outputSchema !== undefined && !isJsonSafeValue(input.outputSchema)) throw new McpError('MCP_CONFIG_INVALID')
  if (input.id !== undefined) assertNonEmpty(input.id, 'tool id')
  const riskLevel = assertRiskLevel(input.riskLevel ?? 'medium')
  return {
    ...input,
    remoteName,
    name,
    description,
    schemaHash,
    riskLevel,
    requiresApproval: input.requiresApproval ?? true,
  }
}

function normalizeSafeInput(value: unknown): JsonSafeValue | null {
  if (value === undefined || value === null) return value === null ? null : null
  return normalizeMcpResult({ content: [value] }).content[0] ?? null
}

function normalizeSafeOutput(value: unknown): NormalizedMcpResult | null {
  if (value === undefined || value === null) return null
  return normalizeMcpResult(value)
}

function serializeConfigJson(value: string): string {
  if (typeof value !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new McpError('MCP_CONFIG_INVALID', { cause: error })
  }
  if (!isPlainObject(parsed) || !isJsonSafeValue(parsed)) throw new McpError('MCP_CONFIG_INVALID')
  assertPersistedConfigValue(parsed)
  return JSON.stringify(parsed)
}

function serializeSecretRefs(values: readonly string[]): string {
  if (!Array.isArray(values)) throw new McpError('MCP_CONFIG_INVALID')
  const refs = [...new Set(values.map((value) => {
    if (typeof value !== 'string' || !parseSecretReference(value)) throw new McpError('MCP_CONFIG_INVALID')
    return value
  }))].sort()
  return JSON.stringify(refs)
}

function parseStoredSecretRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error('secret refs must be an array')
    return parsed.map((ref) => {
      if (typeof ref !== 'string' || !parseSecretReference(ref)) throw new Error('invalid secret reference')
      return ref
    })
  } catch (error) {
    throw new McpError('MCP_PROTOCOL_ERROR', { cause: error })
  }
}

function parseStoredJson(value: string): JsonSafeValue {
  try {
    const parsed = JSON.parse(value)
    if (!isJsonSafeValue(parsed)) throw new Error('stored value is not JSON-safe')
    return parsed
  } catch (error) {
    throw new McpError('MCP_PROTOCOL_ERROR', { cause: error })
  }
}

function assertPersistedConfigValue(value: JsonSafeValue): void {
  if (Array.isArray(value)) {
    value.forEach(assertPersistedConfigValue)
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
      if (typeof child !== 'string' || !parseSecretReference(child)) throw new McpError('MCP_CONFIG_INVALID')
    }
    assertPersistedConfigValue(child)
  }
}

function assertNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertTransportKind(value: McpTransportKind): McpTransportKind {
  if (!VALID_TRANSPORT_KINDS.has(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertTrustLevel(value: McpTrustLevel): McpTrustLevel {
  if (!VALID_TRUST_LEVELS.has(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertConnectionStatus(value: McpConnectionStatus): McpConnectionStatus {
  if (!VALID_CONNECTION_STATUSES.has(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertRiskLevel(value: McpRiskLevel): McpRiskLevel {
  if (!VALID_RISK_LEVELS.has(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertRunStatus(value: McpRunStatus): McpRunStatus {
  if (!isMcpRunStatus(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function assertErrorCode(value: McpErrorCode | null): McpErrorCode | null {
  if (value === null) return null
  if (!(MCP_ERROR_CODES as readonly string[]).includes(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}

function toSqliteBoolean(value: boolean): number {
  if (typeof value !== 'boolean') throw new McpError('MCP_CONFIG_INVALID')
  return value ? 1 : 0
}

function getChanges(result: { changes?: number | bigint }): number {
  return Number(result.changes ?? 0)
}

function isPlainObject(value: unknown): value is Record<string, JsonSafeValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
