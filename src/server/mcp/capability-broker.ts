import { randomUUID } from 'node:crypto'
import { mcpRepo, type McpServerRecord, type McpToolRecord } from '../db/repositories/mcp.repo'
import { InMemoryApprovalStore, hashMcpApprovalInput, type ApprovalIssue } from './approval-store'
import { McpConnectionManager } from './connection-manager'
import { McpError } from './errors'
import { McpSecurityError } from './types'
import { isMcpClientEnabled, type EnvironmentLike } from './feature-flag'
import { hashMcpConfig } from './catalog-hash'
import { McpRunAudit } from './run-audit'
import { normalizeMcpResult } from './result-normalizer'
import type {
  JsonSafeObject,
  JsonSafeValue,
  McpErrorCode,
  McpServerConnectionConfig,
  McpToolRun,
  McpTrustLevel,
  McpRiskLevel,
  NormalizedMcpResult,
} from './types'
import type { McpExecuteOptions } from './provider'

export type McpCapabilityRepository = Pick<
  typeof mcpRepo,
  'getServer' | 'getTool' | 'createRun' | 'updateRunStatus' | 'getRun'
>

export type McpRoleResolverInput = {
  sessionId: string
  requestedRole?: string
}

export type McpRoleResolver = (input: McpRoleResolverInput) => string

export type McpRolePolicyInput = {
  role: string
  server: McpServerRecord
  tool: McpToolRecord
}

export type McpRolePolicy = (input: McpRolePolicyInput) => boolean

export type McpBrokerExecuteInput = {
  serverId: string
  toolId: string
  input: unknown
  sessionId: string
  role?: string
  runId?: string
  approvalToken?: string
  signal?: AbortSignal
  timeoutMs?: number
  caller?: 'agent' | 'manual_test' | 'approval'
}

export type McpBrokerSuccess = {
  status: 'success'
  result: NormalizedMcpResult
  run: McpToolRun
}

export type McpBrokerDenied = {
  status: 'denied'
  run: McpToolRun
}

export type McpBrokerCancelled = {
  status: 'cancelled'
  run: McpToolRun
}

export type McpApprovalPreview = {
  serverId: string
  toolId: string
  remoteName: string
  toolName: string
  riskLevel: McpRiskLevel
  trustLevel: McpTrustLevel
  catalogVersion: string
  safeInput: JsonSafeValue | null
}

export type McpApprovalRequiredDetails = {
  approvalRequestId: string
  runId: string
  expiresAt: number
  preview: McpApprovalPreview
}

/**
 * Safe, structured signal that the caller must use the approval endpoint.
 * The opaque token is deliberately not included in this error or its details.
 */
export class McpApprovalRequiredError extends McpSecurityError {
  readonly details: McpApprovalRequiredDetails

  constructor(details: McpApprovalRequiredDetails) {
    super('MCP_APPROVAL_REQUIRED')
    this.name = 'McpApprovalRequiredError'
    this.details = freezeApprovalDetails(details)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

type PendingApproval = {
  token: string
  input: McpBrokerExecuteInput
  request: McpApprovalRequiredDetails & {
    catalogVersion: string
    sessionId: string
    role: string
    configVersion: string
  }
}

type PreparedContext = {
  server: McpServerRecord
  tool: McpToolRecord
  role: string
  config: McpServerConnectionConfig
  configVersion: string
  catalogVersion: string
}

export type McpCapabilityBrokerOptions = {
  repository?: McpCapabilityRepository
  connectionManager: Pick<McpConnectionManager, 'executeTool'>
  approvalStore?: InMemoryApprovalStore
  audit?: McpRunAudit
  env?: EnvironmentLike
  clock?: () => number
  idFactory?: () => string
  roleResolver?: McpRoleResolver
  rolePolicy?: McpRolePolicy
  approvalTtlMs?: number
}

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|apikey|credential|privatekey)/i

/**
 * The only application-level entry point for MCP Tool execution.
 *
 * This class intentionally knows nothing about Mastra objects. It re-reads all
 * authorization inputs from the repository, owns approval replay protection,
 * and writes the Run audit before a provider call can happen.
 */
export class McpCapabilityBroker {
  private readonly repository: McpCapabilityRepository
  private readonly connectionManager: Pick<McpConnectionManager, 'executeTool'>
  private readonly approvalStore: InMemoryApprovalStore
  private readonly audit: McpRunAudit
  private readonly env: EnvironmentLike
  private readonly clock: () => number
  private readonly idFactory: () => string
  private readonly roleResolver: McpRoleResolver
  private readonly rolePolicy: McpRolePolicy
  private readonly approvalTtlMs?: number
  private readonly pendingApprovals = new Map<string, PendingApproval>()

  constructor(options: McpCapabilityBrokerOptions) {
    this.repository = options.repository ?? mcpRepo
    this.connectionManager = options.connectionManager
    this.approvalStore = options.approvalStore ?? new InMemoryApprovalStore({ now: options.clock })
    this.clock = options.clock ?? (() => Date.now())
    this.audit = options.audit ?? new McpRunAudit({ repository: options.repository ?? mcpRepo, clock: this.clock })
    this.env = options.env ?? process.env
    this.idFactory = options.idFactory ?? randomUUID
    this.roleResolver = options.roleResolver ?? defaultRoleResolver
    this.rolePolicy = options.rolePolicy ?? (() => true)
    this.approvalTtlMs = options.approvalTtlMs
  }

  async execute(input: McpBrokerExecuteInput): Promise<McpBrokerSuccess> {
    const normalized = normalizeExecuteInput(input)
    const runId = normalized.runId ?? this.idFactory()

    // Check the global gate before parsing or resolving any server config. A
    // disabled client must fail closed even when a caller supplies malformed
    // or otherwise attacker-controlled connection data.
    if (!isMcpClientEnabled(this.env)) {
      const error = new McpError('MCP_DISABLED')
      const server = this.repository.getServer(normalized.serverId)
      const tool = this.repository.getTool(normalized.toolId)
      if (server && tool && tool.serverId === server.id) {
        const run = this.startDeniedRun(normalized, runId, defaultRole(), error)
        throwWithRun(error, run)
      }
      throw error
    }

    const prepared = this.prepareOrThrow(normalized)

    if (!prepared.ok) {
      const run = this.startDeniedRun(normalized, runId, prepared.role, prepared.error)
      throwWithRun(prepared.error, run)
    }

    const context = prepared.context
    let inputHash: string
    try {
      inputHash = hashMcpApprovalInput(normalized.input)
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_CONFIG_INVALID')
      const run = this.startDeniedRun(normalized, runId, context.role, mapped, context)
      throwWithRun(mapped, run)
    }

    const policyError = this.validatePolicy(context, normalized)
    if (policyError) {
      if (policyError.code === 'MCP_TOOL_CANCELLED') {
        const pending = this.audit.start({
          id: runId,
          serverId: context.server.id,
          toolId: context.tool.id,
          remoteName: context.tool.remoteName,
          sessionId: normalized.sessionId,
          role: context.role,
          status: 'pending_approval',
          inputHash: safeInputHash(normalized.input),
          input: normalized.input,
          createdAt: this.clock(),
        })
        const cancelled = this.audit.cancel(pending.id, this.clock())
        throwWithRun(policyError, cancelled)
      }
      const run = this.startDeniedRun(normalized, runId, context.role, policyError, context)
      throwWithRun(policyError, run)
    }

    if (normalized.approvalToken !== undefined) {
      return this.executeWithApprovalToken(normalized, context, runId)
    }

    if (mustApprove(context, normalized.input)) {
      throw this.issueApproval(normalized, context, runId, inputHash)
    }

    const run = this.audit.start({
      id: runId,
      serverId: context.server.id,
      toolId: context.tool.id,
      remoteName: context.tool.remoteName,
      sessionId: normalized.sessionId,
      role: context.role,
      status: 'running',
      inputHash,
      input: normalized.input,
      createdAt: this.clock(),
    })
    return this.executeRemote(normalized, context, run)
  }

  async approve(
    approvalRequestId: string,
    options: Pick<McpBrokerExecuteInput, 'signal' | 'timeoutMs'> = {},
  ): Promise<McpBrokerSuccess> {
    if (!isNonEmptyString(approvalRequestId)) throw new McpError('MCP_APPROVAL_INVALID')
    const pending = this.pendingApprovals.get(approvalRequestId)
    const request = this.approvalStore.get(approvalRequestId)
    if (!pending || !request || request.consumedAt !== null) {
      throw new McpError(request && this.clock() >= request.expiresAt ? 'MCP_APPROVAL_EXPIRED' : 'MCP_APPROVAL_INVALID')
    }

    const input: McpBrokerExecuteInput = {
      ...pending.input,
      runId: request.runId,
      approvalToken: pending.token,
      caller: 'approval',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }
    try {
      return await this.execute(input)
    } finally {
      this.pendingApprovals.delete(approvalRequestId)
    }
  }

  async deny(approvalRequestId: string): Promise<McpBrokerDenied> {
    const request = this.approvalStore.get(approvalRequestId)
    if (!request) throw new McpError('MCP_APPROVAL_INVALID')

    const server = this.repository.getServer(request.serverId)
    const tool = this.repository.getTool(request.toolId)
    if (!server || !tool || tool.serverId !== server.id) throw new McpError('MCP_APPROVAL_INVALID')

    try {
      this.approvalStore.deny(approvalRequestId)
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_APPROVAL_INVALID')
      const run = this.getOrCreatePendingRun(request, server, tool)
      this.pendingApprovals.delete(approvalRequestId)
      if (run.status === 'pending_approval') {
        const denied = this.audit.deny(run.id, mapped.code)
        throwWithRun(mapped, denied)
      }
      throw mapped
    }

    const run = this.getOrCreatePendingRun(request, server, tool)
    this.pendingApprovals.delete(approvalRequestId)
    if (run.status !== 'pending_approval') throw new McpError('MCP_APPROVAL_INVALID')
    const denied = this.audit.deny(run.id)
    return { status: 'denied', run: denied }
  }

  async cancel(approvalRequestId: string): Promise<McpBrokerCancelled> {
    const request = this.approvalStore.get(approvalRequestId)
    if (!request) throw new McpError('MCP_APPROVAL_INVALID')
    const server = this.repository.getServer(request.serverId)
    const tool = this.repository.getTool(request.toolId)
    if (!server || !tool || tool.serverId !== server.id) throw new McpError('MCP_APPROVAL_INVALID')

    try {
      this.approvalStore.deny(approvalRequestId)
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_APPROVAL_INVALID')
      const run = this.getOrCreatePendingRun(request, server, tool)
      this.pendingApprovals.delete(approvalRequestId)
      if (run.status === 'pending_approval') {
        const cancelled = this.audit.cancel(run.id)
        throwWithRun(mapped, cancelled)
      }
      throw mapped
    }

    const run = this.getOrCreatePendingRun(request, server, tool)
    this.pendingApprovals.delete(approvalRequestId)
    if (run.status !== 'pending_approval') throw new McpError('MCP_APPROVAL_INVALID')
    const cancelled = this.audit.cancel(run.id)
    return { status: 'cancelled', run: cancelled }
  }

  private prepareOrThrow(input: McpBrokerExecuteInput):
    | { ok: true; context: PreparedContext }
    | { ok: false; role: string; error: McpError } {
    const server = this.repository.getServer(input.serverId)
    const tool = this.repository.getTool(input.toolId)
    const fallbackRole = defaultRole()
    if (!server) return { ok: false, role: fallbackRole, error: new McpError('MCP_SERVER_NOT_FOUND') }
    if (!tool || tool.serverId !== server.id || tool.id !== input.toolId) {
      return { ok: false, role: fallbackRole, error: new McpError('MCP_TOOL_NOT_FOUND') }
    }

    let role: string
    try {
      role = normalizeRole(this.roleResolver({ sessionId: input.sessionId, requestedRole: input.role }))
    } catch (error) {
      return { ok: false, role: fallbackRole, error: mapBrokerError(error, 'MCP_ROLE_NOT_ALLOWED') }
    }

    try {
      const connection = createConnectionConfig(server)
      return {
        ok: true,
        context: {
          server,
          tool,
          role,
          config: connection.config,
          configVersion: connection.configVersion,
          catalogVersion: String(server.catalogVersion),
        },
      }
    } catch (error) {
      return { ok: false, role, error: mapBrokerError(error, 'MCP_CONFIG_INVALID') }
    }
  }

  private validatePolicy(context: PreparedContext, input: McpBrokerExecuteInput): McpError | undefined {
    if (context.server.isEnabled !== true) return new McpError('MCP_SERVER_DISABLED')
    if (context.tool.isEnabled !== true || context.tool.isRemoved === true) return new McpError('MCP_TOOL_DISABLED')
    if (context.tool.schemaSupported === false) return new McpError('MCP_SCHEMA_UNSUPPORTED')
    try {
      if (!this.rolePolicy({ role: context.role, server: context.server, tool: context.tool })) {
        return new McpError('MCP_ROLE_NOT_ALLOWED')
      }
    } catch {
      return new McpError('MCP_ROLE_NOT_ALLOWED')
    }
    if (input.signal?.aborted) return new McpError('MCP_TOOL_CANCELLED')
    return undefined
  }

  private issueApproval(
    input: McpBrokerExecuteInput,
    context: PreparedContext,
    runId: string,
    inputHash: string,
  ): McpApprovalRequiredError {
    const safeInput = safeAuditInput(input.input)
    const run = this.audit.start({
      id: runId,
      serverId: context.server.id,
      toolId: context.tool.id,
      remoteName: context.tool.remoteName,
      sessionId: input.sessionId,
      role: context.role,
      status: 'pending_approval',
      inputHash,
      input: input.input,
      createdAt: this.clock(),
    })
    let issue: ApprovalIssue
    try {
      issue = this.approvalStore.issue({
        runId: run.id,
        serverId: context.server.id,
        toolId: context.tool.id,
        input: input.input,
        catalogVersion: context.catalogVersion,
        sessionId: input.sessionId,
        role: context.role,
        configVersion: context.configVersion,
        ttlMs: this.approvalTtlMs,
      })
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_CONFIG_INVALID')
      const denied = this.audit.deny(run.id, mapped.code, this.clock())
      throwWithRun(mapped, denied)
    }
    const details: McpApprovalRequiredDetails = {
      approvalRequestId: issue.request.approvalRequestId,
      runId: run.id,
      expiresAt: issue.request.expiresAt,
      preview: {
        serverId: context.server.id,
        toolId: context.tool.id,
        remoteName: context.tool.remoteName,
        toolName: context.tool.name,
        riskLevel: context.tool.riskLevel,
        trustLevel: context.server.trustLevel,
        catalogVersion: context.catalogVersion,
        safeInput,
      },
    }
    this.pendingApprovals.set(issue.request.approvalRequestId, {
      token: issue.token,
      input: {
        ...input,
        approvalToken: undefined,
      },
      request: {
        ...details,
        catalogVersion: context.catalogVersion,
        sessionId: input.sessionId,
        role: context.role,
        configVersion: context.configVersion,
      },
    })
    return new McpApprovalRequiredError(details)
  }

  private async executeWithApprovalToken(
    input: McpBrokerExecuteInput,
    context: PreparedContext,
    runId: string,
  ): Promise<McpBrokerSuccess> {
    const pendingRun = this.getOrCreatePendingRunFromContext(input, context, runId)
    if (pendingRun.status !== 'pending_approval') {
      throw new McpError('MCP_APPROVAL_INVALID')
    }
    let grant
    try {
      grant = this.approvalStore.consume(input.approvalToken, {
        runId,
        serverId: context.server.id,
        toolId: context.tool.id,
        input: input.input,
        catalogVersion: context.catalogVersion,
        sessionId: input.sessionId,
        role: context.role,
        configVersion: context.configVersion,
      })
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_APPROVAL_INVALID')
      if (mapped.code !== 'MCP_APPROVAL_EXPIRED') this.tryInvalidateApproval(input.approvalToken)
      const denied = this.audit.deny(pendingRun.id, mapped.code)
      throwWithRun(mapped, denied)
    }

    if (grant.runId !== pendingRun.id) {
      const error = new McpError('MCP_APPROVAL_INVALID')
      const denied = this.audit.deny(pendingRun.id, error.code)
      throwWithRun(error, denied)
    }

    const running = this.audit.markRunning(pendingRun.id)
    return this.executeRemote(input, context, running)
  }

  private async executeRemote(
    input: McpBrokerExecuteInput,
    context: PreparedContext,
    run: McpToolRun,
  ): Promise<McpBrokerSuccess> {
    const signal = input.signal ?? new AbortController().signal
    const options: McpExecuteOptions = {
      mode: 'cached',
      signal,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    }

    if (signal.aborted) {
      const error = new McpError('MCP_TOOL_CANCELLED')
      const cancelled = this.audit.cancel(run.id)
      throwWithRun(error, cancelled)
    }

    try {
      const remoteResult = await this.connectionManager.executeTool(
        context.config,
        context.tool.remoteName,
        input.input,
        options,
      )
      const result = normalizeMcpResult(remoteResult)
      const completed = this.audit.succeed(run.id, result, this.clock())
      return { status: 'success', result, run: completed }
    } catch (error) {
      const mapped = mapBrokerError(error, 'MCP_TOOL_ERROR')
      if (mapped.code === 'MCP_TOOL_CANCELLED') {
        const cancelled = this.audit.cancel(run.id, this.clock())
        throwWithRun(mapped, cancelled)
      }
      const failed = this.audit.fail(run.id, mapped.code, undefined, this.clock())
      throwWithRun(mapped, failed)
    }
  }

  private startDeniedRun(
    input: McpBrokerExecuteInput,
    runId: string,
    role: string,
    error: McpError,
    context?: PreparedContext,
  ): McpToolRun {
    const existing = this.audit.get(runId)
    if (existing) {
      if (existing.status === 'pending_approval') return this.audit.deny(existing.id, error.code)
      return existing
    }

    const server = context?.server ?? this.repository.getServer(input.serverId)
    const tool = context?.tool ?? this.repository.getTool(input.toolId)
    if (!server || !tool || tool.serverId !== server.id) throw error
    const run = this.audit.start({
      id: runId,
      serverId: server.id,
      toolId: tool.id,
      remoteName: tool.remoteName,
      sessionId: input.sessionId,
      role,
      status: 'pending_approval',
      inputHash: safeInputHash(input.input),
      input: input.input,
      createdAt: this.clock(),
    })
    return this.audit.deny(run.id, error.code)
  }

  private getOrCreatePendingRunFromContext(
    input: McpBrokerExecuteInput,
    context: PreparedContext,
    runId: string,
  ): McpToolRun {
    const current = this.audit.get(runId)
    if (current) return current
    return this.audit.start({
      id: runId,
      serverId: context.server.id,
      toolId: context.tool.id,
      remoteName: context.tool.remoteName,
      sessionId: input.sessionId,
      role: context.role,
      status: 'pending_approval',
      inputHash: safeInputHash(input.input),
      input: input.input,
      createdAt: this.clock(),
    })
  }

  private getOrCreatePendingRun(
    request: { id?: string; runId: string; serverId: string; toolId: string; sessionId: string; role: string; inputHash: string },
    server: McpServerRecord,
    tool: McpToolRecord,
  ): McpToolRun {
    const current = this.audit.get(request.runId)
    if (current) return current
    return this.audit.start({
      id: request.runId,
      serverId: server.id,
      toolId: tool.id,
      remoteName: tool.remoteName,
      sessionId: request.sessionId,
      role: request.role,
      status: 'pending_approval',
      inputHash: request.inputHash,
      input: null,
      createdAt: this.clock(),
    })
  }

  private tryInvalidateApproval(token: string | undefined): void {
    if (!token) return
    try {
      const request = this.findRequestForToken(token)
      if (request) this.approvalStore.deny(request.approvalRequestId)
    } catch {
      // An expired approval is already unusable; never let cleanup mask the
      // stable error that explains why the remote call was denied.
    }
  }

  private findRequestForToken(_token: string): { approvalRequestId: string } | undefined {
    // Tokens are intentionally opaque. The broker only has request IDs for its
    // own pending approvals, so iterate the private pending map rather than
    // adding a token lookup API that could leak token material to callers.
    for (const [approvalRequestId, pending] of this.pendingApprovals) {
      if (pending.token === _token) return { approvalRequestId }
    }
    return undefined
  }
}

function normalizeExecuteInput(input: McpBrokerExecuteInput): McpBrokerExecuteInput {
  if (!input || typeof input !== 'object') throw new McpError('MCP_CONFIG_INVALID')
  for (const value of [input.serverId, input.toolId, input.sessionId]) {
    if (!isNonEmptyString(value)) throw new McpError('MCP_CONFIG_INVALID')
  }
  if (input.role !== undefined && !isNonEmptyString(input.role)) throw new McpError('MCP_CONFIG_INVALID')
  if (input.runId !== undefined && !isNonEmptyString(input.runId)) throw new McpError('MCP_CONFIG_INVALID')
  if (input.approvalToken !== undefined && !isNonEmptyString(input.approvalToken)) throw new McpError('MCP_APPROVAL_INVALID')
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new McpError('MCP_CONFIG_INVALID')
  }
  return input
}

function defaultRoleResolver(_input: McpRoleResolverInput): string {
  // Role is a server-owned authorization fact. A caller-provided value may be
  // passed as a hint to an injected server resolver, but the safe default must
  // never promote caller input into an authorization role.
  return defaultRole()
}

function defaultRole(): string {
  return 'general'
}

function normalizeRole(role: string): string {
  if (!isNonEmptyString(role)) throw new McpError('MCP_ROLE_NOT_ALLOWED')
  return role
}

function createConnectionConfig(server: McpServerRecord): { config: McpServerConnectionConfig; configVersion: string } {
  const parsed = parseJsonObject(server.configJson)
  const configVersion = hashMcpConfig({
    serverId: server.id,
    name: server.name,
    transportKind: server.transportKind,
    config: parsed,
    secretRefs: server.secretRefs,
  })
  const transport = server.transportKind === 'stdio'
    ? toStdioTransport(parsed)
    : server.transportKind === 'streamable_http'
      ? toHttpTransport(parsed)
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  return {
    config: {
      serverId: server.id,
      name: server.name,
      transport,
      configVersion,
      catalogVersion: String(server.catalogVersion),
      isEnabled: server.isEnabled,
      trustLevel: server.trustLevel,
      secretRefs: server.secretRefs,
    },
    configVersion,
  }
}

function parseJsonObject(value: string): JsonSafeObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new McpError('MCP_CONFIG_INVALID', { cause: error })
  }
  if (!isJsonSafeObject(parsed)) throw new McpError('MCP_CONFIG_INVALID')
  return parsed
}

function toStdioTransport(config: JsonSafeObject): McpServerConnectionConfig['transport'] {
  if (typeof config.command !== 'string' || !config.command.trim()) throw new McpError('MCP_CONFIG_INVALID')
  const args = config.args === undefined
    ? undefined
    : Array.isArray(config.args) && config.args.every((value) => typeof value === 'string')
      ? config.args
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  const env = config.env === undefined
    ? undefined
    : isStringRecord(config.env)
      ? config.env
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  if (config.cwd !== undefined && typeof config.cwd !== 'string') throw new McpError('MCP_CONFIG_INVALID')
  return {
    kind: 'stdio',
    command: config.command,
    ...(args === undefined ? {} : { args }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    ...(env === undefined ? {} : { env }),
  }
}

function toHttpTransport(config: JsonSafeObject): McpServerConnectionConfig['transport'] {
  if (typeof config.url !== 'string' || !config.url.trim()) throw new McpError('MCP_CONFIG_INVALID')
  const headers = config.headers === undefined
    ? undefined
    : isStringRecord(config.headers)
      ? config.headers
      : (() => { throw new McpError('MCP_CONFIG_INVALID') })()
  return {
    kind: 'streamable_http',
    url: config.url,
    ...(headers === undefined ? {} : { headers }),
  }
}

function isStringRecord(value: JsonSafeValue): value is JsonSafeObject & Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function validateMustApproveInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(validateMustApproveInput)
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => isSensitiveKey(key) || validateMustApproveInput(child))
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.toLowerCase().replace(/[\s_-]/g, ''))
}

function mustApprove(context: PreparedContext, input: unknown): boolean {
  return context.tool.requiresApproval
    || context.server.trustLevel !== 'trusted'
    || context.tool.riskLevel === 'high'
    || validateMustApproveInput(input)
}

function safeAuditInput(input: unknown): JsonSafeValue | null {
  try {
    return normalizeMcpResult({ content: [input] }).content[0] ?? null
  } catch {
    return '[REDACTED]'
  }
}

function safeInputHash(input: unknown): string {
  try {
    return hashMcpApprovalInput(input)
  } catch {
    return hashMcpApprovalInput('[REDACTED]')
  }
}

function mapBrokerError(error: unknown, fallback: McpErrorCode): McpError {
  if (error instanceof McpError) return error
  if (error instanceof McpSecurityError) return new McpError(error.code)
  if (isRecord(error) && typeof error.code === 'string' && isMcpErrorCode(error.code)) {
    return new McpError(error.code)
  }
  if (isRecord(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
    return new McpError('MCP_TOOL_CANCELLED')
  }
  return new McpError(fallback)
}

function throwWithRun(error: McpError, _run: McpToolRun): never {
  throw error
}

function isMcpErrorCode(value: string): value is McpErrorCode {
  return [
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
  ].includes(value as McpErrorCode)
}

function isJsonSafeObject(value: unknown): value is JsonSafeObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && isJsonSafeValue(value)
}

function isJsonSafeValue(value: unknown): value is JsonSafeValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonSafeValue)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every(isJsonSafeValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function freezeApprovalDetails(details: McpApprovalRequiredDetails): McpApprovalRequiredDetails {
  Object.freeze(details.preview)
  Object.freeze(details)
  return details
}
