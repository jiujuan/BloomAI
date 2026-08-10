import { describe, expect, it } from 'vitest'
import {
  MCP_CLIENT_ENABLED,
  assertMcpClientEnabled,
  isMcpClientEnabled,
} from '../feature-flag'
import { McpSecurityError } from '../types'

describe('MCP feature flag contract', () => {
  it('fails closed unless the flag is exactly true', () => {
    expect(MCP_CLIENT_ENABLED).toBe('MCP_CLIENT_ENABLED')
    expect(isMcpClientEnabled({ MCP_CLIENT_ENABLED: 'true' })).toBe(true)
    expect(isMcpClientEnabled({ MCP_CLIENT_ENABLED: 'TRUE' })).toBe(false)
    expect(isMcpClientEnabled({ MCP_CLIENT_ENABLED: '1' })).toBe(false)
    expect(isMcpClientEnabled({})).toBe(false)

    expect(() => assertMcpClientEnabled({ MCP_CLIENT_ENABLED: 'false' }))
      .toThrowError(new McpSecurityError('MCP_DISABLED'))
    expect(assertMcpClientEnabled({ MCP_CLIENT_ENABLED: 'true' })).toBe(true)
  })

  it('does not expose environment values in the disabled error', () => {
    const secret = 'feature-flag-secret-that-must-not-leak'
    try {
      assertMcpClientEnabled({ MCP_CLIENT_ENABLED: 'false', API_TOKEN: secret })
    } catch (error) {
      expect(error).toBeInstanceOf(McpSecurityError)
      expect(String(error)).not.toContain(secret)
    }
  })
})
