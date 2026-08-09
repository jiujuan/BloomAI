export type McpSecurityErrorCode =
  | 'MCP_DISABLED'
  | 'MCP_CONFIG_INVALID'
  | 'MCP_APPROVAL_REQUIRED'
  | 'MCP_APPROVAL_INVALID'
  | 'MCP_APPROVAL_EXPIRED'

export const MCP_SECURITY_ERROR_MESSAGES: Readonly<Record<McpSecurityErrorCode, string>> = Object.freeze({
  MCP_DISABLED: 'MCP client is disabled',
  MCP_CONFIG_INVALID: 'MCP configuration is invalid',
  MCP_APPROVAL_REQUIRED: 'MCP approval is required',
  MCP_APPROVAL_INVALID: 'MCP approval is invalid',
  MCP_APPROVAL_EXPIRED: 'MCP approval has expired',
})

export class McpSecurityError extends Error {
  readonly code: McpSecurityErrorCode

  constructor(code: McpSecurityErrorCode) {
    super(`${code}: ${MCP_SECURITY_ERROR_MESSAGES[code]}`)
    this.name = 'McpSecurityError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isMcpSecurityError(error: unknown): error is McpSecurityError {
  return error instanceof McpSecurityError
}

export type McpTrustLevel = 'untrusted' | 'reviewed' | 'trusted'

export type McpTransportSecurityState = {
  readonly configFingerprint: string
  readonly trustLevel: McpTrustLevel
  readonly isEnabled: boolean
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
