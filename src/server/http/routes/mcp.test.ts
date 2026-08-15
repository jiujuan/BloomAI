import { describe, expect, it, vi } from 'vitest'
import { McpApprovalRequiredError } from '../../mcp/capability-broker'
import { McpError } from '../../mcp/errors'
import { McpService } from '../../mcp/mcp.service'
import { createMcpRoutes } from './mcp'
import type {
  McpServerRecord,
  McpToolRecord,
  McpRunRecord,
  McpServiceRepository,
} from '../../mcp/mcp.service'
import type { McpApprovalRequest, McpPreview } from '../../mcp/types'
import { Hono } from 'hono'
import { createHttpErrorHandler } from '../error-mapper'

const SERVER_ID = 'server-1'
const TOOL_ID = `mcp:${SERVER_ID}:echo`

function createServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: SERVER_ID,
    name: 'Fixture MCP Server',
    transportKind: 'streamable_http',
    configJson: JSON.stringify({
      url: 'https://example.test/mcp',
      headers: { Authorization: '${env:MCP_TOKEN}' },
    }),
    secretRefs: ['${env:MCP_TOKEN}'],
    isEnabled: false,
    trustLevel: 'untrusted',
    connectionStatus: 'unknown',
    catalogVersion: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

function createTool(overrides: Partial<McpToolRecord> = {}): McpToolRecord {
  return {
    id: TOOL_ID,
    serverId: SERVER_ID,
    remoteName: 'echo',
    name: 'Echo',
    description: 'Echo input',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: { type: 'object' },
    schemaHash: 'schema-v1',
    schemaSupported: true,
    isEnabled: false,
    isRemoved: false,
    requiresApproval: true,
    riskLevel: 'medium',
    discoveredAt: 1_000,
    updatedAt: 1_000,
    removedAt: null,
    ...overrides,
  }
}

function createRun(overrides: Partial<McpRunRecord> = {}): McpRunRecord {
  return {
    id: 'run-1',
    serverId: SERVER_ID,
    toolId: TOOL_ID,
    remoteName: 'echo',
    sessionId: 'session-1',
    agentRole: 'general',
    status: 'success',
    inputHash: 'hash',
    safeInput: { query: '[REDACTED]' },
    safeOutput: { content: [{ text: 'ok' }], isError: false, truncated: false },
    errorCode: null,
    durationMs: 5,
    createdAt: 1_000,
    completedAt: 1_005,
    ...overrides,
  }
}

class FakeRepository implements McpServiceRepository {
  server = createServer()
  tool = createTool()
  runs: McpRunRecord[] = [createRun()]
  createServer = vi.fn((input: Parameters<McpServiceRepository['createServer']>[0]) => {
    this.server = createServer({
      id: input.id ?? SERVER_ID,
      name: input.name,
      transportKind: input.transportKind,
      configJson: input.configJson,
      secretRefs: input.secretRefs ?? [],
      isEnabled: input.isEnabled ?? false,
      trustLevel: input.trustLevel ?? 'untrusted',
      connectionStatus: input.connectionStatus ?? 'unknown',
      catalogVersion: input.catalogVersion ?? 0,
    })
    return this.server
  })
  getServer = vi.fn((id: string) => id === this.server.id ? this.server : undefined)
  listServers = vi.fn(() => [this.server])
  updateServer = vi.fn((id: string, input: Parameters<McpServiceRepository['updateServer']>[1]) => {
    if (id !== this.server.id) throw new McpError('MCP_SERVER_NOT_FOUND')
    this.server = createServer({ ...this.server, ...input })
    return this.server
  })
  setServerEnabled = vi.fn((id: string, enabled: boolean) => this.updateServer(id, { isEnabled: enabled }))
  setServerTrust = vi.fn((id: string, trustLevel: 'untrusted' | 'reviewed' | 'trusted') => this.updateServer(id, { trustLevel }))
  deleteServer = vi.fn((id: string) => {
    if (!this.getServer(id)) throw new McpError('MCP_SERVER_NOT_FOUND')
    return true
  })
  getTool = vi.fn((id: string) => id === this.tool.id ? this.tool : undefined)
  listTools = vi.fn((serverId: string) => serverId === this.server.id ? [this.tool] : [])
  setToolEnabled = vi.fn((id: string, enabled: boolean) => {
    if (id !== this.tool.id) throw new McpError('MCP_TOOL_NOT_FOUND')
    this.tool = createTool({ ...this.tool, isEnabled: enabled })
    return this.tool
  })
  confirmCatalog = vi.fn(() => {
    this.server = createServer({ ...this.server, catalogVersion: this.server.catalogVersion + 1 })
    this.tool = createTool({ ...this.tool, isEnabled: false })
    return { server: this.server, tools: [this.tool] }
  })
  listRuns = vi.fn((options: Parameters<McpServiceRepository['listRuns']>[0] = {}) => (
    this.runs.filter((run) => !options.serverId || run.serverId === options.serverId)
  ))
}

function createPreview(): McpPreview {
  return {
    previewId: 'preview-1',
    serverId: SERVER_ID,
    previewHash: 'preview-hash',
    configHash: 'config-hash',
    catalogVersion: '0',
    diff: [{
      kind: 'added',
      remoteName: 'echo',
      toolId: TOOL_ID,
      after: {
        remoteName: 'echo',
        name: 'Echo',
        description: 'Echo input',
        inputSchema: { type: 'object' },
        schemaHash: 'schema-v1',
        schemaSupported: true,
      },
    }],
    createdAt: 1_000,
    expiresAt: 301_000,
  }
}

function createService(options: {
  enabled?: boolean
  approval?: boolean
  server?: Partial<McpServerRecord>
} = {}) {
  const repository = new FakeRepository()
  repository.server = createServer(options.server)
  const preview = createPreview()
  const connectionManager = {
    listTools: vi.fn(async () => [{
      serverId: SERVER_ID,
      localName: 'echo',
      remoteName: 'echo',
      name: 'Echo',
      description: 'Echo input',
      inputSchema: { type: 'object' },
      schemaSupported: true,
    }]),
  }
  const catalog = {
    preview: vi.fn(async () => preview),
    confirm: vi.fn(() => repository.confirmCatalog()),
    clearPreviews: vi.fn(),
  }
  const approvalRequest: McpApprovalRequest = {
    approvalRequestId: 'approval-1',
    runId: 'run-2',
    serverId: SERVER_ID,
    toolId: TOOL_ID,
    inputHash: 'input-hash',
    catalogVersion: '1',
    sessionId: 'session-1',
    role: 'general',
    configVersion: 'config-hash',
    issuedAt: 1_000,
    expiresAt: 301_000,
    consumedAt: null,
  }
  const broker = {
    getApprovalRequest: vi.fn((requestId: string) => requestId === approvalRequest.approvalRequestId ? approvalRequest : undefined),
    execute: vi.fn(async () => {
      if (options.approval) {
        throw new McpApprovalRequiredError({
          approvalRequestId: approvalRequest.approvalRequestId,
          runId: approvalRequest.runId,
          expiresAt: approvalRequest.expiresAt,
          preview: {
            serverId: SERVER_ID,
            toolId: TOOL_ID,
            remoteName: 'echo',
            toolName: 'Echo',
            riskLevel: 'medium',
            trustLevel: 'trusted',
            catalogVersion: '1',
            safeInput: { query: '[REDACTED]' },
          },
        })
      }
      return { status: 'success' as const, result: { content: [{ text: 'ok' }], isError: false, truncated: false }, run: createRun() }
    }),
    approve: vi.fn(async () => {
      approvalRequest.consumedAt = 1_100
      return {
        status: 'success' as const,
        result: { content: [{ text: 'approved' }], isError: false, truncated: false },
        run: createRun({ id: 'run-2' }),
      }
    }),
    deny: vi.fn(async () => ({ status: 'denied' as const, run: createRun({ id: 'run-2', status: 'denied', safeOutput: null, errorCode: null }) })),
  }
  const service = new McpService({
    repository,
    connectionManager,
    catalog,
    broker,
    env: { MCP_CLIENT_ENABLED: options.enabled === false ? 'false' : 'true', MCP_ALLOWED_ENV_NAMES: 'MCP_TOKEN' },
  })
  return { service, repository, connectionManager, catalog, broker, approvalRequest }
}

function createRouteApp(service: McpService) {
  const app = new Hono()
  app.route('/api/v1/mcp', createMcpRoutes(service))
  app.onError(createHttpErrorHandler(() => undefined))
  return app
}

function headers(extra: Record<string, string> = {}) {
  return { 'content-type': 'application/json', 'x-bloom-role': 'admin', ...extra }
}

async function json(response: Response) {
  return await response.json() as any
}

describe('MCP HTTP routes', () => {
  it('requires an administrator and never returns resolved secrets or raw config', async () => {
    const { service } = createService()
    const app = createRouteApp(service)
    const unauthorized = await app.request('/api/v1/mcp/servers')
    expect(unauthorized.status).toBe(403)

    const created = await app.request('/api/v1/mcp/servers', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        id: SERVER_ID,
        name: 'Fixture MCP Server',
        transportKind: 'streamable_http',
        config: {
          url: 'https://example.test/mcp',
          headers: { Authorization: '${env:MCP_TOKEN}' },
        },
        trustLevel: 'trusted',
        isEnabled: true,
      }),
    })
    expect(created.status).toBe(201)
    const body = await json(created)
    expect(body.data).toMatchObject({ id: SERVER_ID, isEnabled: false, trustLevel: 'untrusted' })
    expect(body.data).not.toHaveProperty('configJson')
    expect(JSON.stringify(body)).not.toContain('resolved-secret')
    expect(JSON.stringify(body)).not.toContain('Bearer')
    expect(body.data.transport).toMatchObject({ kind: 'streamable_http', url: 'https://example.test' })
    expect(body.data.transport.headers).toEqual(['Authorization'])
  })

  it('covers server and tool read/update/delete routes and redacts stdio argument values', async () => {
    const { service, repository } = createService({
      server: {
        transportKind: 'stdio',
        configJson: JSON.stringify({
          command: 'node',
          args: [
            '--safe-flag',
            'plain-secret-value',
            '--api-key=resolved-secret',
            'Bearer resolved-token',
            '${env:MCP_TOKEN}',
          ],
          cwd: 'C:\\fixture',
          env: { MCP_TOKEN: '${env:MCP_TOKEN}' },
        }),
        secretRefs: ['${env:MCP_TOKEN}'],
      },
    })
    const app = createRouteApp(service)

    const listed = await app.request('/api/v1/mcp/servers', { headers: headers() })
    expect(listed.status).toBe(200)
    expect((await json(listed)).data).toEqual([expect.objectContaining({ id: SERVER_ID })])

    const detail = await app.request(`/api/v1/mcp/servers/${SERVER_ID}`, { headers: headers() })
    expect(detail.status).toBe(200)
    const detailBody = await json(detail)
    expect(detailBody.data.transport).toMatchObject({ kind: 'stdio', command: 'node', cwd: 'C:\\fixture' })
    expect(detailBody.data.transport.args).toEqual([
      '--safe-flag',
      '[REDACTED]',
      '--api-key=[REDACTED]',
      '[REDACTED]',
      '${env:MCP_TOKEN}',
    ])
    expect(JSON.stringify(detailBody)).not.toContain('plain-secret-value')
    expect(JSON.stringify(detailBody)).not.toContain('resolved-secret')
    expect(JSON.stringify(detailBody)).not.toContain('Bearer resolved-token')
    expect(detailBody.data.transport.envNames).toEqual(['MCP_TOKEN'])

    const patched = await app.request(`/api/v1/mcp/servers/${SERVER_ID}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ name: 'Renamed MCP Server', trustLevel: 'trusted', isEnabled: true }),
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ name: 'Renamed MCP Server', trustLevel: 'untrusted', isEnabled: false })
    expect(repository.updateServer).toHaveBeenCalled()

    const tools = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools`, { headers: headers() })
    expect(tools.status).toBe(200)
    expect((await json(tools)).data).toEqual([expect.objectContaining({ id: TOOL_ID })])

    const disabled = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/disable`, { method: 'POST', ...{ headers: headers(), body: JSON.stringify({}) } })
    expect(disabled.status).toBe(200)
    expect((await json(disabled)).data.isEnabled).toBe(false)

    const deleted = await app.request(`/api/v1/mcp/servers/${SERVER_ID}`, { method: 'DELETE', headers: headers() })
    expect(deleted.status).toBe(200)
    expect((await json(deleted)).data).toEqual({ deleted: true })
  })

  it('supports preview, confirm, server/tool policy changes, safe tool test, approvals and runs', async () => {
    const { service, repository, catalog, broker, connectionManager } = createService({ approval: true })
    const app = createRouteApp(service)
    const base = { headers: headers(), body: JSON.stringify({}) }

    const testConnectionController = new AbortController()
    const tested = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/test-connection`, {
      method: 'POST',
      ...base,
      signal: testConnectionController.signal,
    })
    expect(tested.status).toBe(200)
    expect((await json(tested)).data.server.connectionStatus).toBe('healthy')
    expect(connectionManager.listTools).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: 'temporary',
      signal: expect.any(AbortSignal),
    }))

    const previewController = new AbortController()
    const previewed = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/preview`, {
      method: 'POST',
      ...base,
      signal: previewController.signal,
    })
    expect(previewed.status).toBe(200)
    expect((await json(previewed)).data).toMatchObject({ previewId: 'preview-1', previewHash: 'preview-hash' })
    expect(catalog.preview).toHaveBeenCalledWith({ serverId: SERVER_ID, signal: expect.any(AbortSignal) })

    const confirmed = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/confirm`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ previewId: 'preview-1', previewHash: 'preview-hash', configHash: 'config-hash', catalogVersion: '0' }),
    })
    expect(confirmed.status).toBe(200)
    expect(catalog.confirm).toHaveBeenCalledWith(expect.objectContaining({ previewId: 'preview-1' }))

    const enabled = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/enable`, { method: 'POST', ...base })
    expect(enabled.status).toBe(200)
    expect((await json(enabled)).data.isEnabled).toBe(true)

    const trust = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/trust`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ trustLevel: 'trusted' }),
    })
    expect(trust.status).toBe(200)
    expect((await json(trust)).data.trustLevel).toBe('trusted')

    const toolPatch = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: true, riskLevel: 'low', requiresApproval: false }),
    })
    expect(toolPatch.status).toBe(200)
    expect((await json(toolPatch)).data).toMatchObject({ id: TOOL_ID, isEnabled: true, riskLevel: 'medium', requiresApproval: true })

    const toolTestController = new AbortController()
    const toolTest = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}/test`, {
      method: 'POST',
      headers: headers({ 'x-bloom-session': 'session-1' }),
      body: JSON.stringify({ input: { query: 'synthetic-secret' } }),
      signal: toolTestController.signal,
    })
    expect(broker.execute).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(toolTest.status).toBe(409)
    const approvalBody = await json(toolTest)
    expect(approvalBody.error).toMatchObject({ code: 'MCP_APPROVAL_REQUIRED' })
    expect(approvalBody.error.details).toMatchObject({ approvalRequestId: 'approval-1', safePreview: expect.any(Object) })
    expect(JSON.stringify(approvalBody)).not.toContain('approval-token')
    expect(JSON.stringify(approvalBody)).not.toContain('synthetic-secret')

    const approvalController = new AbortController()
    const approved = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/approvals/approval-1/approve`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
      signal: approvalController.signal,
    })
    expect(approved.status).toBe(200)
    expect((await json(approved)).data).toMatchObject({ result: { content: expect.any(Array) }, run: { id: 'run-2' } })

    const denied = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/approvals/approval-1/deny`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    })
    expect(denied.status).toBe(409)

    const runs = await app.request(`/api/v1/mcp/servers/${SERVER_ID}/runs`, { headers: headers() })
    expect(runs.status).toBe(200)
    expect((await json(runs)).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'run-1' })]))
    expect(repository.listRuns).toHaveBeenCalledWith(expect.objectContaining({ serverId: SERVER_ID }))
    expect(broker.approve).toHaveBeenCalledWith('approval-1', { signal: expect.any(AbortSignal) })
  })

  it('maps stable MCP failures, blocks cross-server approvals, and allows historical runs while disabled', async () => {
    const disabledFixture = createService({ enabled: false })
    const disabledApp = createRouteApp(disabledFixture.service)
    const status = await disabledApp.request('/api/v1/mcp/status', { headers: headers() })
    expect(status.status).toBe(200)
    expect((await json(status)).data).toEqual({ enabled: false })

    const disabled = await disabledApp.request('/api/v1/mcp/servers', { headers: headers() })
    expect(disabled.status).toBe(409)
    expect((await json(disabled)).error).toMatchObject({ code: 'MCP_DISABLED' })

    const runs = await disabledApp.request(`/api/v1/mcp/servers/${SERVER_ID}/runs`, { headers: headers() })
    expect(runs.status).toBe(200)

    const enabledFixture = createService()
    enabledFixture.broker.getApprovalRequest.mockReturnValueOnce({
      ...enabledFixture.approvalRequest,
      serverId: 'another-server',
    } as never)
    const crossServer = await createRouteApp(enabledFixture.service).request(
      `/api/v1/mcp/servers/${SERVER_ID}/approvals/approval-1/approve`,
      { method: 'POST', headers: headers(), body: JSON.stringify({}) },
    )
    expect(crossServer.status).toBe(409)
    expect((await json(crossServer)).error.code).toBe('MCP_APPROVAL_INVALID')
    expect(enabledFixture.broker.approve).not.toHaveBeenCalled()

    const serviceWithFailure = createService().service
    vi.spyOn(serviceWithFailure, 'testTool').mockRejectedValue(new McpError('MCP_TOOL_TIMEOUT'))
    const failureApp = createRouteApp(serviceWithFailure)
    const response = await failureApp.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}/test`, {
      method: 'POST', headers: headers({ 'x-bloom-session': 'session-1' }), body: JSON.stringify({ input: {} }),
    })
    expect(response.status).toBe(504)
    expect((await json(response)).error).toMatchObject({ code: 'MCP_TOOL_TIMEOUT' })

    const stableCases: Array<{
      code: 'MCP_PREVIEW_STALE' | 'MCP_SERVER_DISABLED' | 'MCP_ROLE_NOT_ALLOWED' | 'MCP_CONNECTION_FAILED' | 'MCP_TOOL_CANCELLED'
      status: number
      invoke: (service: McpService) => void
      request: (app: Hono) => Response | Promise<Response>
    }> = [
      {
        code: 'MCP_PREVIEW_STALE',
        status: 409,
        invoke: (service) => { vi.spyOn(service, 'confirmTools').mockImplementation(() => { throw new McpError('MCP_PREVIEW_STALE') }) },
        request: (app) => app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/confirm`, {
          method: 'POST', headers: headers(), body: JSON.stringify({ previewHash: 'stale', configHash: 'config', catalogVersion: '0' }),
        }),
      },
      {
        code: 'MCP_SERVER_DISABLED',
        status: 409,
        invoke: (service) => { vi.spyOn(service, 'testTool').mockRejectedValue(new McpError('MCP_SERVER_DISABLED')) },
        request: (app) => app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}/test`, {
          method: 'POST', headers: headers({ 'x-bloom-session': 'session-1' }), body: JSON.stringify({ input: {} }),
        }),
      },
      {
        code: 'MCP_ROLE_NOT_ALLOWED',
        status: 409,
        invoke: (service) => { vi.spyOn(service, 'testTool').mockRejectedValue(new McpError('MCP_ROLE_NOT_ALLOWED')) },
        request: (app) => app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}/test`, {
          method: 'POST', headers: headers({ 'x-bloom-session': 'session-1' }), body: JSON.stringify({ input: {} }),
        }),
      },
      {
        code: 'MCP_CONNECTION_FAILED',
        status: 502,
        invoke: (service) => { vi.spyOn(service, 'testConnection').mockRejectedValue(new McpError('MCP_CONNECTION_FAILED')) },
        request: (app) => app.request(`/api/v1/mcp/servers/${SERVER_ID}/test-connection`, {
          method: 'POST', headers: headers(), body: JSON.stringify({}),
        }),
      },
      {
        code: 'MCP_TOOL_CANCELLED',
        status: 499,
        invoke: (service) => { vi.spyOn(service, 'testTool').mockRejectedValue(new McpError('MCP_TOOL_CANCELLED')) },
        request: (app) => app.request(`/api/v1/mcp/servers/${SERVER_ID}/tools/${encodeURIComponent(TOOL_ID)}/test`, {
          method: 'POST', headers: headers({ 'x-bloom-session': 'session-1' }), body: JSON.stringify({ input: {} }),
        }),
      },
    ]
    for (const stableCase of stableCases) {
      const fixture = createService()
      stableCase.invoke(fixture.service)
      const stableResponse = await stableCase.request(createRouteApp(fixture.service))
      expect(stableResponse.status).toBe(stableCase.status)
      expect((await json(stableResponse)).error).toMatchObject({ code: stableCase.code })
    }
  })
})
