import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface Skill {
  id: string; name: string; description: string; type: string
  source: string; params_schema: string; author: string | null
  version: string; is_public: number; is_installed: number
  install_count: number; created_at: number
}

interface SkillsState { installed: Skill[]; market: Skill[]; loading: boolean }
interface SkillsActions {
  loadInstalled: () => Promise<void>
  loadMarket: (query?: string) => Promise<void>
  createSkill: (data: Partial<Skill> & { name: string; description: string; type: string; source: string }) => Promise<Skill>
  updateSkill: (id: string, data: Partial<Skill>) => Promise<void>
  installSkill: (id: string) => Promise<void>
  uninstallSkill: (id: string) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  runSkill: (id: string, input: object) => Promise<any>
}

const API = 'http://127.0.0.1:3718/api/v1'
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  return data
}

export const useSkillsStore = create<SkillsState & SkillsActions>()(
  devtools((set, get) => ({
    installed: [], market: [], loading: false,
    loadInstalled: async () => { const { data } = await apiFetch('/skills'); set({ installed: data }) },
    loadMarket: async (query) => {
      set({ loading: true })
      try {
        const q = query ? `?q=${encodeURIComponent(query)}` : ''
        const { data } = await apiFetch(`/skills/market${q}`)
        set({ market: data, loading: false })
      } catch { set({ loading: false }) }
    },
    createSkill: async (data) => {
      const { data: skill } = await apiFetch('/skills', { method: 'POST', body: JSON.stringify(data) })
      await get().loadInstalled()
      return skill
    },
    updateSkill: async (id, data) => {
      await apiFetch(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      await get().loadInstalled()
    },
    installSkill: async (id) => {
      await apiFetch('/skills/install', { method: 'POST', body: JSON.stringify({ id }) })
      await get().loadInstalled(); await get().loadMarket()
    },
    uninstallSkill: async (id) => { await apiFetch(`/skills/${id}`, { method: 'DELETE' }); await get().loadInstalled() },
    deleteSkill: async (id) => { await apiFetch(`/skills/${id}`, { method: 'DELETE' }); await get().loadInstalled() },
    runSkill: async (id, input) => {
      const { data } = await apiFetch(`/skills/${id}/run`, { method: 'POST', body: JSON.stringify({ input }) })
      return data
    },
  }), { name: 'bloomai-skills' })
)
