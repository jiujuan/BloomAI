export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type McpTransportKind = 'stdio' | 'streamable_http'
export type McpTrustLevel = 'untrusted' | 'reviewed' | 'trusted'
export type McpRiskLevel = 'low' | 'medium' | 'high'
export type McpConnectionStatus = 'unknown' | 'healthy' | 'error' | 'disabled'
export type McpRunStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'denied' | 'cancelled'

export type McpServer = {
  id: string
  name: string
  transport: McpSafeTransport
  connectionStatus: McpConnectionStatus
  isEnabled: boolean
  trustLevel: McpTrustLevel
  catalogVersion: number
  lastErrorCode: string | null
  lastErrorAt: number | null
  createdAt: number
  updatedAt: number
}

export type McpSafeTransport =
  | { kind: 'stdio'; command: string; args: string[]; cwd?: string; envNames: string[] }
  | { kind: 'streamable_http'; url: string; origin: string; headers: string[] }

/** Safe discovery DTO returned by the temporary Test Connection flow. */
export type McpDiscoveredTool = {
  serverId?: string
  serverName?: string
  localName?: string
  remoteName: string
  toolId?: string
  name?: string
  description?: string
  inputSchema?: JsonValue
  outputSchema?: JsonValue
  schemaHash?: string
  schemaSupported?: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
}

export type McpTool = {
  id: string
  serverId: string
  remoteName: string
  name: string
  description: string
  inputSchema: JsonValue
  outputSchema?: JsonValue
  schemaHash: string
  schemaSupported: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
  isEnabled: boolean
  isRemoved: boolean
  requiresApproval: boolean
  riskLevel: McpRiskLevel
  discoveredAt: number
  updatedAt: number
  removedAt: number | null
}

export type McpPreviewDiff = {
  kind: 'added' | 'changed' | 'removed' | 'unchanged'
  remoteName: string
  toolId?: string
  before?: JsonValue
  after?: JsonValue
}

export type McpPreview = {
  previewId: string
  serverId: string
  previewHash: string
  configHash: string
  catalogVersion: string
  diff: McpPreviewDiff[]
  createdAt: number
  expiresAt: number
}

export type McpSafeResult = {
  content: JsonValue[]
  structuredContent?: JsonValue
  isError: boolean
  truncated: boolean
  safeSummary?: string
}

export type McpRun = {
  id: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId?: string | null
  agentRole?: string | null
  status: McpRunStatus
  inputHash: string
  safeInput: JsonValue | null
  safeOutput: McpSafeResult | null
  errorCode?: string | null
  durationMs?: number | null
  createdAt: number
  completedAt?: number | null
}

export type McpToolTestResponse = {
  status: McpRunStatus
  result: McpSafeResult
  run: McpRun
}

export type McpApprovalState = {
  approvalRequestId: string
  runId: string
  expiresAt: number
  safePreview: {
    serverId?: string
    toolId?: string
    remoteName?: string
    toolName?: string
    riskLevel?: string
    trustLevel?: string
    catalogVersion?: string
    safeInput?: JsonValue
  }
}

export type McpServerConfigInput = {
  name: string
  transportKind: McpTransportKind
  config: Record<string, JsonValue>
}

export type McpServerPatch = Partial<McpServerConfigInput>

export type McpApiErrorDetails = Record<string, unknown>

const SENSITIVE_KEY = /(token|secret|password|credential|authorization|cookie|api[-_]?key|approval)/i

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(safeJsonValue).filter((entry): entry is JsonValue => entry !== undefined)
  if (!isObject(value)) return undefined
  const result: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue
    const safe = safeJsonValue(child)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

/** Keeps only the safe approval envelope returned by the HTTP error mapper. */
export function sanitizeMcpApprovalDetails(value: unknown): McpApprovalState | undefined {
  if (!isObject(value)) return undefined
  const approvalRequestId = typeof value.approvalRequestId === 'string' ? value.approvalRequestId : undefined
  const runId = typeof value.runId === 'string' ? value.runId : undefined
  const expiresAt = typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) ? value.expiresAt : undefined
  if (!approvalRequestId || !runId || expiresAt === undefined) return undefined

  const rawPreview = isObject(value.safePreview) ? value.safePreview : undefined
  const safePreview: McpApprovalState['safePreview'] = {}
  if (rawPreview) {
    for (const key of ['serverId', 'toolId', 'remoteName', 'toolName', 'riskLevel', 'trustLevel', 'catalogVersion']) {
      if (typeof rawPreview[key] === 'string') safePreview[key as keyof typeof safePreview] = rawPreview[key] as never
    }
    const safeInput = safeJsonValue(rawPreview.safeInput)
    if (safeInput !== undefined) safePreview.safeInput = safeInput
  }
  return { approvalRequestId, runId, expiresAt, safePreview }
}

export function sanitizeMcpErrorDetails(value: unknown): McpApiErrorDetails | undefined {
  if (!isObject(value)) return undefined
  const approval = sanitizeMcpApprovalDetails(value)
  if (approval) return approval
  const output: McpApiErrorDetails = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (key === 'safePreview') {
      const safePreview = sanitizeMcpApprovalDetails({ approvalRequestId: 'placeholder', runId: 'placeholder', expiresAt: 0, safePreview: child })?.safePreview
      if (safePreview) output.safePreview = safePreview
      continue
    }
    const safe = safeJsonValue(child)
    if (safe !== undefined) output[key] = safe
  }
  return Object.keys(output).length > 0 ? output : undefined
}
