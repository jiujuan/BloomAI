import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  approveMcpRequest,
  confirmMcpTools,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpRuns,
  listMcpServers,
  listMcpTools,
  previewMcpTools,
  setMcpServerEnabled,
  setMcpServerTrust,
  testMcpConnection,
  testMcpTool,
  updateMcpServer,
  updateMcpTool,
  denyMcpRequest,
} from './mcp-servers.api'
import { sanitizeMcpApprovalDetails, type JsonValue, type McpApprovalState, type McpDiscoveredTool, type McpPreview, type McpRun, type McpServer, type McpServerConfigInput, type McpServerPatch, type McpTool } from './mcp-servers.types'

export type McpServersApi = {
  listServers: typeof listMcpServers
  getServer: typeof getMcpServer
  createServer: typeof createMcpServer
  updateServer: typeof updateMcpServer
  deleteServer: typeof deleteMcpServer
  testConnection: typeof testMcpConnection
  previewTools: typeof previewMcpTools
  confirmTools: typeof confirmMcpTools
  setServerEnabled: typeof setMcpServerEnabled
  setServerTrust: typeof setMcpServerTrust
  listTools: typeof listMcpTools
  updateTool: typeof updateMcpTool
  testTool: typeof testMcpTool
  approve: typeof approveMcpRequest
  deny: typeof denyMcpRequest
  listRuns: typeof listMcpRuns
}

export type McpUiError = { code: string; message: string; status?: number }

export type McpServersState = {
  api: McpServersApi
  servers: McpServer[]
  selectedServerId: string | null
  tools: McpTool[]
  toolCounts: Record<string, number>
  runs: McpRun[]
  preview: McpPreview | null
  connectionTest: McpDiscoveredTool[] | null
  pendingApproval: McpApprovalState | null
  lastTest: { status: string; result?: unknown; run?: McpRun } | null
  featureDisabled: boolean
  loading: boolean
  busyAction: string | null
  error: McpUiError | null
}

export type McpServersActions = {
  loadServers: () => Promise<void>
  selectServer: (serverId: string | null) => Promise<void>
  loadServerDetails: (serverId?: string) => Promise<void>
  createServer: (input: McpServerConfigInput) => Promise<McpServer | undefined>
  updateServer: (serverId: string, input: McpServerPatch) => Promise<McpServer | undefined>
  deleteServer: (serverId: string) => Promise<void>
  testConnection: (serverId?: string) => Promise<void>
  refreshPreview: (serverId?: string) => Promise<void>
  confirmPreview: () => Promise<void>
  setServerEnabled: (serverId: string, enabled: boolean) => Promise<void>
  setServerTrust: (serverId: string, trustLevel: 'untrusted' | 'reviewed' | 'trusted') => Promise<void>
  setToolEnabled: (toolId: string, enabled: boolean) => Promise<void>
  runToolTest: (toolId: string, input: JsonValue) => Promise<void>
  approvePending: () => Promise<void>
  denyPending: () => Promise<void>
  clearError: () => void
  reset: () => void
}

const defaultApi: McpServersApi = {
  listServers: listMcpServers,
  getServer: getMcpServer,
  createServer: createMcpServer,
  updateServer: updateMcpServer,
  deleteServer: deleteMcpServer,
  testConnection: testMcpConnection,
  previewTools: previewMcpTools,
  confirmTools: confirmMcpTools,
  setServerEnabled: setMcpServerEnabled,
  setServerTrust: setMcpServerTrust,
  listTools: listMcpTools,
  updateTool: updateMcpTool,
  testTool: testMcpTool,
  approve: approveMcpRequest,
  deny: denyMcpRequest,
  listRuns: listMcpRuns,
}

const emptyState = (): McpServersState => ({
  api: defaultApi,
  servers: [],
  selectedServerId: null,
  tools: [],
  toolCounts: {},
  runs: [],
  preview: null,
  connectionTest: null,
  pendingApproval: null,
  lastTest: null,
  featureDisabled: false,
  loading: false,
  busyAction: null,
  error: null,
})

function errorFrom(value: unknown): McpUiError {
  const candidate = value as { code?: unknown; message?: unknown; status?: unknown } | null
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'MCP_UI_ERROR',
    message: typeof candidate?.message === 'string' ? candidate.message : 'MCP request failed',
    ...(typeof candidate?.status === 'number' ? { status: candidate.status } : {}),
  }
}

function isMcpDisabled(value: unknown): boolean {
  return (value as { code?: unknown } | null)?.code === 'MCP_DISABLED'
}

function replaceServer(servers: McpServer[], server: McpServer): McpServer[] {
  const exists = servers.some((entry) => entry.id === server.id)
  return exists ? servers.map((entry) => entry.id === server.id ? server : entry) : [...servers, server]
}

function selectedServer(get: () => McpServersState): McpServer | undefined {
  const id = get().selectedServerId
  return id ? get().servers.find((server) => server.id === id) : undefined
}

export const useMcpServersStore = create<McpServersState & McpServersActions>()(
  devtools((set, get) => ({
    ...emptyState(),

    loadServers: async () => {
      set({ loading: true, error: null, busyAction: 'load-servers' })
      try {
        const servers = await get().api.listServers()
        const currentId = get().selectedServerId
        const nextId = currentId && servers.some((server) => server.id === currentId) ? currentId : servers[0]?.id ?? null
        const toolCounts: Record<string, number> = {}
        await Promise.all(servers.map(async (server) => {
          try {
            const tools = await get().api.listTools(server.id, false)
            toolCounts[server.id] = tools.length
          } catch {
            // A server may have no confirmed catalog or may be temporarily unavailable.
            // Keep the list usable and let the selected detail view surface the error.
          }
        }))
        set({ servers, selectedServerId: nextId, toolCounts, featureDisabled: false, loading: false, busyAction: null })
        if (nextId) await get().loadServerDetails(nextId)
      } catch (error) {
        const uiError = errorFrom(error)
        set({
          loading: false,
          busyAction: null,
          featureDisabled: isMcpDisabled(error),
          error: uiError,
          ...(isMcpDisabled(error) ? { servers: [], selectedServerId: null, tools: [], preview: null } : {}),
        })
      }
    },

    selectServer: async (serverId) => {
      set({ selectedServerId: serverId, tools: [], runs: [], preview: null, connectionTest: null, pendingApproval: null, lastTest: null, error: null })
      if (serverId) await get().loadServerDetails(serverId)
    },

    loadServerDetails: async (serverId = get().selectedServerId ?? undefined) => {
      if (!serverId) return
      set({ loading: true, error: null, busyAction: 'load-details' })
      try {
        const [tools, runs, server] = await Promise.all([
          get().api.listTools(serverId, true),
          get().api.listRuns(serverId, { limit: 100 }),
          get().api.getServer(serverId),
        ])
        set((state) => ({
          servers: replaceServer(state.servers, server),
          selectedServerId: server.id,
          tools,
          toolCounts: { ...state.toolCounts, [server.id]: tools.filter((tool) => !tool.isRemoved).length },
          runs,
          loading: false,
          busyAction: null,
        }))
      } catch (error) {
        set({ loading: false, busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    createServer: async (input) => {
      set({ busyAction: 'create-server', error: null })
      try {
        const server = await get().api.createServer(input)
        set((state) => ({
          servers: replaceServer(state.servers, server),
          selectedServerId: server.id,
          tools: [],
          toolCounts: { ...state.toolCounts, [server.id]: 0 },
          runs: [],
          preview: null,
          connectionTest: null,
          busyAction: null,
          featureDisabled: false,
        }))
        return server
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
        return undefined
      }
    },

    updateServer: async (serverId, input) => {
      set({ busyAction: 'update-server', error: null })
      try {
        const server = await get().api.updateServer(serverId, input)
        set((state) => ({
          servers: replaceServer(state.servers, server),
          selectedServerId: server.id,
          // A config/name/transport update invalidates old Preview, Catalog and connection state.
          tools: [],
          toolCounts: { ...state.toolCounts, [server.id]: 0 },
          preview: null,
          connectionTest: null,
          pendingApproval: null,
          lastTest: null,
          busyAction: null,
        }))
        return server
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
        return undefined
      }
    },

    deleteServer: async (serverId) => {
      set({ busyAction: 'delete-server', error: null })
      try {
        await get().api.deleteServer(serverId)
        const remaining = get().servers.filter((server) => server.id !== serverId)
        const nextId = get().selectedServerId === serverId ? remaining[0]?.id ?? null : get().selectedServerId
        const toolCounts = { ...get().toolCounts }
        delete toolCounts[serverId]
        set({ servers: remaining, selectedServerId: nextId, tools: [], toolCounts, runs: [], preview: null, connectionTest: null, pendingApproval: null, lastTest: null, busyAction: null })
        if (nextId) await get().loadServerDetails(nextId)
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    testConnection: async (serverId = get().selectedServerId ?? undefined) => {
      if (!serverId) return
      set({ busyAction: 'test-connection', error: null })
      try {
        const result = await get().api.testConnection(serverId)
        set((state) => ({ servers: replaceServer(state.servers, result.server), connectionTest: result.tools, busyAction: null }))
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    refreshPreview: async (serverId = get().selectedServerId ?? undefined) => {
      if (!serverId) return
      set({ busyAction: 'refresh-preview', error: null })
      try {
        const preview = await get().api.previewTools(serverId)
        set({ preview, connectionTest: null, busyAction: null })
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error), preview: null })
      }
    },

    confirmPreview: async () => {
      const server = selectedServer(get)
      const preview = get().preview
      if (!server || !preview) return
      set({ busyAction: 'confirm-preview', error: null })
      try {
        const result = await get().api.confirmTools(server.id, {
          previewId: preview.previewId,
          previewHash: preview.previewHash,
          configHash: preview.configHash,
          catalogVersion: preview.catalogVersion,
        })
        set((state) => ({
          servers: replaceServer(state.servers, result.server),
          tools: result.tools,
          toolCounts: { ...state.toolCounts, [server.id]: result.tools.filter((tool) => !tool.isRemoved).length },
          preview: null,
          connectionTest: null,
          pendingApproval: null,
          busyAction: null,
        }))
      } catch (error) {
        const uiError = errorFrom(error)
        set({ busyAction: null, error: uiError, preview: uiError.code === 'MCP_PREVIEW_STALE' ? null : get().preview })
      }
    },

    setServerEnabled: async (serverId, enabled) => {
      set({ busyAction: enabled ? 'enable-server' : 'disable-server', error: null })
      try {
        const server = await get().api.setServerEnabled(serverId, enabled)
        set((state) => ({ servers: replaceServer(state.servers, server), busyAction: null }))
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    setServerTrust: async (serverId, trustLevel) => {
      set({ busyAction: 'trust-server', error: null })
      try {
        const server = await get().api.setServerTrust(serverId, trustLevel)
        set((state) => ({ servers: replaceServer(state.servers, server), busyAction: null }))
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    setToolEnabled: async (toolId, enabled) => {
      const server = selectedServer(get)
      if (!server) return
      set({ busyAction: `tool:${toolId}`, error: null })
      try {
        const tool = await get().api.updateTool(server.id, toolId, enabled)
        set((state) => ({ tools: state.tools.map((entry) => entry.id === tool.id ? tool : entry), busyAction: null }))
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    runToolTest: async (toolId, input) => {
      const server = selectedServer(get)
      if (!server) return
      set({ busyAction: `test:${toolId}`, error: null, pendingApproval: null })
      try {
        const result = await get().api.testTool(server.id, toolId, input)
        set({ lastTest: result, pendingApproval: null, busyAction: null })
        await get().loadServerDetails(server.id)
      } catch (error) {
        const candidate = error as { code?: unknown; details?: unknown }
        const approval = candidate?.code === 'MCP_APPROVAL_REQUIRED' ? sanitizeMcpApprovalDetails(candidate.details) : undefined
        set({
          lastTest: null,
          pendingApproval: approval ?? null,
          busyAction: null,
          error: approval ? null : errorFrom(error),
          featureDisabled: isMcpDisabled(error),
        })
      }
    },

    approvePending: async () => {
      const server = selectedServer(get)
      const approval = get().pendingApproval
      if (!server || !approval) return
      set({ busyAction: 'approve', error: null })
      try {
        const result = await get().api.approve(server.id, approval.approvalRequestId)
        set({ pendingApproval: null, lastTest: result, busyAction: null })
        await get().loadServerDetails(server.id)
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    denyPending: async () => {
      const server = selectedServer(get)
      const approval = get().pendingApproval
      if (!server || !approval) return
      set({ busyAction: 'deny', error: null })
      try {
        const result = await get().api.deny(server.id, approval.approvalRequestId)
        set({ pendingApproval: null, lastTest: result, busyAction: null })
        await get().loadServerDetails(server.id)
      } catch (error) {
        set({ busyAction: null, error: errorFrom(error), featureDisabled: isMcpDisabled(error) })
      }
    },

    clearError: () => set({ error: null }),
    reset: () => set(emptyState()),
  }), { name: 'bloomai-mcp-servers' }),
)
