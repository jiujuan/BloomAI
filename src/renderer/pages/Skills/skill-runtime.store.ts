import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { platform, SkillRuntimeApiError } from '@renderer/api'
import type { CapabilityDto, DraftDto, InspectedPackage, PackageDetail, PackageInstallInput, PackageSource, Page, PaginationInput, RuntimeError, RunAction, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRunEvent, SkillRuntimeCapabilities, SkillVersion, VersionCandidate } from './skill-runtime.types'

function makeIdempotencyKey(operation: string) {
  return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function asRuntimeError(error: unknown): RuntimeError {
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) return error as RuntimeError
  return { code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Skill Runtime request failed', status: 0, retryable: true }
}

function toLegacyPackage(item: SkillPackage): SkillPackage {
  return {
    ...item,
    source_type: item.sourceType,
    source_uri: item.sourceUri,
    source_ref: item.sourceRef,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: item.deletedAt,
    delete_reason: item.deleteReason,
  }
}

function toLegacyPackageDetail(detail: PackageDetail): PackageDetail {
  return {
    ...detail,
    package: {
      ...toLegacyPackage(detail.package),
      source_type: detail.package.sourceType,
      source_uri: detail.package.sourceUri,
      source_ref: detail.package.sourceRef,
      created_at: detail.package.createdAt,
      updated_at: detail.package.updatedAt,
      deleted_at: detail.package.deletedAt,
      delete_reason: detail.package.deleteReason,
    },
    versions: detail.versions.map((version) => ({
      ...version,
      package_id: version.packageId,
      manifest_json: JSON.stringify(version.manifest),
      package_path: version.packagePath,
      manifest_hash: version.manifestHash,
      is_compatible: version.isCompatible ? 1 : 0,
      immutable_hash: version.immutableHash,
      security_status: version.securityStatus,
      snapshot_hash: version.snapshotHash,
      source_snapshot_json: JSON.stringify(version.sourceSnapshot),
      published_at: version.publishedAt,
      created_at: version.createdAt,
    })),
    installations: detail.installations.map((installation) => ({
      ...installation,
      package_id: installation.packageId,
      current_version_id: installation.currentVersionId,
      enabled: installation.enabled ? 1 : 0,
      installed_at: installation.installedAt,
      updated_at: installation.updatedAt,
      previous_version_id: installation.previousVersionId,
      changed_at: installation.changedAt,
      disabled_at: installation.disabledAt,
      uninstalled_at: installation.uninstalledAt,
      deleted_at: installation.deletedAt,
      rollback_reason: installation.rollbackReason,
    })),
    capabilityGrants: detail.capabilityGrants.map((grant) => ({
      ...grant,
      skill_version_id: grant.skillVersionId,
      scope_json: JSON.stringify(grant.scope),
      granted_by: grant.grantedBy ?? null,
      granted_at: grant.grantedAt ?? 0,
      expires_at: grant.expiresAt ?? null,
      revoked_at: grant.revokedAt ?? null,
      consumed_at: grant.consumedAt ?? null,
      grant_mode: grant.grantMode ?? grant.grant_mode ?? '',
    })),
  }
}

function legacyArtifact(artifact: SkillArtifact): SkillArtifact {
  return {
    ...artifact,
    run_id: artifact.runId,
    mime_type: artifact.mimeType,
    size_bytes: artifact.sizeBytes,
    metadata_json: JSON.stringify(artifact.metadata),
    created_at: artifact.createdAt,
  }
}

type RuntimeState = {
  packages: SkillPackage[]
  packagePage: Page<SkillPackage> | null
  selectedPackage: PackageDetail | null
  selectedVersion: SkillVersion | null
  installations: SkillInstallation[]
  runs: SkillRun[]
  runPage: Page<SkillRun> | null
  selectedRun: SkillRun | null
  eventsByRun: Record<string, SkillRunEvent[]>
  eventCursorByRun: Record<string, number>
  artifactsByRun: Record<string, SkillArtifact[]>
  runCapabilitiesByRun: Record<string, CapabilityDto[]>
  drafts: Record<string, DraftDto>
  pendingMutations: Record<string, boolean>
  capabilities: SkillRuntimeCapabilities | null
  loading: boolean
  error: string | null
  errorDetails: RuntimeError | null
  /** @deprecated Compatibility projection for the pre-v1.1 Run detail drawer. */
  runEvents: SkillRunEvent[]
  /** @deprecated Compatibility projection for the pre-v1.1 Run detail drawer. */
  runArtifacts: SkillArtifact[]
}

type RuntimeActions = {
  clearError: () => void
  loadCapabilities: () => Promise<SkillRuntimeCapabilities>
  loadPackages: (input?: PaginationInput) => Promise<Page<SkillPackage>>
  loadPackage: (id: string) => Promise<PackageDetail>
  loadVersions: (packageId: string) => Promise<SkillVersion[]>
  selectVersion: (version: SkillVersion | null) => void
  inspectPackage: (source: PackageSource) => Promise<InspectedPackage[]>
  installPackage: (input: PackageSource | PackageInstallInput) => Promise<PackageDetail | Record<string, unknown>>
  setInstallationEnabled: (id: string, enabled: boolean, expectedRevision: number) => Promise<SkillInstallation>
  enableInstallation: (id: string, input: { expectedRevision: number; idempotencyKey: string }) => Promise<SkillInstallation>
  disableInstallation: (id: string, input: { expectedRevision: number; idempotencyKey: string }) => Promise<SkillInstallation>
  uninstallPackage: (id: string, expectedRevision: number) => Promise<SkillInstallation>
  rollbackInstallation: (id: string, input: { versionId?: string; expectedRevision: number; idempotencyKey?: string; reason: string }) => Promise<SkillInstallation>
  deletePackage: (id: string, input: { reason: string; idempotencyKey?: string }) => Promise<Record<string, unknown>>
  approve: (grantId: string, input: { actor: string; scope?: Record<string, unknown>; expiresAt?: number | null }) => Promise<CapabilityDto>
  reject: (grantId: string, input: { actor: string; reason?: string }) => Promise<CapabilityDto>
  revokeCapabilityGrant: (id: string, input?: { actor: string; reason?: string }) => Promise<CapabilityDto | Record<string, unknown>>
  loadRuns: (input?: PaginationInput & { status?: SkillRun['status']; skillVersionId?: string }) => Promise<Page<SkillRun>>
  loadRun: (id: string) => Promise<SkillRun>
  loadRunEvents: (id: string, afterSeq?: number) => Promise<SkillRunEvent[]>
  loadRunCapabilities: (id: string) => Promise<CapabilityDto[]>
  subscribeRunEvents: (id: string) => () => void
  stopRunEvents: (id: string) => void
  appendEvents: (runId: string, events: SkillRunEvent[]) => SkillRunEvent[]
  reconnectRunEvents: (runId: string) => Promise<SkillRunEvent[]>
  loadArtifacts: (id: string, input?: PaginationInput) => Promise<SkillArtifact[]>
  exportArtifact: (artifactId: string, input: { runId: string; destinationDir: string; confirmed: true; actor?: string; auditReason: string }) => Promise<{ path: string }>
  startRun: (input: { skillVersionId: string; input: Record<string, unknown>; surface?: 'skills' | 'chat' | 'image' }) => Promise<SkillRun>
  createRun: (input: Parameters<typeof platform.createSkillRun>[0]) => Promise<SkillRun>
  commandRun: (id: string, command: Extract<RunAction, { type: 'confirm' | 'cancel' }> | { type: 'confirm' | 'cancel'; expectedRevision: number; idempotencyKey?: string }) => Promise<SkillRun>
  dispatchCommand: (id: string, command: RunAction) => Promise<SkillRun>
  approveRun: (id: string, expectedRevision: number) => Promise<SkillRun>
  rejectRun: (id: string, expectedRevision: number, reason?: string) => Promise<SkillRun>
  cancelRun: (id: string, expectedRevision: number, reason?: string) => Promise<SkillRun>
  retryRun: (id: string, expectedRevision: number) => Promise<SkillRun>
  submitRunInput: (id: string, expectedRevision: number, input: Record<string, unknown>) => Promise<SkillRun>
  refreshAfterConflict: (scope?: 'package' | 'run' | 'draft', id?: string) => Promise<void>
  loadDraft: (id: string) => Promise<DraftDto>
  createDraft: (input: Parameters<typeof platform.createSkillDraft>[0]) => Promise<DraftDto>
  updateDraft: (id: string, input: Parameters<typeof platform.updateSkillDraft>[1]) => Promise<DraftDto>
  validateDraft: (id: string) => ReturnType<typeof platform.validateSkillDraft>
  previewDraft: (id: string) => ReturnType<typeof platform.previewSkillDraft>
  publishDraft: (id: string, input?: { enable?: boolean }) => ReturnType<typeof platform.publishSkillDraft>
  discardDraft: (id: string) => Promise<DraftDto>
}

export type SkillRuntimeStore = RuntimeState & RuntimeActions

export const useSkillRuntimeStore = create<SkillRuntimeStore>()(devtools((set, get) => {
  const eventStreams = new Map<string, { close: () => void }>()
  const withMutation = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    set((state) => ({ pendingMutations: { ...state.pendingMutations, [key]: true }, error: null, errorDetails: null }))
    try {
      const result = await action()
      set((state) => {
        const pending = { ...state.pendingMutations }
        delete pending[key]
        return { pendingMutations: pending }
      })
      return result
    } catch (error) {
      const details = asRuntimeError(error)
      set((state) => {
        const pending = { ...state.pendingMutations }
        delete pending[key]
        return { pendingMutations: pending, error: details.message, errorDetails: details }
      })
      throw error
    }
  }

  return {
    packages: [], packagePage: null, selectedPackage: null, selectedVersion: null, installations: [], runs: [], runPage: null, selectedRun: null,
    eventsByRun: {}, eventCursorByRun: {}, artifactsByRun: {}, runCapabilitiesByRun: {}, drafts: {}, pendingMutations: {}, capabilities: null, loading: false, error: null, errorDetails: null,
    runEvents: [], runArtifacts: [],
    clearError: () => set({ error: null, errorDetails: null }),
    loadCapabilities: async () => {
      try {
        const capabilities = await platform.getSkillRuntimeCapabilities()
        set({ capabilities })
        return capabilities
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        throw error
      }
    },
    loadPackages: async (input = {}) => {
      set({ loading: true, error: null, errorDetails: null })
      try {
        const result = await platform.getSkillPackages(input)
        const legacyPage = { ...result, data: result.data.map(toLegacyPackage) }
        set({ packages: legacyPage.data, packagePage: legacyPage, installations: get().installations, loading: false })
        return legacyPage
      } catch (error) {
        const details = asRuntimeError(error)
        set({ loading: false, error: details.message, errorDetails: details })
        throw error
      }
    },
    loadPackage: async (id) => {
      try {
        const detail = toLegacyPackageDetail(await platform.getSkillPackage(id))
        set({ selectedPackage: detail, selectedVersion: detail.versions[0] ?? null, installations: detail.installations })
        return detail
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        throw error
      }
    },
    loadVersions: async (packageId) => {
      const versions = await platform.getSkillVersions(packageId)
      set({ selectedVersion: versions[0] ?? null })
      return versions
    },
    selectVersion: (version) => set({ selectedVersion: version }),
    inspectPackage: (source) => platform.inspectSkillPackage(source),
    installPackage: async (input) => {
      if ('reviewId' in input) {
        const result = await withMutation('install', async () => platform.installSkillPackage(input))
        await get().loadPackages()
        return result
      }
      throw new SkillRuntimeApiError({ code: 'VALIDATION_ERROR', message: 'Package installation requires an approved inspection review', status: 400, retryable: false })
    },
    enableInstallation: (id, input) => withMutation(`installation:${id}`, async () => {
      const result = await platform.enableSkillInstallation(id, input)
      await get().refreshAfterConflict('package')
      return result
    }),
    disableInstallation: (id, input) => withMutation(`installation:${id}`, async () => {
      const result = await platform.disableSkillInstallation(id, input)
      await get().refreshAfterConflict('package')
      return result
    }),
    setInstallationEnabled: (id, enabled, expectedRevision) => {
      const input = { expectedRevision, idempotencyKey: makeIdempotencyKey(enabled ? 'enable' : 'disable') }
      return enabled ? get().enableInstallation(id, input) : get().disableInstallation(id, input)
    },
    uninstallPackage: (id, expectedRevision) => withMutation(`installation:${id}`, async () => {
      const result = await platform.uninstallSkillInstallation(id, { expectedRevision, idempotencyKey: makeIdempotencyKey('uninstall') })
      set({ selectedPackage: null })
      await get().loadPackages()
      return result
    }),
    rollbackInstallation: (id, input) => withMutation(`installation:${id}`, async () => {
      const result = await platform.rollbackSkillInstallation(id, { ...input, idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey('rollback') })
      await get().refreshAfterConflict('package')
      return result
    }),
    deletePackage: (id, input) => withMutation(`package:${id}`, async () => {
      const result = await platform.deleteSkillPackage(id, { ...input, idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey('delete-package') })
      set({ selectedPackage: null })
      await get().loadPackages()
      return result
    }),
    approve: (id, input) => withMutation(`grant:${id}`, async () => platform.approveCapabilityGrant(id, input)),
    reject: (id, input) => withMutation(`grant:${id}`, async () => platform.rejectCapabilityGrant(id, input)),
    revokeCapabilityGrant: (id, input) => withMutation(`grant:${id}`, async () => platform.revokeCapabilityGrant(id, input)),
    loadRuns: async (input = {}) => {
      set({ loading: true, error: null, errorDetails: null })
      try {
        const result = await platform.listSkillRuns(input)
        set({ runs: result.data, runPage: result, loading: false })
        return result
      } catch (error) {
        const details = asRuntimeError(error)
        set({ loading: false, error: details.message, errorDetails: details })
        throw error
      }
    },
    loadRun: async (id) => {
      try {
        const run = await platform.getSkillRun(id)
        set({ selectedRun: run })
        return run
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        throw error
      }
    },
    loadRunEvents: async (id, afterSeq) => {
      const cursor = afterSeq ?? get().eventCursorByRun[id] ?? 0
      try {
        const events = await platform.listSkillRunEvents(id, cursor)
        get().appendEvents(id, events)
        return events
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        throw error
      }
    },
    loadRunCapabilities: async (id) => {
      try {
        const capabilities = await platform.getSkillRunCapabilities(id)
        set((state) => ({ runCapabilitiesByRun: { ...state.runCapabilitiesByRun, [id]: capabilities } }))
        return capabilities
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        throw error
      }
    },
    subscribeRunEvents: (id) => {
      eventStreams.get(id)?.close()
      const cursor = get().eventCursorByRun[id] ?? 0
      try {
        const stream = platform.subscribeSkillRunEvents(id, cursor, {
          onEvent: (event) => { get().appendEvents(id, [event]) },
          onError: (error) => { set({ error: error.message, errorDetails: error }) },
        })
        eventStreams.set(id, stream)
        return () => {
          if (eventStreams.get(id) === stream) eventStreams.delete(id)
          stream.close()
        }
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details })
        return () => undefined
      }
    },
    stopRunEvents: (id) => {
      eventStreams.get(id)?.close()
      eventStreams.delete(id)
    },
    appendEvents: (runId, events) => {
      const current = get().eventsByRun[runId] ?? []
      const bySeq = new Map(current.map((event) => [event.seq, event]))
      for (const event of events) bySeq.set(event.seq, event)
      const next = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
      const cursor = next.reduce((max, event) => Math.max(max, event.seq), get().eventCursorByRun[runId] ?? 0)
      set((state) => ({ eventsByRun: { ...state.eventsByRun, [runId]: next }, eventCursorByRun: { ...state.eventCursorByRun, [runId]: cursor }, runEvents: state.selectedRun?.id === runId ? next : state.runEvents }))
      return next
    },
    reconnectRunEvents: async (runId) => {
      const cursor = get().eventCursorByRun[runId] ?? 0
      try {
        return await get().loadRunEvents(runId, cursor)
      } catch {
        return await get().loadRunEvents(runId, cursor)
      }
    },
    loadArtifacts: async (id, input) => {
      const result = await platform.listSkillArtifacts(id, input)
      const artifacts = result.data
      set((state) => ({ artifactsByRun: { ...state.artifactsByRun, [id]: artifacts }, runArtifacts: state.selectedRun?.id === id ? artifacts.map(legacyArtifact) : state.runArtifacts }))
      return artifacts
    },
    exportArtifact: (artifactId, input) => withMutation(`artifact:${artifactId}`, async () => platform.exportSkillArtifact(artifactId, input)),
    startRun: async (input) => get().createRun(input),
    createRun: async (input) => withMutation('run:create', async () => {
      const run = await platform.createSkillRun(input)
      set((state) => ({ selectedRun: run, runs: state.runs.some((item) => item.id === run.id) ? state.runs : [run, ...state.runs] }))
      return run
    }),
    commandRun: (id, command) => get().dispatchCommand(id, { ...command, idempotencyKey: command.idempotencyKey || makeIdempotencyKey(command.type) } as RunAction),
    dispatchCommand: (id, command) => withMutation(`run:${id}`, async () => {
      const run = await platform.dispatchSkillRunCommand(id, command)
      set((state) => ({ selectedRun: run, runs: state.runs.map((item) => item.id === id ? run : item) }))
      await get().loadRunEvents(id)
      return run
    }),
    approveRun: (id, expectedRevision) => get().dispatchCommand(id, { type: 'approve', expectedRevision, idempotencyKey: makeIdempotencyKey('approve') }),
    rejectRun: (id, expectedRevision, reason) => get().dispatchCommand(id, { type: 'reject', expectedRevision, reason, idempotencyKey: makeIdempotencyKey('reject') }),
    cancelRun: (id, expectedRevision, reason) => withMutation(`run:${id}`, async () => {
      const run = await platform.cancelSkillRun(id, { expectedRevision, reason, idempotencyKey: makeIdempotencyKey('cancel') })
      set((state) => ({ selectedRun: run, runs: state.runs.map((item) => item.id === id ? run : item) }))
      return run
    }),
    retryRun: (id, expectedRevision) => get().dispatchCommand(id, { type: 'retry', expectedRevision, idempotencyKey: makeIdempotencyKey('retry') }),
    submitRunInput: (id, expectedRevision, input) => get().dispatchCommand(id, { type: 'submit_input', expectedRevision, input, idempotencyKey: makeIdempotencyKey('submit_input') }),
    refreshAfterConflict: async (scope, id) => {
      if (scope === 'package' || (!scope && get().selectedPackage)) {
        const packageId = id ?? get().selectedPackage?.package.id
        if (packageId) await get().loadPackage(packageId)
      }
      if (scope === 'run' || (!scope && get().selectedRun)) {
        const runId = id ?? get().selectedRun?.id
        if (runId) await get().loadRun(runId)
      }
      if (scope === 'draft' && id) await get().loadDraft(id)
    },
    loadDraft: async (id) => {
      const draft = await platform.getSkillDraft(id)
      set((state) => ({ drafts: { ...state.drafts, [draft.id]: draft } }))
      return draft
    },
    createDraft: async (input) => withMutation('draft:create', async () => {
      const draft = await platform.createSkillDraft(input)
      set((state) => ({ drafts: { ...state.drafts, [draft.id]: draft } }))
      return draft
    }),
    updateDraft: async (id, input) => withMutation(`draft:${id}`, async () => {
      const draft = await platform.updateSkillDraft(id, input)
      set((state) => ({ drafts: { ...state.drafts, [draft.id]: draft } }))
      return draft
    }),
    validateDraft: async (id) => platform.validateSkillDraft(id),
    previewDraft: async (id) => platform.previewSkillDraft(id),
    publishDraft: async (id, input) => withMutation(`draft:${id}`, async () => platform.publishSkillDraft(id, input)),
    discardDraft: async (id) => withMutation(`draft:${id}`, async () => {
      const draft = await platform.discardSkillDraft(id)
      set((state) => ({ drafts: { ...state.drafts, [draft.id]: draft } }))
      return draft
    }),
  }
}, { name: 'bloomai-skill-runtime' }))