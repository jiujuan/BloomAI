import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { McpApprovalGrant, McpApprovalRequest } from './types'
import { McpSecurityError } from './types'

const DEFAULT_APPROVAL_TTL_MS = 60_000
const MAX_APPROVAL_TTL_MS = 5 * 60_000

type ApprovalIdentity = {
  runId: string
  serverId: string
  toolId: string
  catalogVersion: string
  sessionId: string
  role: string
  configVersion: string
}

export type ApprovalIssueInput = ApprovalIdentity & {
  input: unknown
  ttlMs?: number
}

export type ApprovalConsumeInput = ApprovalIdentity & {
  input: unknown
}

export type ApprovalIssue = {
  token: string
  request: McpApprovalRequest
}

type StoredApproval = McpApprovalRequest & {
  tokenHash: string
}

export function hashMcpApprovalInput(input: unknown): string {
  return createHash('sha256').update(stableJson(input), 'utf8').digest('hex')
}

export class InMemoryApprovalStore {
  private readonly records = new Map<string, StoredApproval>()
  private readonly tokenToRequestId = new Map<string, string>()
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  issue(input: ApprovalIssueInput): ApprovalIssue {
    assertIdentity(input)
    const issuedAt = this.now()
    const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_APPROVAL_TTL_MS) {
      throw new McpSecurityError('MCP_CONFIG_INVALID')
    }

    const approvalRequestId = randomUUID()
    const token = `mcp.approval.v1.${randomBytes(32).toString('base64url')}`
    const request: McpApprovalRequest = {
      approvalRequestId,
      runId: input.runId,
      serverId: input.serverId,
      toolId: input.toolId,
      inputHash: hashMcpApprovalInput(input.input),
      catalogVersion: input.catalogVersion,
      sessionId: input.sessionId,
      role: input.role,
      configVersion: input.configVersion,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      consumedAt: null,
    }
    const stored: StoredApproval = {
      ...request,
      tokenHash: hashToken(token),
    }
    this.records.set(approvalRequestId, stored)
    this.tokenToRequestId.set(stored.tokenHash, approvalRequestId)
    return { token, request: cloneRequest(request) }
  }

  consume(token: string | undefined, input: ApprovalConsumeInput): McpApprovalGrant {
    if (!token) throw new McpSecurityError('MCP_APPROVAL_REQUIRED')
    const requestId = this.tokenToRequestId.get(hashToken(token))
    if (!requestId) throw new McpSecurityError('MCP_APPROVAL_INVALID')
    const request = this.records.get(requestId)
    if (!request) throw new McpSecurityError('MCP_APPROVAL_INVALID')
    if (request.consumedAt !== null) throw new McpSecurityError('MCP_APPROVAL_INVALID')
    if (this.now() >= request.expiresAt) throw new McpSecurityError('MCP_APPROVAL_EXPIRED')
    if (!matches(request, input)) throw new McpSecurityError('MCP_APPROVAL_INVALID')

    const consumedAt = this.now()
    request.consumedAt = consumedAt
    return {
      approvalRequestId: request.approvalRequestId,
      runId: request.runId,
      serverId: request.serverId,
      toolId: request.toolId,
      catalogVersion: request.catalogVersion,
      sessionId: request.sessionId,
      role: request.role,
      configVersion: request.configVersion,
      consumedAt,
    }
  }

  get(approvalRequestId: string): McpApprovalRequest | undefined {
    const request = this.records.get(approvalRequestId)
    return request ? cloneRequest(request) : undefined
  }

  /**
   * Marks a pending request as rejected without exposing or accepting the
   * opaque approval token. Approval/Deny callers only receive a safe snapshot.
   */
  deny(approvalRequestId: string): McpApprovalRequest {
    const request = this.records.get(approvalRequestId)
    if (!request || request.consumedAt !== null) {
      throw new McpSecurityError('MCP_APPROVAL_INVALID')
    }
    if (this.now() >= request.expiresAt) {
      throw new McpSecurityError('MCP_APPROVAL_EXPIRED')
    }
    request.consumedAt = this.now()
    return cloneRequest(request)
  }

  invalidateByConfigVersion(serverId: string, oldConfigVersion: string, _newConfigVersion: string): number {
    const invalidatedAt = this.now()
    let count = 0
    for (const request of this.records.values()) {
      if (request.serverId === serverId && request.configVersion === oldConfigVersion && request.consumedAt === null) {
        request.consumedAt = invalidatedAt
        count += 1
      }
    }
    return count
  }

  purgeExpired(now = this.now()): number {
    let count = 0
    for (const [requestId, request] of this.records) {
      if (request.consumedAt === null && request.expiresAt <= now) {
        this.records.delete(requestId)
        this.tokenToRequestId.delete(request.tokenHash)
        count += 1
      }
    }
    return count
  }
}

function matches(request: StoredApproval, input: ApprovalConsumeInput): boolean {
  return request.runId === input.runId
    && request.serverId === input.serverId
    && request.toolId === input.toolId
    && request.catalogVersion === input.catalogVersion
    && request.sessionId === input.sessionId
    && request.role === input.role
    && request.configVersion === input.configVersion
    && request.inputHash === hashMcpApprovalInput(input.input)
}

function assertIdentity(input: ApprovalIdentity): void {
  const values = [input.runId, input.serverId, input.toolId, input.catalogVersion, input.sessionId, input.role, input.configVersion]
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function cloneRequest(request: McpApprovalRequest | StoredApproval): McpApprovalRequest {
  const { tokenHash: _tokenHash, ...snapshot } = request as StoredApproval
  return snapshot
}

function stableJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new McpSecurityError('MCP_CONFIG_INVALID')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new McpSecurityError('MCP_CONFIG_INVALID')
  if (seen.has(value)) throw new McpSecurityError('MCP_CONFIG_INVALID')
  seen.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, seen)).join(',')}]`
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new McpSecurityError('MCP_CONFIG_INVALID')
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`).join(',')}}`
  } finally {
    seen.delete(value)
  }
}
