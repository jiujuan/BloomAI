export type JsonPrimitive = string | number | boolean | null

export type JsonSafeValue =
  | JsonPrimitive
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue }

export type JsonSafeObject = { readonly [key: string]: JsonSafeValue }

export type McpTransportKind = 'stdio' | 'streamable_http'

export type McpTrustLevel = 'untrusted' | 'reviewed' | 'trusted'

export type McpRiskLevel = 'low' | 'medium' | 'high'

export type McpRunStatus =
  | 'pending_approval'
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'cancelled'

export const MCP_RUN_STATUSES: readonly McpRunStatus[] = Object.freeze([
  'pending_approval',
  'running',
  'success',
  'error',
  'denied',
  'cancelled',
])

export const MCP_RUN_TRANSITIONS: Readonly<Record<McpRunStatus, readonly McpRunStatus[]>> = Object.freeze({
  pending_approval: Object.freeze(['running', 'denied', 'cancelled'] as McpRunStatus[]),
  running: Object.freeze(['success', 'error', 'cancelled'] as McpRunStatus[]),
  success: Object.freeze([] as McpRunStatus[]),
  error: Object.freeze([] as McpRunStatus[]),
  denied: Object.freeze([] as McpRunStatus[]),
  cancelled: Object.freeze([] as McpRunStatus[]),
})

export function canTransitionMcpRun(from: McpRunStatus, to: McpRunStatus): boolean {
  return MCP_RUN_TRANSITIONS[from].includes(to)
}

export function isMcpRunStatus(value: unknown): value is McpRunStatus {
  return typeof value === 'string' && (MCP_RUN_STATUSES as readonly string[]).includes(value)
}

export const MCP_ERROR_CODES = Object.freeze([
  'MCP_DISABLED',
  'MCP_CONFIG_INVALID',
  'MCP_SERVER_NOT_FOUND',
  'MCP_TOOL_NOT_FOUND',
  'MCP_SERVER_DISABLED',
  'MCP_TOOL_DISABLED',
  'MCP_ROLE_NOT_ALLOWED',
  'MCP_APPROVAL_REQUIRED',
  'MCP_APPROVAL_INVALID',
  'MCP_APPROVAL_EXPIRED',
  'MCP_PREVIEW_STALE',
  'MCP_SCHEMA_UNSUPPORTED',
  'MCP_CONNECTION_FAILED',
  'MCP_PROTOCOL_ERROR',
  'MCP_TOOL_ERROR',
  'MCP_TOOL_TIMEOUT',
  'MCP_TOOL_CANCELLED',
] as const)

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number]

export const MCP_ERROR_MESSAGES: Readonly<Record<McpErrorCode, string>> = Object.freeze({
  MCP_DISABLED: 'MCP client is disabled',
  MCP_CONFIG_INVALID: 'MCP configuration is invalid',
  MCP_SERVER_NOT_FOUND: 'MCP server was not found',
  MCP_TOOL_NOT_FOUND: 'MCP tool was not found',
  MCP_SERVER_DISABLED: 'MCP server is disabled',
  MCP_TOOL_DISABLED: 'MCP tool is disabled',
  MCP_ROLE_NOT_ALLOWED: 'MCP tool is not allowed for this role',
  MCP_APPROVAL_REQUIRED: 'MCP approval is required',
  MCP_APPROVAL_INVALID: 'MCP approval is invalid',
  MCP_APPROVAL_EXPIRED: 'MCP approval has expired',
  MCP_PREVIEW_STALE: 'MCP preview is stale',
  MCP_SCHEMA_UNSUPPORTED: 'MCP schema is outside the supported subset',
  MCP_CONNECTION_FAILED: 'MCP connection failed',
  MCP_PROTOCOL_ERROR: 'MCP protocol error',
  MCP_TOOL_ERROR: 'MCP tool execution failed',
  MCP_TOOL_TIMEOUT: 'MCP tool execution timed out',
  MCP_TOOL_CANCELLED: 'MCP tool execution was cancelled',
})

export const MCP_ERROR_HTTP_STATUS: Readonly<Record<McpErrorCode, number>> = Object.freeze({
  MCP_DISABLED: 409,
  MCP_CONFIG_INVALID: 400,
  MCP_SERVER_NOT_FOUND: 404,
  MCP_TOOL_NOT_FOUND: 404,
  MCP_SERVER_DISABLED: 409,
  MCP_TOOL_DISABLED: 409,
  MCP_ROLE_NOT_ALLOWED: 409,
  MCP_APPROVAL_REQUIRED: 409,
  MCP_APPROVAL_INVALID: 409,
  MCP_APPROVAL_EXPIRED: 409,
  MCP_PREVIEW_STALE: 409,
  MCP_SCHEMA_UNSUPPORTED: 422,
  MCP_CONNECTION_FAILED: 502,
  MCP_PROTOCOL_ERROR: 502,
  MCP_TOOL_ERROR: 502,
  MCP_TOOL_TIMEOUT: 504,
  MCP_TOOL_CANCELLED: 499,
})

export type McpSecurityErrorCode = Extract<
  McpErrorCode,
  | 'MCP_DISABLED'
  | 'MCP_CONFIG_INVALID'
  | 'MCP_APPROVAL_REQUIRED'
  | 'MCP_APPROVAL_INVALID'
  | 'MCP_APPROVAL_EXPIRED'
>

export const MCP_SECURITY_ERROR_MESSAGES: Readonly<Record<McpSecurityErrorCode, string>> = Object.freeze({
  MCP_DISABLED: MCP_ERROR_MESSAGES.MCP_DISABLED,
  MCP_CONFIG_INVALID: MCP_ERROR_MESSAGES.MCP_CONFIG_INVALID,
  MCP_APPROVAL_REQUIRED: MCP_ERROR_MESSAGES.MCP_APPROVAL_REQUIRED,
  MCP_APPROVAL_INVALID: MCP_ERROR_MESSAGES.MCP_APPROVAL_INVALID,
  MCP_APPROVAL_EXPIRED: MCP_ERROR_MESSAGES.MCP_APPROVAL_EXPIRED,
})

export class McpSecurityError extends Error {
  readonly code: McpSecurityErrorCode
  readonly httpStatus: number

  constructor(code: McpSecurityErrorCode) {
    super(`${code}: ${MCP_SECURITY_ERROR_MESSAGES[code]}`)
    this.name = 'McpSecurityError'
    this.code = code
    this.httpStatus = MCP_ERROR_HTTP_STATUS[code]
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isMcpSecurityError(error: unknown): error is McpSecurityError {
  return error instanceof McpSecurityError
}

export type McpStdioTransportConfig = {
  kind: 'stdio'
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
}

export type McpStreamableHttpTransportConfig = {
  kind: 'streamable_http'
  url: string | URL
  headers?: Readonly<Record<string, string>>
}

export type McpTransportConfig = McpStdioTransportConfig | McpStreamableHttpTransportConfig

export type McpServerConnectionConfig = {
  serverId: string
  name: string
  transport: McpTransportConfig
  configVersion: string
  catalogVersion?: string
  isEnabled?: boolean
  trustLevel?: McpTrustLevel
  secretRefs?: readonly string[]
}

export type DiscoveredMcpTool = {
  serverId?: string
  localName: string
  remoteName: string
  name?: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  schemaHash?: string
  schemaSupported?: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
}

export type McpServerTool = {
  id: string
  serverId: string
  remoteName: string
  name: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  schemaHash: string
  schemaSupported?: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
  isEnabled: boolean
  isRemoved: boolean
  requiresApproval: boolean
  riskLevel: McpRiskLevel
  discoveredAt: number
  updatedAt: number
  removedAt: number | null
}

export type McpPreviewDiffKind = 'added' | 'changed' | 'removed' | 'unchanged'

export type McpPreviewDiff = {
  kind: McpPreviewDiffKind
  remoteName: string
  toolId?: string
  before?: JsonSafeValue
  after?: JsonSafeValue
}

export type McpPreview = {
  previewId: string
  serverId: string
  previewHash: string
  configHash: string
  catalogVersion: string
  diff: readonly McpPreviewDiff[]
  createdAt: number
  expiresAt: number
}

export type McpApprovalRequest = {
  approvalRequestId: string
  runId: string
  serverId: string
  toolId: string
  inputHash: string
  catalogVersion: string
  sessionId: string
  role: string
  configVersion: string
  issuedAt: number
  expiresAt: number
  consumedAt: number | null
}

export type McpApprovalGrant = {
  approvalRequestId: string
  runId: string
  serverId: string
  toolId: string
  catalogVersion: string
  sessionId: string
  role: string
  configVersion: string
  consumedAt: number
}

export type NormalizedMcpResult = {
  content: readonly JsonSafeValue[]
  structuredContent?: JsonSafeValue
  isError: boolean
  truncated: boolean
  safeSummary?: string
}

export type McpToolRun = {
  id: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId?: string | null
  agentRole?: string | null
  status: McpRunStatus
  inputHash: string
  safeInput?: JsonSafeValue | null
  safeOutput?: NormalizedMcpResult | null
  errorCode?: McpErrorCode | null
  durationMs?: number | null
  createdAt: number
  completedAt?: number | null
}

export type McpToolExecutionContext = {
  runId: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId: string
  role: string
  catalogVersion: string
  configVersion: string
  approvalToken?: string
  signal?: AbortSignal
}

export type McpTransportSecurityState = {
  readonly configFingerprint: string
  readonly trustLevel: McpTrustLevel
  readonly isEnabled: boolean
}

export function createMcpToolId(serverId: string, remoteName: string): string {
  return `mcp:${serverId}:${remoteName}`
}
