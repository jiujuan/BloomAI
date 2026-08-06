import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { apiFetch } from '@renderer/api'

export interface SkillMigrationPreview {
  runtimeKind: 'legacy'
  legacySkillId: string
  legacyReference: string
  readOnly: true
  published: false
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  blockers: string[]
  recommendation: string
  templateVariables: string[]
  draft: { manifest: Record<string, unknown>; skillMd: string; source: string } | null
}

export interface Skill {
  runtimeKind?: 'legacy'
  id: string; name: string; description: string; type: string
  source: string; params_schema: string; author: string | null
  version: string; is_public: number; is_installed: number
  install_count: number; created_at: number
}

export interface LegacySkillRun {
  runtimeKind: 'legacy'
  skillId: string
  status: string
  output?: Record<string, unknown>
  runId?: string
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
  runSkill: (id: string, input: Record<string, unknown>) => Promise<LegacySkillRun>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dataArray(value: unknown): unknown[] {
  const payload = asRecord(value)
  return Array.isArray(payload.data) ? payload.data : []
}

function toLegacySkill(value: unknown): Skill {
  const row = asRecord(value)
  return {
    runtimeKind: 'legacy',
    id: String(row.id ?? ''), name: String(row.name ?? ''), description: String(row.description ?? ''), type: String(row.type ?? ''),
    source: String(row.source ?? ''), params_schema: String(row.params_schema ?? row.paramsSchema ?? '{}'), author: typeof row.author === 'string' ? row.author : null,
    version: String(row.version ?? ''), is_public: Number(row.is_public ?? row.isPublic ?? 0), is_installed: Number(row.is_installed ?? row.isInstalled ?? 0),
    install_count: Number(row.install_count ?? row.installCount ?? 0), created_at: Number(row.created_at ?? row.createdAt ?? 0),
  }
}

function toLegacySkills(value: unknown): Skill[] {
  return dataArray(value).map(toLegacySkill)
}

function toLegacySkillRun(value: unknown, skillId: string): LegacySkillRun {
  const row = asRecord(value)
  const output = row.output && typeof row.output === 'object' && !Array.isArray(row.output) ? row.output as Record<string, unknown> : undefined
  return {
    runtimeKind: 'legacy', skillId, status: String(row.status ?? 'completed'), output,
    runId: typeof row.runId === 'string' ? row.runId : typeof row.run_id === 'string' ? row.run_id : undefined,
  }
}

export const useSkillsStore = create<SkillsState & SkillsActions>()(
  devtools((set, get) => ({
    installed: [], market: [], loading: false,
    loadInstalled: async () => {
      const payload: unknown = await apiFetch('/skills')
      set({ installed: toLegacySkills(payload) })
    },
    loadMarket: async (query) => {
      set({ loading: true })
      try {
        const q = query ? `?q=${encodeURIComponent(query)}` : ''
        const payload: unknown = await apiFetch(`/skills/market${q}`)
        set({ market: toLegacySkills(payload), loading: false })
      } catch { set({ loading: false }) }
    },
    createSkill: async (data) => {
      const payload: unknown = await apiFetch('/skills', { method: 'POST', body: JSON.stringify(data) })
      await get().loadInstalled()
      return toLegacySkill(asRecord(payload).data)
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
      const payload: unknown = await apiFetch(`/skills/${id}/run`, { method: 'POST', body: JSON.stringify({ input }) })
      return toLegacySkillRun(asRecord(payload).data, id)
    },
  }), { name: 'bloomai-skills' })
)
