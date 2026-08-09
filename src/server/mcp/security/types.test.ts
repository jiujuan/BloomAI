import { describe, expect, it } from 'vitest'
import { isMcpSecurityError, McpSecurityError } from '../types'

describe('MCP Task 1 security error contract', () => {
  it('uses stable public error codes and safe messages', () => {
    const error = new McpSecurityError('MCP_CONFIG_INVALID')
    expect(error.code).toBe('MCP_CONFIG_INVALID')
    expect(error.message).toContain('MCP_CONFIG_INVALID')
    expect(isMcpSecurityError(error)).toBe(true)
    expect(isMcpSecurityError(new Error('other'))).toBe(false)
  })
})
