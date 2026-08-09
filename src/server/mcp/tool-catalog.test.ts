import { describe, expect, it, vi } from 'vitest'
import { McpError } from './errors'
import { hashMcpConfig, hashMcpToolSchema } from './catalog-hash'
import { McpToolCatalogService, type McpCatalogRepository } from './tool-catalog'
import type { McpServerRecord } from '../db/repositories/mcp.repo'
import type { DiscoveredMcpTool, McpServerTool } from './types'
import type { McpConnectionManager } from './connection-manager'

const server: McpServerRecord = {
  id: 'server-1',
  name: 'Docs Server',
  transportKind: 'streamable_http',
  configJson: JSON.stringify({
    url: 'https://example.test/mcp',
    headers: { Authorization: '${env:MCP_TOKEN}' },
  }),
  secretRefs: ['${env:MCP_TOKEN}'],
  isEnabled: false,
  trustLevel: 'reviewed',
  connectionStatus: 'unknown',
  catalogVersion: 3,
  lastErrorCode: null,
  lastErrorAt: null,
  createdAt: 1_000,
  updatedAt: 2_000,
}

function tool(overrides: Partial<McpServerTool> = {}): McpServerTool {
  const inputSchema = overrides.inputSchema ?? { type: 'object' }
  return {
    id: overrides.id ?? `mcp:server-1:${overrides.remoteName ?? 'search'}`,
    serverId: 'server-1',
    remoteName: overrides.remoteName ?? 'search',
    name: overrides.name ?? 'Search',
    description: overrides.description ?? 'Search documents',
    inputSchema,
    ...(overrides.outputSchema === undefined ? {} : { outputSchema: overrides.outputSchema }),
    schemaHash: overrides.schemaHash ?? hashMcpToolSchema(inputSchema, overrides.outputSchema),
    schemaSupported: overrides.schemaSupported ?? true,
    ...(overrides.schemaErrorCode === undefined ? {} : { schemaErrorCode: overrides.schemaErrorCode }),
    isEnabled: overrides.isEnabled ?? false,
    isRemoved: overrides.isRemoved ?? false,
    requiresApproval: overrides.requiresApproval ?? true,
    riskLevel: overrides.riskLevel ?? 'medium',
    discoveredAt: overrides.discoveredAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 2_000,
    removedAt: overrides.removedAt ?? null,
  }
}

function discovered(overrides: Partial<DiscoveredMcpTool> = {}): DiscoveredMcpTool {
  const inputSchema = overrides.inputSchema ?? { type: 'object' }
  return {
    serverId: 'server-1',
    serverName: 'Docs Server',
    localName: `Docs Server_${overrides.remoteName ?? 'search'}`,
    remoteName: overrides.remoteName ?? 'search',
    name: overrides.name ?? 'Search',
    description: overrides.description ?? 'Search documents',
    inputSchema,
    ...(overrides.outputSchema === undefined ? {} : { outputSchema: overrides.outputSchema }),
    ...(overrides.schemaHash === undefined ? {} : { schemaHash: overrides.schemaHash }),
    ...(overrides.schemaSupported === undefined ? {} : { schemaSupported: overrides.schemaSupported }),
    ...(overrides.schemaErrorCode === undefined ? {} : { schemaErrorCode: overrides.schemaErrorCode }),
  }
}

function createFakeCatalog(options: {
  tools?: McpServerTool[]
  remoteTools?: DiscoveredMcpTool[]
  now?: number
  previewTtlMs?: number
} = {}) {
  const repo: McpCatalogRepository = {
    getServer: vi.fn(() => server),
    listTools: vi.fn(() => options.tools ?? []),
    confirmCatalog: vi.fn((input) => ({
      server: { ...server, catalogVersion: input.expectedCatalogVersion + 1 },
      tools: input.tools.map((entry) => tool({
        remoteName: entry.remoteName,
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        schemaHash: entry.schemaHash,
        schemaSupported: entry.schemaSupported,
        schemaErrorCode: entry.schemaErrorCode,
        isEnabled: false,
      })),
    })),
  }
  const manager: Pick<McpConnectionManager, 'listTools'> = {
    listTools: vi.fn(async () => options.remoteTools ?? []),
  }
  const service = new McpToolCatalogService({
    repository: repo,
    connectionManager: manager,
    clock: () => options.now ?? 10_000,
    previewTtlMs: options.previewTtlMs ?? 60_000,
    idFactory: () => 'preview-1',
  })
  return { repo, manager, service }
}

describe('catalog hash boundaries', () => {
  it('canonicalizes config and schema deterministically without resolving secret references', () => {
    const configA = hashMcpConfig({
      serverId: 'server-1',
      name: 'Docs Server',
      transportKind: 'streamable_http',
      config: {
        headers: { Authorization: '${env:MCP_TOKEN}' },
        url: 'https://example.test/mcp',
      },
      secretRefs: ['${env:MCP_TOKEN}'],
    })
    const configB = hashMcpConfig({
      secretRefs: ['${env:MCP_TOKEN}'],
      config: {
        url: 'https://example.test/mcp',
        headers: { Authorization: '${env:MCP_TOKEN}' },
      },
      transportKind: 'streamable_http',
      name: 'Docs Server',
      serverId: 'server-1',
    })
    expect(configA).toBe(configB)
    expect(configA).not.toContain('MCP_TOKEN')
    expect(hashMcpToolSchema(
      { type: 'object', properties: { query: { type: 'string' } } },
      { type: 'object' },
    )).toBe(hashMcpToolSchema(
      { properties: { query: { type: 'string' } }, type: 'object' },
      { type: 'object' },
    ))
  })
})

describe('McpToolCatalogService', () => {
  it('previews a temporary discovery with stable diff categories and no secret leakage', async () => {
    const unchangedSchema = { properties: { query: { type: 'string' } }, type: 'object' }
    const { service, manager, repo } = createFakeCatalog({
      tools: [
        tool({ remoteName: 'search', name: 'Search', description: 'Search documents', inputSchema: unchangedSchema, isEnabled: true }),
        tool({ remoteName: 'changed', name: 'Changed', description: 'Old description', inputSchema: { type: 'object' }, isEnabled: true }),
        tool({ remoteName: 'removed', name: 'Removed', description: 'No longer remote', isEnabled: true }),
        tool({ remoteName: 'already-removed', name: 'Old', isRemoved: true, removedAt: 9_000 }),
      ],
      remoteTools: [
        discovered({ remoteName: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }),
        discovered({ remoteName: 'changed', name: 'Changed', description: ' New description ', inputSchema: { type: 'object' } }),
        discovered({
          remoteName: 'unsafe',
          name: 'Unsafe',
          description: 'Contains remote metadata',
          inputSchema: { type: 'object', additionalProperties: false },
          schemaSupported: false,
          schemaErrorCode: 'MCP_SCHEMA_UNSUPPORTED',
        }),
      ],
    })

    const preview = await service.preview({ serverId: 'server-1' })

    expect(manager.listTools).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'server-1', isEnabled: true, configVersion: expect.any(String) }),
      { mode: 'temporary', signal: undefined },
    )
    expect(repo.confirmCatalog).not.toHaveBeenCalled()
    expect(preview).toMatchObject({
      previewId: 'preview-1',
      serverId: 'server-1',
      catalogVersion: '3',
      configHash: expect.any(String),
      previewHash: expect.any(String),
      createdAt: 10_000,
      expiresAt: 70_000,
    })
    expect(preview.diff.map((entry) => [entry.remoteName, entry.kind])).toEqual([
      ['already-removed', 'unchanged'],
      ['changed', 'changed'],
      ['removed', 'removed'],
      ['search', 'unchanged'],
      ['unsafe', 'added'],
    ])
    const encoded = JSON.stringify(preview)
    expect(encoded).not.toContain('Bearer resolved-secret-value')
    expect(encoded).not.toContain('synthetic-token-value')
    expect(encoded).not.toContain('Authorization:')
    expect(preview.diff.find((entry) => entry.remoteName === 'unsafe')?.after).toMatchObject({
      schemaSupported: false,
      schemaErrorCode: 'MCP_SCHEMA_UNSUPPORTED',
    })
  })

  it('confirms only the stored preview, passes removed names atomically, and is idempotent', async () => {
    const { service, repo } = createFakeCatalog({
      tools: [tool({ remoteName: 'removed', isEnabled: true })],
      remoteTools: [discovered({ remoteName: 'new', name: 'New' })],
    })
    const preview = await service.preview('server-1')

    const first = service.confirm({
      serverId: 'server-1',
      previewHash: preview.previewHash,
      configHash: preview.configHash,
      catalogVersion: preview.catalogVersion,
    })
    const second = service.confirm({
      serverId: 'server-1',
      previewHash: preview.previewHash,
      configHash: preview.configHash,
      catalogVersion: preview.catalogVersion,
    })

    expect(repo.confirmCatalog).toHaveBeenCalledTimes(1)
    expect(repo.confirmCatalog).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'server-1',
      expectedCatalogVersion: 3,
      removedRemoteNames: ['removed'],
      tools: [expect.objectContaining({ remoteName: 'new', schemaSupported: true })],
    }))
    expect(second).toBe(first)
  })

  it('recomputes schema support for legacy stored tools before exposing a preview', async () => {
    const legacyUnsupported = tool({
      remoteName: 'legacy-unsupported',
      name: 'Legacy unsupported',
      inputSchema: { $ref: '#/$defs/unsupported' },
    })
    delete (legacyUnsupported as { schemaSupported?: boolean }).schemaSupported

    const { service } = createFakeCatalog({
      tools: [legacyUnsupported],
      remoteTools: [],
    })

    const preview = await service.preview('server-1')
    expect(preview.diff).toEqual([
      expect.objectContaining({
        kind: 'removed',
        remoteName: 'legacy-unsupported',
        before: expect.objectContaining({
          schemaSupported: false,
          schemaErrorCode: 'MCP_SCHEMA_UNSUPPORTED',
        }),
      }),
    ])
  })

  it('rejects mismatched and expired previews as MCP_PREVIEW_STALE without confirming', async () => {
    const { service, repo } = createFakeCatalog({
      remoteTools: [discovered()],
      now: 100,
      previewTtlMs: 10,
    })
    const preview = await service.preview('server-1')

    expect(() => service.confirm({
      serverId: 'server-1',
      previewHash: 'wrong',
      configHash: preview.configHash,
      catalogVersion: preview.catalogVersion,
    })).toThrowError(new McpError('MCP_PREVIEW_STALE'))

    let expiredNow = 111
    const expired = new McpToolCatalogService({
      repository: repo,
      connectionManager: { listTools: vi.fn(async () => [discovered()]) },
      clock: () => expiredNow,
      previewTtlMs: 10,
      idFactory: () => 'preview-expired',
    })
    const expiredPreview = await expired.preview('server-1')
    expiredNow = 122
    expect(() => expired.confirm({
      serverId: 'server-1',
      previewHash: expiredPreview.previewHash,
      configHash: expiredPreview.configHash,
      catalogVersion: expiredPreview.catalogVersion,
    })).toThrowError(new McpError('MCP_PREVIEW_STALE'))
    expect(repo.confirmCatalog).not.toHaveBeenCalled()
  })
})
