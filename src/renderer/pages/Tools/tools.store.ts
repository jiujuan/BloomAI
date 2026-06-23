import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { API_BASE } from '@shared/constants'

export interface Tool {
  id: string; category: string; name: string; description: string
  params_schema: string; result_schema: string
  is_builtin: number; is_enabled: number
  requires_permission: string | null; created_at: number
  permission?: { granted: number; scope: string } | null
}
export interface ToolRun {
  id: string; tool_id: string; session_id: string | null
  input_json: string; output_json: string | null; status: string
  error_msg: string | null; duration_ms: number | null
  started_at: number; finished_at: number | null
  tool_name?: string; category?: string
}

interface ToolsState {
  tools: Tool[]; toolRuns: ToolRun[]; stats: Record<string, any>; loading: boolean
  pendingPermission: { toolId: string; level: string; resolve: (granted: boolean) => void } | null
}
interface ToolsActions {
  loadTools: (category?: string) => Promise<void>
  loadRuns: () => Promise<void>
  loadStats: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runTool: (id: string, input: object, sessionId?: string) => Promise<any>
  grantPermission: (toolId: string, scope: string) => Promise<void>
  revokePermission: (toolId: string) => Promise<void>
  requestPermission: (toolId: string, level: string) => Promise<boolean>
  resolvePendingPermission: (granted: boolean) => void
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  return data
}

export const useToolsStore = create<ToolsState & ToolsActions>()(
  devtools((set, get) => ({
    tools: [], toolRuns: [], stats: {}, loading: false, pendingPermission: null,

    loadTools: async (category) => {
      set({ loading: true })
      try {
        const q = category && category !== 'all' ? `?category=${category}` : ''
        const { data } = await apiFetch(`/tools${q}`)
        set({ tools: data, loading: false })
      } catch { set({ loading: false }) }
    },
    loadRuns: async () => { const { data } = await apiFetch('/tools/runs?limit=100'); set({ toolRuns: data }) },
    loadStats: async () => { const { data } = await apiFetch('/tools/stats'); set({ stats: data }) },
    setEnabled: async (id, enabled) => {
      await apiFetch(`/tools/${id}`, { method: 'PATCH', body: JSON.stringify({ is_enabled: enabled }) })
      set(s => ({ tools: s.tools.map(t => t.id === id ? { ...t, is_enabled: enabled ? 1 : 0 } : t) }))
    },
    runTool: async (id, input, sessionId) => {
      const { data } = await apiFetch(`/tools/${id}/run`, { method: 'POST', body: JSON.stringify({ input, sessionId }) })
      await get().loadRuns(); await get().loadStats()
      return data
    },
    grantPermission: async (toolId, scope) => {
      await apiFetch(`/tools/permissions/${toolId}/grant`, { method: 'POST', body: JSON.stringify({ scope }) })
      await get().loadTools()
    },
    revokePermission: async (toolId) => {
      await apiFetch(`/tools/permissions/${toolId}/revoke`, { method: 'POST' })
      await get().loadTools()
    },
    requestPermission: (toolId, level) => new Promise<boolean>(resolve => set({ pendingPermission: { toolId, level, resolve } })),
    resolvePendingPermission: (granted) => {
      const pending = get().pendingPermission
      if (pending) { pending.resolve(granted); set({ pendingPermission: null }) }
    },
  }), { name: 'bloomai-tools' })
)
