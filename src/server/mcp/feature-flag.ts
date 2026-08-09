import { McpSecurityError } from './types'

export const MCP_CLIENT_ENABLED = 'MCP_CLIENT_ENABLED' as const

export type EnvironmentLike = Readonly<Record<string, string | undefined>>

export function isMcpClientEnabled(env: EnvironmentLike = process.env): boolean {
  return env[MCP_CLIENT_ENABLED] === 'true'
}

export function assertMcpClientEnabled(env: EnvironmentLike = process.env): true {
  if (!isMcpClientEnabled(env)) throw new McpSecurityError('MCP_DISABLED')
  return true
}
