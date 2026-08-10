import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalStore } from './approval-store'
import { McpApprovalRequiredError, McpCapabilityBroker } from './capability-broker'
import { McpError } from './errors'
import type { McpConnectionManager } from './connection-manager'
import type { McpServerRecord, McpToolRecord, McpRunRecord } from '../db/repositories/mcp.repo'
import type { McpErrorCode, McpToolRun } from './types'

async function expectApprovalRequired(action: Promise<unknown>): Promise<McpApprovalRequiredError> {
  try {
    await action
  } catch (error) {
    if (error instanceof McpApprovalRequiredError) return error
    throw error
  }
  throw new Error('Expected MCP approval to be required')
}

function createServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'server-1',
    name: 'Fixture Server',
    transportKind: 'streamable_http',
    configJson: JSON.stringify({ url: 'https://example.test/mcp', headers: { Authorization: '${env:MCP_TOKEN}' } }),
    secretRefs: ['${env:MCP_TOKEN}'],
    isEnabled: true,
    trustLevel: 'trusted',
    connectionStatus: 'healthy',
    catalogVersion: 1,
    lastErrorCode: null,
    lastErrorAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

function createTool(overrides: Partial<McpToolRecord> = {}): McpToolRecord {
  return {
    id: 'mcp:server-1:echo',
    serverId: 'server-1',
    remoteName: 'echo',
    name: 'Echo',
    description: 'Echo input',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    schemaHash: 'schema-v1',
    schemaSupported: true,
    isEnabled: true,
    isRemoved: false,
    requiresApproval: false,
    riskLevel: 'low',
    discoveredAt: 1_000,
    updatedAt: 1_000,
    removedAt: null,
    ...overrides,
  }
}

class FakeMcpRepository {
  server = createServer()
  tool = createTool()
  runs = new Map<string, McpToolRun>()

  getServer = vi.fn((id: string) => this.server.id === id ? this.server : undefined)
  getTool = vi.fn((id: string) => this.tool.id === id ? this.tool : undefined)
  createRun = vi.fn((input: {
    id?: string
    serverId: string
    toolId: string
    remoteName: string
    sessionId?: string | null
    agentRole?: string | null
    status: McpToolRun['status']
    inputHash: string
    safeInput?: unknown | null
    safeOutput?: unknown | null
    errorCode?: McpErrorCode | null
    durationMs?: number | null
    createdAt?: number
    completedAt?: number | null
  }) => {
    const run: McpToolRun = {
      id: input.id ?? `run-${this.runs.size + 1}`,
      serverId: input.serverId,
      toolId: input.toolId,
      remoteName: input.remoteName,
      sessionId: input.sessionId ?? null,
      agentRole: input.agentRole ?? null,
      status: input.status,
      inputHash: input.inputHash,
      safeInput: (input.safeInput as McpToolRun['safeInput']) ?? null,
      safeOutput: (input.safeOutput as McpToolRun['safeOutput']) ?? null,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs ?? null,
      createdAt: input.createdAt ?? 1_000,
      completedAt: input.completedAt ?? null,
    }
    this.runs.set(run.id, run)
    return run
  })
  updateRunStatus = vi.fn((id: string, input: {
    status: McpToolRun['status']
    safeOutput?: unknown | null
    errorCode?: McpErrorCode | null
    durationMs?: number | null
    completedAt?: number | null
  }) => {
    const current = this.runs.get(id)
    if (!current) throw new Error(`missing run ${id}`)
    const run: McpToolRun = {
      ...current,
      status: input.status,
      ...(Object.prototype.hasOwnProperty.call(input, 'safeOutput') ? { safeOutput: input.safeOutput as McpToolRun['safeOutput'] } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'errorCode') ? { errorCode: input.errorCode ?? null } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'durationMs') ? { durationMs: input.durationMs ?? null } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'completedAt') ? { completedAt: input.completedAt ?? null } : {}),
    }
    this.runs.set(id, run)
    return run
  })
  getRun = vi.fn((id: string) => this.runs.get(id))
}

function createBroker(options: {
  repository?: FakeMcpRepository
  manager?: Pick<McpConnectionManager, 'executeTool'>
  approvals?: InMemoryApprovalStore
  now?: () => number
  ids?: string[]
  roleResolver?: (input: { sessionId: string; requestedRole?: string }) => string
  rolePolicy?: (input: { role: string; server: McpServerRecord; tool: McpToolRecord }) => boolean
  env?: Record<string, string | undefined>
} = {}) {
  const repository = options.repository ?? new FakeMcpRepository()
  const executeTool = options.manager?.executeTool ?? vi.fn(async (_config, remoteName, input) => ({
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: { remoteName, input },
    isError: false,
  }))
  const ids = [...(options.ids ?? [])]
  let sequence = 0
  const broker = new McpCapabilityBroker({
    repository,
    connectionManager: { executeTool },
    approvalStore: options.approvals ?? new InMemoryApprovalStore({ now: options.now }),
    env: options.env ?? { MCP_CLIENT_ENABLED: 'true' },
    clock: options.now ?? (() => 1_000),
    idFactory: () => ids.shift() ?? `generated-${++sequence}`,
    roleResolver: options.roleResolver,
    rolePolicy: options.rolePolicy,
  })
  return { broker, repository, executeTool }
}

describe('McpCapabilityBroker', () => {
  it('fails closed before parsing connection config when the feature flag is disabled', async () => {
    const repository = new FakeMcpRepository()
    repository.server = createServer({ configJson: '{not-json' })
    const { broker, repository: auditRepository, executeTool } = createBroker({
      repository,
      env: { MCP_CLIENT_ENABLED: 'false' },
      ids: ['run-disabled'],
    })

    await expect(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'blocked' },
      sessionId: 'session-1',
      role: 'general',
    })).rejects.toMatchObject({ code: 'MCP_DISABLED' })

    expect(auditRepository.runs.get('run-disabled')).toMatchObject({
      status: 'denied',
      errorCode: 'MCP_DISABLED',
    })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('creates a running audit before execution, passes AbortSignal, normalizes output, and completes success', async () => {
    const repository = new FakeMcpRepository()
    const executeTool = vi.fn(async (_config, remoteName, input, options) => {
      expect(repository.runs.get('run-1')?.status).toBe('running')
      expect(remoteName).toBe('echo')
      expect(input).toEqual({ message: 'hello' })
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { authorization: 'Bearer resolved-secret', ok: true },
        isError: false,
      }
    })
    const { broker } = createBroker({ repository, manager: { executeTool }, ids: ['run-1'] })

    const result = await broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { message: 'hello' },
      sessionId: 'session-1',
      role: 'general',
    })

    expect(result.status).toBe('success')
    expect(result.result).toMatchObject({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { authorization: '[REDACTED]', ok: true },
      isError: false,
      truncated: false,
    })
    expect(result.run).toMatchObject({
      id: 'run-1',
      status: 'success',
      errorCode: null,
      safeOutput: result.result,
    })
    expect(repository.runs.get('run-1')?.status).toBe('success')
    expect(JSON.stringify(repository.runs.get('run-1'))).not.toContain('resolved-secret')
  })

  it('does not let a caller-provided role override the safe default role resolver', async () => {
    const rolePolicy = vi.fn(() => true)
    const { broker } = createBroker({ rolePolicy, ids: ['run-role-default'] })

    await broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'role-boundary' },
      sessionId: 'session-1',
      role: 'admin',
    })

    expect(rolePolicy).toHaveBeenCalledWith(expect.objectContaining({ role: 'general' }))
  })

  it('accepts only server-derived Agent roles and keeps manual callers on general', async () => {
    const rolePolicy = vi.fn(() => true)
    const { broker } = createBroker({ rolePolicy, ids: ['run-agent-role', 'run-manual-role'] })

    await broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'agent-role' },
      sessionId: 'session-1',
      role: 'coding',
      caller: 'agent',
    })
    await broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'manual-role' },
      sessionId: 'session-1',
      role: 'coding',
      caller: 'manual_test',
    })

    expect(rolePolicy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'coding' }),
    )
    expect(rolePolicy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'general' }),
    )
  })

  it('creates a pending run and returns a safe approval preview without calling the remote', async () => {
    const { broker, repository, executeTool } = createBroker({ ids: ['run-approval'] })

    const error = await broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { authorization: 'Bearer resolved-secret', query: 'hello' },
      sessionId: 'session-1',
      role: 'general',
    }).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(McpApprovalRequiredError)
    expect(error).toMatchObject({
      code: 'MCP_APPROVAL_REQUIRED',
      details: {
        approvalRequestId: expect.any(String),
        runId: 'run-approval',
        expiresAt: expect.any(Number),
        preview: {
          remoteName: 'echo',
          safeInput: { authorization: '[REDACTED]', query: 'hello' },
        },
      },
    })
    expect(JSON.stringify(error)).not.toContain('resolved-secret')
    expect(repository.runs.get('run-approval')).toMatchObject({ status: 'pending_approval' })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('approves through the server-side store, consumes once, and denies without remote execution', async () => {
    const repository = new FakeMcpRepository()
    repository.tool = createTool({ requiresApproval: true })
    const { broker, executeTool } = createBroker({ repository, ids: ['run-approve', 'run-deny'] })

    const approvalError = await expectApprovalRequired(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'approve me' },
      sessionId: 'session-1',
      role: 'general',
    }))

    const approved = await broker.approve(approvalError.details.approvalRequestId)
    expect(approved.status).toBe('success')
    expect(executeTool).toHaveBeenCalledOnce()
    expect(repository.runs.get('run-approve')?.status).toBe('success')
    await expect(broker.approve(approvalError.details.approvalRequestId))
      .rejects.toMatchObject({ code: 'MCP_APPROVAL_INVALID' })

    const denyError = await expectApprovalRequired(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'deny me' },
      sessionId: 'session-1',
      role: 'general',
    }))
    const denied = await broker.deny(denyError.details.approvalRequestId)
    expect(denied.status).toBe('denied')
    expect(repository.runs.get('run-deny')).toMatchObject({ status: 'denied' })
    expect(executeTool).toHaveBeenCalledOnce()
  })

  it.each([
    ['stale input', { input: { query: 'changed' } }, 'MCP_APPROVAL_INVALID'],
    ['expired', { input: { query: 'original' } }, 'MCP_APPROVAL_EXPIRED'],
    ['role mismatch', { input: { query: 'original' } }, 'MCP_APPROVAL_INVALID'],
    ['catalog mismatch', { input: { query: 'original' } }, 'MCP_APPROVAL_INVALID'],
    ['config mismatch', { input: { query: 'original' } }, 'MCP_APPROVAL_INVALID'],
  ] as const)('rejects %s approval before remote execution', async (name, changes, code) => {
    let now = 1_000
    const approvals = new InMemoryApprovalStore({ now: () => now })
    const repository = new FakeMcpRepository()
    const issued = approvals.issue({
      runId: `run-${name}`,
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'original' },
      catalogVersion: '1',
      sessionId: 'session-1',
      role: 'general',
      configVersion: 'config-v1',
      ttlMs: name === 'expired' ? 10 : undefined,
    })
    if (name === 'expired') now = 1_010
    if (name === 'role mismatch') {
      // The server-side role resolver, not the request body, determines the role at execution time.
      const { broker, executeTool } = createBroker({
        repository,
        approvals,
        roleResolver: () => 'admin',
      })
      await expect(broker.execute({
        serverId: 'server-1', toolId: 'mcp:server-1:echo', input: changes.input,
        sessionId: 'session-1', role: 'general', runId: `run-${name}`, approvalToken: issued.token,
      })).rejects.toMatchObject({ code })
      expect(executeTool).not.toHaveBeenCalled()
      return
    }
    if (name === 'catalog mismatch') repository.server = createServer({ catalogVersion: 2 })
    if (name === 'config mismatch') repository.server = createServer({ configJson: JSON.stringify({ url: 'https://changed.example.test/mcp' }) })
    const { broker, executeTool } = createBroker({ repository, approvals, now: () => now })
    await expect(broker.execute({
      serverId: 'server-1', toolId: 'mcp:server-1:echo', input: changes.input,
      sessionId: 'session-1', role: 'general', runId: `run-${name}`, approvalToken: issued.token,
    })).rejects.toMatchObject({ code })
    expect(executeTool).not.toHaveBeenCalled()
    expect(repository.runs.get(`run-${name}`)).toMatchObject({ status: 'denied', errorCode: code })
  })

  it.each([
    ['disabled server', { server: { isEnabled: false }, tool: {} }, 'MCP_SERVER_DISABLED'],
    ['disabled tool', { server: {}, tool: { isEnabled: false } }, 'MCP_TOOL_DISABLED'],
    ['removed tool', { server: {}, tool: { isRemoved: true } }, 'MCP_TOOL_DISABLED'],
    ['unsupported schema', { server: {}, tool: { schemaSupported: false } }, 'MCP_SCHEMA_UNSUPPORTED'],
  ] as const)('denies %s and writes an audit run before remote execution', async (_name, overrides, code) => {
    const repository = new FakeMcpRepository()
    repository.server = createServer(overrides.server)
    repository.tool = createTool(overrides.tool)
    const { broker, executeTool } = createBroker({ repository, ids: ['run-denied'] })

    await expect(broker.execute({
      serverId: 'server-1', toolId: 'mcp:server-1:echo', input: { query: 'nope' },
      sessionId: 'session-1', role: 'general',
    })).rejects.toMatchObject({ code })
    expect(repository.runs.get('run-denied')).toMatchObject({ status: 'denied', errorCode: code })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('requires approval when a sensitive key uses separators', async () => {
    const { broker, repository, executeTool } = createBroker({ ids: ['run-sensitive-key'] })

    await expect(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { api_key: 'secret-value' },
      sessionId: 'session-1',
      role: 'general',
    })).rejects.toBeInstanceOf(McpApprovalRequiredError)

    expect(repository.runs.get('run-sensitive-key')).toMatchObject({ status: 'pending_approval' })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('fails closed for non-JSON input and writes only a redacted audit value', async () => {
    const input: Record<string, unknown> = { query: 'cycle' }
    input.self = input
    const { broker, repository, executeTool } = createBroker({ ids: ['run-invalid-input'] })

    await expect(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input,
      sessionId: 'session-1',
      role: 'general',
    })).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })

    expect(repository.runs.get('run-invalid-input')).toMatchObject({
      status: 'denied',
      errorCode: 'MCP_CONFIG_INVALID',
      safeInput: '[REDACTED]',
    })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('does not turn a consumed approval into a denial while its run is still executing', async () => {
    const repository = new FakeMcpRepository()
    repository.tool = createTool({ requiresApproval: true })
    let release: ((value: unknown) => void) | undefined
    const executeTool = vi.fn(() => new Promise((resolve) => {
      release = resolve
    }))
    const { broker } = createBroker({ repository, manager: { executeTool } })

    const approvalError = await expectApprovalRequired(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'race' },
      sessionId: 'session-1',
      role: 'general',
    }))
    const requestId = approvalError.details.approvalRequestId
    const approval = broker.approve(requestId)
    await Promise.resolve()
    await expect(broker.deny(requestId)).rejects.toMatchObject({ code: 'MCP_APPROVAL_INVALID' })
    release?.({ content: [{ type: 'text', text: 'done' }], isError: false })

    await expect(approval).resolves.toMatchObject({ status: 'success' })
  })

  it('revalidates a pending approval when the server is disabled before approval', async () => {
    const repository = new FakeMcpRepository()
    repository.tool = createTool({ requiresApproval: true })
    const approvals = new InMemoryApprovalStore({ now: () => 1_000 })
    const issue = vi.spyOn(approvals, 'issue')
    const { broker, executeTool } = createBroker({
      repository,
      approvals,
      ids: ['run-disabled-after-approval'],
    })

    const approvalError = await expectApprovalRequired(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'blocked-after-preview' },
      sessionId: 'session-1',
      role: 'general',
    }))
    const issued = issue.mock.results[0]?.value as { token: string }
    repository.server = createServer({ isEnabled: false })

    await expect(broker.execute({
      serverId: 'server-1',
      toolId: 'mcp:server-1:echo',
      input: { query: 'blocked-after-preview' },
      sessionId: 'session-1',
      role: 'general',
      runId: approvalError.details.runId,
      approvalToken: issued.token,
    })).rejects.toMatchObject({ code: 'MCP_SERVER_DISABLED' })

    expect(repository.runs.get('run-disabled-after-approval')).toMatchObject({
      status: 'denied',
      errorCode: 'MCP_SERVER_DISABLED',
    })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('records timeout as an error, passes the timeout to the manager, and never retries', async () => {
    const executeTool = vi.fn(async (_config, _remoteName, _input, options) => {
      expect(options?.timeoutMs).toBe(25)
      throw new McpError('MCP_TOOL_TIMEOUT')
    })
    const { broker, repository } = createBroker({ manager: { executeTool }, ids: ['run-timeout'] })

    await expect(broker.execute({
      serverId: 'server-1', toolId: 'mcp:server-1:echo', input: {}, sessionId: 'session-1', role: 'general', timeoutMs: 25,
    })).rejects.toMatchObject({ code: 'MCP_TOOL_TIMEOUT' })
    expect(executeTool).toHaveBeenCalledOnce()
    expect(repository.runs.get('run-timeout')).toMatchObject({ status: 'error', errorCode: 'MCP_TOOL_TIMEOUT' })
  })

  it('records cancellation as cancelled and propagates the caller AbortSignal', async () => {
    const controller = new AbortController()
    const executeTool = vi.fn(async (_config, _remoteName, _input, options) => {
      expect(options?.signal).toBe(controller.signal)
      throw new McpError('MCP_TOOL_CANCELLED')
    })
    const { broker, repository } = createBroker({ manager: { executeTool }, ids: ['run-cancelled'] })

    await expect(broker.execute({
      serverId: 'server-1', toolId: 'mcp:server-1:echo', input: {}, sessionId: 'session-1', role: 'general', signal: controller.signal,
    })).rejects.toMatchObject({ code: 'MCP_TOOL_CANCELLED' })
    expect(repository.runs.get('run-cancelled')).toMatchObject({ status: 'cancelled', errorCode: 'MCP_TOOL_CANCELLED' })
  })
})

void ({} as McpServerRecord)
void ({} as McpRunRecord)
