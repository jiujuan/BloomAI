import {
  MCP_ERROR_CODES,
  MCP_ERROR_HTTP_STATUS,
  MCP_ERROR_MESSAGES,
  isMcpSecurityError,
  type McpErrorCode,
  type McpSecurityError,
} from './types'
import { McpSecurityError as McpSecurityErrorClass } from './types'

export {
  MCP_ERROR_CODES,
  MCP_ERROR_HTTP_STATUS,
  MCP_ERROR_MESSAGES,
} from './types'
export type { McpErrorCode } from './types'

export type McpErrorOptions = {
  cause?: unknown
}

export class McpError extends Error {
  readonly code: McpErrorCode
  readonly httpStatus: number
  readonly statusCode: number

  constructor(code: McpErrorCode, options: McpErrorOptions = {}) {
    super(
      `${code}: ${MCP_ERROR_MESSAGES[code]}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'McpError'
    this.code = code
    this.httpStatus = MCP_ERROR_HTTP_STATUS[code]
    this.statusCode = this.httpStatus
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isMcpError(
  error: unknown,
): error is McpError | McpSecurityError {
  if (error instanceof McpError || error instanceof McpSecurityErrorClass || isMcpSecurityError(error)) {
    return true
  }
  if (!isRecord(error) || !isKnownMcpErrorCode(error.code)) return false
  return typeof error.message === 'string'
}

export type McpErrorResponse = {
  status: number
  error: {
    code: McpErrorCode
    message: string
  }
}

export function toMcpErrorResponse(error: unknown): McpErrorResponse {
  const code = getMcpErrorCode(error) ?? 'MCP_PROTOCOL_ERROR'
  return {
    status: MCP_ERROR_HTTP_STATUS[code],
    error: {
      code,
      message: MCP_ERROR_MESSAGES[code],
    },
  }
}

export const toSafeMcpErrorResponse = toMcpErrorResponse

export function getMcpErrorCode(error: unknown): McpErrorCode | undefined {
  if (error instanceof McpError || error instanceof McpSecurityErrorClass || isMcpSecurityError(error)) {
    return error.code
  }
  if (!isRecord(error) || !isKnownMcpErrorCode(error.code)) return undefined
  return error.code
}

function isKnownMcpErrorCode(value: unknown): value is McpErrorCode {
  return typeof value === 'string' && (MCP_ERROR_CODES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
