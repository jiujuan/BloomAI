import { mcpRepo, type CreateMcpToolRunInput, type McpRunRecord, type UpdateMcpToolRunInput } from '../db/repositories/mcp.repo'
import { normalizeMcpResult } from './result-normalizer'
import type { JsonSafeValue, McpErrorCode, McpRunStatus, McpToolRun, NormalizedMcpResult } from './types'

export type McpRunAuditRepository = Pick<typeof mcpRepo, 'createRun' | 'updateRunStatus' | 'getRun'>

export type McpRunAuditOptions = {
  repository?: McpRunAuditRepository
  clock?: () => number
}

export type McpRunAuditStartInput = {
  id: string
  serverId: string
  toolId: string
  remoteName: string
  sessionId: string
  role: string
  status: Extract<McpRunStatus, 'pending_approval' | 'running'>
  inputHash: string
  input: unknown
  createdAt?: number
}

/**
 * The single persistence boundary for MCP execution audit records.
 *
 * It normalizes user/provider values before they reach the repository and keeps
 * timing/state-transition bookkeeping out of the capability policy code.
 */
export class McpRunAudit {
  private readonly repository: McpRunAuditRepository
  private readonly clock: () => number
  private readonly startedAt = new Map<string, number>()

  constructor(options: McpRunAuditOptions = {}) {
    this.repository = options.repository ?? mcpRepo
    this.clock = options.clock ?? (() => Date.now())
  }

  start(input: McpRunAuditStartInput): McpToolRun {
    const createdAt = input.createdAt ?? this.clock()
    const runInput: CreateMcpToolRunInput = {
      id: input.id,
      serverId: input.serverId,
      toolId: input.toolId,
      remoteName: input.remoteName,
      sessionId: input.sessionId,
      agentRole: input.role,
      status: input.status,
      inputHash: input.inputHash,
      safeInput: normalizeMcpAuditInput(input.input),
      createdAt,
      completedAt: null,
    }
    const run = this.repository.createRun(runInput)
    this.startedAt.set(run.id, run.createdAt)
    return run
  }

  get(runId: string): McpToolRun | undefined {
    return this.repository.getRun(runId)
  }

  markRunning(runId: string): McpToolRun {
    return this.transition(runId, {
      status: 'running',
    })
  }

  succeed(runId: string, result: unknown, completedAt = this.clock()): McpToolRun {
    const normalized = normalizeMcpResult(result)
    return this.transition(runId, {
      status: 'success',
      safeOutput: normalized,
      durationMs: this.duration(runId, completedAt),
      completedAt,
      errorCode: null,
    })
  }

  fail(
    runId: string,
    errorCode: McpErrorCode,
    result?: unknown,
    completedAt = this.clock(),
  ): McpToolRun {
    const update: UpdateMcpToolRunInput = {
      status: 'error',
      errorCode,
      durationMs: this.duration(runId, completedAt),
      completedAt,
    }
    if (result !== undefined) update.safeOutput = normalizeMcpResult(result)
    return this.transition(runId, update)
  }

  deny(
    runId: string,
    errorCode: McpErrorCode | null = null,
    completedAt = this.clock(),
  ): McpToolRun {
    return this.transition(runId, {
      status: 'denied',
      errorCode,
      durationMs: this.duration(runId, completedAt),
      completedAt,
    })
  }

  cancel(
    runId: string,
    completedAt = this.clock(),
  ): McpToolRun {
    return this.transition(runId, {
      status: 'cancelled',
      errorCode: 'MCP_TOOL_CANCELLED',
      durationMs: this.duration(runId, completedAt),
      completedAt,
    })
  }

  private transition(runId: string, input: UpdateMcpToolRunInput): McpToolRun {
    const run = this.repository.updateRunStatus(runId, input)
    if (isTerminal(run.status)) this.startedAt.delete(runId)
    return run
  }

  private duration(runId: string, completedAt: number): number {
    const started = this.startedAt.get(runId) ?? this.repository.getRun(runId)?.createdAt ?? completedAt
    return Math.max(0, completedAt - started)
  }
}

export function normalizeMcpAuditInput(input: unknown): JsonSafeValue | null {
  if (input === undefined || input === null) return null
  try {
    return normalizeMcpResult({ content: [input] }).content[0] ?? null
  } catch {
    // Audit must never persist a raw value merely because the caller supplied a
    // non-JSON object or a value outside the result boundary.
    return '[REDACTED]'
  }
}

export function normalizeMcpAuditOutput(input: unknown): NormalizedMcpResult {
  return normalizeMcpResult(input)
}

function isTerminal(status: McpRunStatus): boolean {
  return status === 'success'
    || status === 'error'
    || status === 'denied'
    || status === 'cancelled'
}
