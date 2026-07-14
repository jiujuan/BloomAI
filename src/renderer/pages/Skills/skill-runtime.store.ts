import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { API_BASE } from '@shared/constants'
import type { CapabilityGrant, InspectedPackage, PackageDetail, PackageSource, SkillArtifact, SkillPackage, SkillRun, SkillRunEvent } from './skill-runtime.types'

async function runtimeFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  })
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null
  if (!response.ok) throw new Error(payload?.error?.message || ('HTTP ' + response.status))
  return payload?.data as T
}

type RuntimeState = {
  packages: SkillPackage[]
  runs: SkillRun[]
  selectedPackage: PackageDetail | null
  selectedRun: SkillRun | null
  runEvents: SkillRunEvent[]
  runArtifacts: SkillArtifact[]
  loading: boolean
  error: string | null
}

type RuntimeActions = {
  loadPackages: () => Promise<void>
  loadPackage: (id: string) => Promise<PackageDetail>
  inspectPackage: (source: PackageSource) => Promise<InspectedPackage[]>
  installPackage: (source: PackageSource) => Promise<void>
  setInstallationEnabled: (id: string, enabled: boolean) => Promise<void>
  uninstallPackage: (id: string) => Promise<void>
  revokeCapabilityGrant: (id: string) => Promise<void>
  loadRuns: () => Promise<void>
  loadRun: (id: string) => Promise<SkillRun>
  loadRunEvents: (id: string) => Promise<void>
  loadArtifacts: (id: string) => Promise<void>
  startRun: (input: { skillVersionId: string; input: Record<string, unknown>; surface?: 'skills' }) => Promise<SkillRun>
  commandRun: (id: string, command: { type: 'confirm' | 'cancel'; expectedRevision: number }) => Promise<SkillRun>
  clearError: () => void
}

export const useSkillRuntimeStore = create<RuntimeState & RuntimeActions>()(devtools((set, get) => ({
  packages: [], runs: [], selectedPackage: null, selectedRun: null, runEvents: [], runArtifacts: [], loading: false, error: null,
  clearError: () => set({ error: null }),
  loadPackages: async () => {
    set({ loading: true, error: null })
    try {
      const packages = await runtimeFetch<SkillPackage[]>('/skill-packages?limit=100')
      set({ packages, loading: false })
    } catch (error) { set({ loading: false, error: error instanceof Error ? error.message : 'Failed to load installed packages' }) }
  },
  loadPackage: async (id) => {
    const detail = await runtimeFetch<PackageDetail>('/skill-packages/' + encodeURIComponent(id))
    set({ selectedPackage: detail })
    return detail
  },
  inspectPackage: async (source) => {
    const response = await runtimeFetch<{ packages: InspectedPackage[] }>('/skill-packages/inspect', { method: 'POST', body: JSON.stringify({ source }) })
    return response.packages
  },
  installPackage: async (source) => {
    await runtimeFetch('/skill-packages/install', { method: 'POST', body: JSON.stringify({ source }) })
    await get().loadPackages()
  },
  setInstallationEnabled: async (id, enabled) => {
    await runtimeFetch('/skill-installations/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ enabled }) })
    const selectedPackage = get().selectedPackage
    if (selectedPackage) await get().loadPackage(selectedPackage.package.id)
    await get().loadPackages()
  },
  uninstallPackage: async (id) => {
    await runtimeFetch('/skill-installations/' + encodeURIComponent(id), { method: 'DELETE' })
    set({ selectedPackage: null })
    await get().loadPackages()
  },
  revokeCapabilityGrant: async (id) => {
    await runtimeFetch('/skill-capability-grants/' + encodeURIComponent(id), { method: 'DELETE' })
    const selectedPackage = get().selectedPackage
    if (selectedPackage) await get().loadPackage(selectedPackage.package.id)
  },
  loadRuns: async () => {
    set({ loading: true, error: null })
    try {
      const runs = await runtimeFetch<SkillRun[]>('/skill-runs?limit=100')
      set({ runs, loading: false })
    } catch (error) { set({ loading: false, error: error instanceof Error ? error.message : 'Failed to load skill runs' }) }
  },
  loadRun: async (id) => {
    const run = await runtimeFetch<SkillRun>('/skill-runs/' + encodeURIComponent(id))
    set({ selectedRun: run })
    return run
  },
  loadRunEvents: async (id) => {
    const runEvents = await runtimeFetch<SkillRunEvent[]>('/skill-runs/' + encodeURIComponent(id) + '/events?afterSeq=0')
    set({ runEvents })
  },
  loadArtifacts: async (id) => {
    const artifacts = await runtimeFetch<SkillArtifact[]>('/skill-runs/' + encodeURIComponent(id) + '/artifacts')
    set({ runArtifacts: artifacts })
  },
  startRun: async ({ skillVersionId, input, surface = 'skills' }) => {
    const created = await runtimeFetch<{ runId: string }>('/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId, input, surface }) })
    const run = await get().loadRun(created.runId)
    await get().loadRuns()
    return run
  },
  commandRun: async (id, command) => {
    const run = await runtimeFetch<SkillRun>('/skill-runs/' + encodeURIComponent(id) + '/commands', {
      method: 'POST',
      body: JSON.stringify({ ...command, idempotencyKey: command.type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) }),
    })
    set({ selectedRun: run })
    await get().loadRuns()
    await get().loadRunEvents(id)
    return run
  },
}), { name: 'bloomai-skill-runtime' }))
