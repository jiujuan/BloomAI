import { describe, expect, it } from 'vitest'
import { McpSecurityError } from './types'
import {
  McpError,
  isMcpError,
  toMcpErrorResponse,
} from './errors'

describe('MCP stable error protocol', () => {
  it('exposes a stable code, status, and non-sensitive message', () => {
    const error = new McpError('MCP_TOOL_TIMEOUT', {
      cause: new Error('authorization=super-secret should not escape'),
    })

    expect(error.code).toBe('MCP_TOOL_TIMEOUT')
    expect(error.httpStatus).toBe(504)
    expect(error.message).toBe('MCP_TOOL_TIMEOUT: MCP tool execution timed out')
    expect(error.message).not.toContain('super-secret')
    expect(isMcpError(error)).toBe(true)
  })

  it('treats the Task 1 security error as part of the same protocol', () => {
    const error = new McpSecurityError('MCP_APPROVAL_REQUIRED')

    expect(isMcpError(error)).toBe(true)
    expect(toMcpErrorResponse(error)).toEqual({
      status: 409,
      error: {
        code: 'MCP_APPROVAL_REQUIRED',
        message: 'MCP approval is required',
      },
    })
  })

  it('maps unknown failures to a safe protocol error without leaking details', () => {
    const response = toMcpErrorResponse(new Error('token=super-secret'))

    expect(response).toEqual({
      status: 502,
      error: {
        code: 'MCP_PROTOCOL_ERROR',
        message: 'MCP protocol error',
      },
    })
    expect(JSON.stringify(response)).not.toContain('super-secret')
  })
})
