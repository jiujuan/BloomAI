import fs from 'fs'
import { createRequire } from 'node:module'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpError } from '../../mcp/errors'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../client')
  await client.runMigrations()
  return {
    client,
    mcpRepo: (await import('./mcp.repo')).mcpRepo,
  }
}

function openRawDb() {
  const requireFromTest = createRequire(import.meta.url)
  const { DatabaseSync } = requireFromTest('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(path.join(dataDir, 'bloomai.db'))
}

const baseServer = {
  id: 'server-1',
  name: 'Docs Server',
  transportKind: 'streamable_http' as const,
  configJson: JSON.stringify({
    url: 'https://example.test/mcp',
    headers: { Authorization: '${env:MCP_TOKEN}' },
  }),
  secretRefs: ['${env:MCP_TOKEN}'],
  createdAt: 1_000,
  updatedAt: 1_000,
}

const searchTool = {
  remoteName: 'search',
  name: 'Search',
  description: 'Search documents',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object' },
  schemaHash: 'schema-hash-1',
}

describe('mcpRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-mcp-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('provides server CRUD and keeps secret references without resolving them', async () => {
    const { mcpRepo } = await loadRepo()
    const created = mcpRepo.createServer(baseServer)

    expect(created).toMatchObject({
      id: 'server-1',
      name: 'Docs Server',
      transportKind: 'streamable_http',
      configJson: baseServer.configJson,
      secretRefs: ['${env:MCP_TOKEN}'],
      isEnabled: false,
      trustLevel: 'untrusted',
      connectionStatus: 'unknown',
      catalogVersion: 0,
    })

    const updated = mcpRepo.updateServer('server-1', {
      name: 'Updated Docs Server',
      configJson: JSON.stringify({ url: 'https://example.test/v2/mcp' }),
      secretRefs: [],
    })
    expect(updated).toMatchObject({ name: 'Updated Docs Server', secretRefs: [] })
    expect(mcpRepo.setServerEnabled('server-1', true)).toMatchObject({ isEnabled: true })
    expect(mcpRepo.setServerTrust('server-1', 'reviewed')).toMatchObject({ trustLevel: 'reviewed' })
    expect(mcpRepo.listServers().map((server) => server.id)).toEqual(['server-1'])

    mcpRepo.createServer({ ...baseServer, id: 'empty-server', name: 'Empty' })
    expect(mcpRepo.deleteServer('empty-server')).toBe(true)
    expect(mcpRepo.getServer('empty-server')).toBeUndefined()

    const raw = openRawDb()
    try {
      const stored = raw.prepare('SELECT config_json, secret_refs_json FROM mcp_servers WHERE id = ?').get('server-1') as any
      expect(stored.config_json).not.toContain('synthetic-token-value')
      expect(stored.config_json).not.toContain('${env:MCP_TOKEN}')
      expect(stored.secret_refs_json).toBe('[]')
    } finally {
      raw.close()
    }
  })

  it('rejects resolved secrets in persisted config and does not leave a partial row', async () => {
    const { mcpRepo } = await loadRepo()

    expect(() => mcpRepo.createServer({
      ...baseServer,
      id: 'unsafe-server',
      configJson: JSON.stringify({
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer resolved-secret-value' },
      }),
    })).toThrowError(new McpError('MCP_CONFIG_INVALID'))
    expect(mcpRepo.getServer('unsafe-server')).toBeUndefined()
  })

  it('atomically confirms a catalog with optimistic catalog-version validation', async () => {
    const { mcpRepo } = await loadRepo()
    mcpRepo.createServer(baseServer)

    const confirmed = mcpRepo.confirmCatalog({
      serverId: 'server-1',
      expectedCatalogVersion: 0,
      tools: [searchTool],
      now: 2_000,
    })
    expect(confirmed.server.catalogVersion).toBe(1)
    expect(confirmed.tools).toHaveLength(1)
    expect(confirmed.tools[0]).toMatchObject({
      id: 'mcp:server-1:search',
      isEnabled: false,
      isRemoved: false,
      requiresApproval: true,
      riskLevel: 'medium',
      discoveredAt: 2_000,
      updatedAt: 2_000,
    })

    expect(() => mcpRepo.confirmCatalog({
      serverId: 'server-1',
      expectedCatalogVersion: 0,
      tools: [{ ...searchTool, name: 'Should not be written', schemaHash: 'stale-hash' }],
      now: 3_000,
    })).toThrowError(new McpError('MCP_PREVIEW_STALE'))
    expect(mcpRepo.getServer('server-1')?.catalogVersion).toBe(1)
    expect(mcpRepo.getToolByRemoteName('server-1', 'search')?.name).toBe('Search')

    expect(mcpRepo.confirmCatalog({
      serverId: 'server-1',
      expectedCatalogVersion: 1,
      tools: [searchTool],
      now: 4_000,
    }).tools).toHaveLength(1)
    expect(mcpRepo.listTools('server-1')).toHaveLength(1)
  })

  it('rejects caller-supplied ids that violate the stable local tool id contract', async () => {
    const { mcpRepo } = await loadRepo()
    mcpRepo.createServer(baseServer)

    expect(() => mcpRepo.confirmCatalog({
      serverId: 'server-1',
      expectedCatalogVersion: 0,
      tools: [{ ...searchTool, id: 'remote-provided-id' }],
      now: 2_000,
    })).toThrowError(new McpError('MCP_CONFIG_INVALID'))
    expect(mcpRepo.getToolByRemoteName('server-1', 'search')).toBeUndefined()
  })

  it('updates tool metadata safely, toggles enablement, and soft-deletes without removing history', async () => {
    const { mcpRepo } = await loadRepo()
    mcpRepo.createServer(baseServer)
    mcpRepo.confirmCatalog({ serverId: 'server-1', expectedCatalogVersion: 0, tools: [searchTool], now: 2_000 })
    const tool = mcpRepo.getToolByRemoteName('server-1', 'search')!
    expect(mcpRepo.setToolEnabled(tool.id, true)).toMatchObject({ isEnabled: true })

    mcpRepo.confirmCatalog({
      serverId: 'server-1',
      expectedCatalogVersion: 1,
      tools: [{ ...searchTool, description: 'Changed description', schemaHash: 'schema-hash-2' }],
      now: 3_000,
    })
    expect(mcpRepo.getTool(tool.id)).toMatchObject({
      description: 'Changed description',
      schemaHash: 'schema-hash-2',
      isEnabled: false,
      isRemoved: false,
    })

    mcpRepo.softDeleteTool(tool.id, 4_000)
    expect(mcpRepo.getTool(tool.id)).toMatchObject({ isEnabled: false, isRemoved: true, removedAt: 4_000 })
    expect(mcpRepo.listTools('server-1')).toEqual([])
    expect(mcpRepo.listTools('server-1', { includeRemoved: true })).toHaveLength(1)

    const run = mcpRepo.createRun({
      id: 'run-1',
      serverId: 'server-1',
      toolId: tool.id,
      remoteName: 'search',
      sessionId: 'session-1',
      agentRole: 'general',
      status: 'pending_approval',
      inputHash: 'input-hash-1',
      safeInput: {
        query: 'hello',
        authorization: 'raw-input-secret',
        approvalToken: 'approval-token-raw',
      },
      createdAt: 5_000,
    })
    expect(run).toMatchObject({ id: 'run-1', status: 'pending_approval', safeInput: { authorization: '[REDACTED]', approvalToken: '[REDACTED]' } })

    expect(mcpRepo.updateRunStatus('run-1', { status: 'running' })).toMatchObject({ status: 'running' })
    const completed = mcpRepo.updateRunStatus('run-1', {
      status: 'success',
      durationMs: 42,
      safeOutput: {
        content: [{ text: 'done', token: 'raw-output-secret' }],
        isError: false,
        truncated: false,
      },
    })
    expect(completed).toMatchObject({ status: 'success', durationMs: 42, completedAt: expect.any(Number) })
    expect(completed.safeOutput).toMatchObject({ content: [{ text: 'done', token: '[REDACTED]' }] })
    expect(() => mcpRepo.updateRunStatus('run-1', { status: 'running' })).toThrowError(new McpError('MCP_CONFIG_INVALID'))

    const raw = openRawDb()
    try {
      const stored = raw.prepare('SELECT safe_input_json, safe_output_json FROM mcp_tool_runs WHERE id = ?').get('run-1') as any
      expect(stored.safe_input_json).not.toContain('raw-input-secret')
      expect(stored.safe_input_json).not.toContain('approval-token-raw')
      expect(stored.safe_output_json).not.toContain('raw-output-secret')
      expect(stored.safe_input_json).toContain('[REDACTED]')
      expect(stored.safe_output_json).toContain('[REDACTED]')
    } finally {
      raw.close()
    }

    expect(mcpRepo.listRuns({ toolId: tool.id })).toHaveLength(1)
    expect(mcpRepo.getRun('run-1')).toMatchObject({ status: 'success', remoteName: 'search' })
  })
})
