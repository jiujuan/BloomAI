import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { platform, SkillRuntimeApiError } from '@renderer/api'
import type { CapabilityDto, DraftDto, DraftListInput, DraftPreview, DraftValidation, InspectedPackage, PackageDetail, PackageImportReview, PackageInspectionResult, PackageInstallInput, PackageListInput, PackageSource, Page, PaginationInput, RuntimeError, RuntimeErrorScope, RuntimeMutationState, RuntimeToast, RunAction, SkillArtifact, SkillInstallation, SkillPackage, SkillRun, SkillRunEvent, SkillRuntimeCapabilities, SkillRuntimeDiagnosticsSnapshot, SkillRuntimeFeatureFlags, SkillRuntimeSettings, SkillVersion, VersionCandidate } from './skill-runtime.types'

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
  installationPage: Page<SkillInstallation> | null
  runs: SkillRun[]
  runPage: Page<SkillRun> | null
  selectedRun: SkillRun | null
  eventsByRun: Record<string, SkillRunEvent[]>
  eventCursorByRun: Record<string, number>
  artifactsByRun: Record<string, SkillArtifact[]>
  runCapabilitiesByRun: Record<string, CapabilityDto[]>
  drafts: Record<string, DraftDto>
  draftPage: Page<DraftDto> | null
  pendingMutations: Record<string, boolean>
  mutationStates: Record<string, RuntimeMutationState>
  toasts: RuntimeToast[]
  loadingByResource: Record<string, boolean>
  requestRevisions: Record<string, number>
  streamStatusByRun: Record<string, 'connected' | 'reconnecting' | 'disconnected' | 'error'>
  streamReconnectAttemptsByRun: Record<string, number>
  streamErrorsByRun: Record<string, RuntimeError | null>
  capabilities: SkillRuntimeCapabilities | null
  diagnostics: SkillRuntimeDiagnosticsSnapshot | null
  settings: SkillRuntimeSettings | null
  featureFlags: SkillRuntimeFeatureFlags | null
  diagnosticsLoading: boolean
  diagnosticsError: string | null
  loading: boolean
  error: string | null
  errorDetails: RuntimeError | null
  errorScope: RuntimeErrorScope | null
  /** @deprecated Compatibility projection for the pre-v1.1 Run detail drawer. */
  runEvents: SkillRunEvent[]
  /** @deprecated Compatibility projection for the pre-v1.1 Run detail drawer. */
  runArtifacts: SkillArtifact[]
}

type RuntimeActions = {
  clearError: () => void
  dismissToast: (id: string) => void
  clearToasts: () => void
  loadCapabilities: () => Promise<SkillRuntimeCapabilities>
  loadDiagnostics: () => Promise<SkillRuntimeDiagnosticsSnapshot>
  loadSettings: () => Promise<SkillRuntimeSettings>
  updateSettings: (patch: Record<string, unknown>) => Promise<SkillRuntimeSettings>
  rollbackSettings: () => Promise<SkillRuntimeSettings>
  loadFeatureFlags: () => Promise<SkillRuntimeFeatureFlags>
  updateFeatureFlags: (patch: Record<string, boolean>) => Promise<SkillRuntimeFeatureFlags>
  loadPackages: (input?: PackageListInput) => Promise<Page<SkillPackage>>
  loadInstallations: (input?: PaginationInput) => Promise<Page<SkillInstallation>>
  loadPackage: (id: string) => Promise<PackageDetail>
  loadVersions: (packageId: string) => Promise<SkillVersion[]>
  selectVersion: (version: SkillVersion | null) => void
  inspectPackage: (source: PackageSource) => Promise<PackageInspectionResult>
  getImportReview: (reviewId: string) => Promise<PackageImportReview>
  approveImportReview: (reviewId: string) => Promise<PackageImportReview>
  rejectImportReview: (reviewId: string, reason?: string) => Promise<PackageImportReview>
  installPackage: (input: PackageInstallInput) => Promise<PackageDetail | Record<string, unknown>>
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
  loadDrafts: (input?: DraftListInput) => Promise<Page<DraftDto>>
  loadDraft: (id: string) => Promise<DraftDto>
  createDraft: (input: Parameters<typeof platform.createSkillDraft>[0]) => Promise<DraftDto>
  updateDraft: (id: string, input: Parameters<typeof platform.updateSkillDraft>[1]) => Promise<DraftDto>
  validateDraft: (id: string) => Promise<DraftValidation>
  previewDraft: (id: string) => Promise<DraftPreview>
  publishDraft: (id: string, input?: { enable?: boolean; expectedRevision?: number; idempotencyKey?: string }) => ReturnType<typeof platform.publishSkillDraft>
  discardDraft: (id: string) => Promise<DraftDto>
}

export type SkillRuntimeStore = RuntimeState & RuntimeActions

export const useSkillRuntimeStore = create<SkillRuntimeStore>()(devtools((set, get) => {
  type StreamEntry = { stream: { close: () => void }; timer?: ReturnType<typeof setTimeout>; closed: boolean; attempt: number }
  const eventStreams = new Map<string, StreamEntry>()
  const capabilityMutationPromises = new Map<string, Promise<unknown>>()
  let toastSequence = 0

  const addToast = (tone: RuntimeToast['tone'], title: string, message?: string) => {
    const toast: RuntimeToast = { id: `runtime-toast-${Date.now()}-${toastSequence++}`, tone, title, message, createdAt: Date.now() }
    set((state) => ({ toasts: [...(state.toasts ?? []), toast].slice(-6) }))
    return toast.id
  }

  const beginRequest = (key: string) => {
    const revision = (get().requestRevisions?.[key] ?? 0) + 1
    set((state) => ({ requestRevisions: { ...(state.requestRevisions ?? {}), [key]: revision } }))
    return revision
  }
  const isCurrentRequest = (key: string, revision: number) => get().requestRevisions?.[key] === revision
  const setResourceLoading = (key: string, value: boolean) => {
    set((state) => ({ loadingByResource: { ...(state.loadingByResource ?? {}), [key]: value } }))
  }

  const withMutation = async <T>(key: string, action: () => Promise<T>, options: { successTitle?: string; successMessage?: string; rollback?: () => void; errorScope?: RuntimeErrorScope } = {}): Promise<T> => {
    const startedAt = Date.now()
    set((state) => ({
      pendingMutations: { ...(state.pendingMutations ?? {}), [key]: true },
      mutationStates: { ...(state.mutationStates ?? {}), [key]: { status: 'pending', startedAt } },
      error: null,
      errorDetails: null,
      errorScope: null,
    }))
    try {
      const result = await action()
      set((state) => {
        const pending = { ...(state.pendingMutations ?? {}) }
        delete pending[key]
        return {
          pendingMutations: pending,
          mutationStates: { ...(state.mutationStates ?? {}), [key]: { status: 'success', startedAt, finishedAt: Date.now() } },
        }
      })
      if (options.successTitle) addToast('success', options.successTitle, options.successMessage)
      return result
    } catch (error) {
      const details = asRuntimeError(error)
      options.rollback?.()
      set((state) => {
        const pending = { ...(state.pendingMutations ?? {}) }
        delete pending[key]
        return {
          pendingMutations: pending,
          mutationStates: { ...(state.mutationStates ?? {}), [key]: { status: 'error', startedAt, finishedAt: Date.now(), error: details } },
          error: details.message,
          errorDetails: details,
          errorScope: options.errorScope ?? 'global',
        }
      })
      addToast('error', 'Skill Runtime 操作失败', details.message)
      throw error
    }
  }

  const replaceInstallation = (installation: SkillInstallation) => {
    set((state) => {
      const installations = state.installations.map((item) => item.id === installation.id ? installation : item)
      const selectedPackage = state.selectedPackage
        ? { ...state.selectedPackage, installations: state.selectedPackage.installations.map((item) => item.id === installation.id ? installation : item) }
        : state.selectedPackage
      return { installations, selectedPackage }
    })
  }

  const replaceCapabilityGrant = (grant: CapabilityDto) => {
    set((state) => {
      const selectedPackage = state.selectedPackage
        ? { ...state.selectedPackage, capabilityGrants: state.selectedPackage.capabilityGrants.map((item) => item.id === grant.id ? grant : item) }
        : state.selectedPackage
      const runCapabilitiesByRun = Object.fromEntries(Object.entries(state.runCapabilitiesByRun).map(([runId, capabilities]) => [runId, capabilities.map((item) => item.id === grant.id ? grant : item)]))
      return { selectedPackage, runCapabilitiesByRun }
    })
  }

  const mergeCapabilityGrant = (grantId: string, current: CapabilityDto | undefined, result: CapabilityDto | Record<string, unknown>, fallbackStatus: CapabilityDto['status']): CapabilityDto => {
    const candidate = result && typeof result === 'object' ? result as Partial<CapabilityDto> & Record<string, unknown> : {}
    const base: CapabilityDto = current ?? { id: grantId, skillVersionId: '', capability: '', scope: {} }
    const merged = { ...base, ...candidate } as CapabilityDto
    merged.id = typeof candidate.id === 'string' && candidate.id ? candidate.id : base.id || grantId
    merged.skillVersionId = typeof candidate.skillVersionId === 'string' && candidate.skillVersionId ? candidate.skillVersionId : base.skillVersionId
    merged.capability = typeof candidate.capability === 'string' && candidate.capability ? candidate.capability : base.capability
    merged.scope = candidate.scope && typeof candidate.scope === 'object' ? candidate.scope as CapabilityDto['scope'] : base.scope
    if (!merged.status) merged.status = fallbackStatus
    if (fallbackStatus === 'revoked' && merged.status === 'revoked' && merged.revokedAt == null) merged.revokedAt = Date.now()
    return merged
  }

  const runCapabilityMutation = <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const existing = capabilityMutationPromises.get(key)
    if (existing) return existing as Promise<T>
    const promise = withMutation(key, action).finally(() => {
      if (capabilityMutationPromises.get(key) === promise) capabilityMutationPromises.delete(key)
    })
    capabilityMutationPromises.set(key, promise)
    return promise
  }

  const snapshotInstallationState = () => ({
    installations: get().installations,
    selectedPackage: get().selectedPackage,
    packages: get().packages,
    packagePage: get().packagePage,
  })

  const restoreInstallationState = (snapshot: ReturnType<typeof snapshotInstallationState>) => set(snapshot)

  const optimisticInstallation = (id: string, enabled: boolean) => {
    const current = get().installations.find((item) => item.id === id)
      ?? get().selectedPackage?.installations.find((item) => item.id === id)
    if (!current) return
    replaceInstallation({ ...current, enabled, status: enabled ? 'installed' : 'disabled', updatedAt: Date.now() })
  }


  return {
    packages: [], packagePage: null, selectedPackage: null, selectedVersion: null, installations: [], installationPage: null, runs: [], runPage: null, selectedRun: null,
    eventsByRun: {}, eventCursorByRun: {}, artifactsByRun: {}, runCapabilitiesByRun: {}, drafts: {}, draftPage: null, pendingMutations: {}, mutationStates: {}, toasts: [], loadingByResource: {}, requestRevisions: {}, streamStatusByRun: {}, streamReconnectAttemptsByRun: {}, streamErrorsByRun: {}, capabilities: null, settings: null, featureFlags: null, diagnostics: null, diagnosticsLoading: false, diagnosticsError: null, loading: false, error: null, errorDetails: null, errorScope: null,
    runEvents: [], runArtifacts: [],
    clearError: () => set({ error: null, errorDetails: null, errorScope: null }),
    dismissToast: (id) => set((state) => ({ toasts: (state.toasts ?? []).filter((toast) => toast.id !== id) })),
    clearToasts: () => set({ toasts: [] }),
    loadCapabilities: async () => {
      try {
        const capabilities = await platform.getSkillRuntimeCapabilities()
        set({ capabilities })
        return capabilities
      } catch (error) {
        const details = asRuntimeError(error)
        set({ error: details.message, errorDetails: details, errorScope: 'global' })
        throw error
      }
    },
    loadDiagnostics: async () => {
      set({ diagnosticsLoading: true, diagnosticsError: null })
      try {
        const diagnostics = await platform.getSkillRuntimeDiagnostics()
        set({ diagnostics, diagnosticsLoading: false, diagnosticsError: null })
        return diagnostics
      } catch (error) {
        const details = asRuntimeError(error)
        set({ diagnosticsLoading: false, diagnosticsError: details.message, error: details.message, errorDetails: details, errorScope: 'settings' })
        throw error
      }
    },
    loadSettings: async () => withMutation('runtime-settings:load', async () => {
      const settings = await platform.getSkillRuntimeSettings()
      set({ settings })
      return settings
    }),
    updateSettings: async (patch) => withMutation('runtime-settings:update', async () => {
      const settings = await platform.updateSkillRuntimeSettings(patch)
      set({ settings })
      return settings
    }, { successTitle: 'Runtime 设置已更新' }),
    rollbackSettings: async () => withMutation('runtime-settings:rollback', async () => {
      const settings = await platform.rollbackSkillRuntimeSettings()
      set({ settings })
      return settings
    }, { successTitle: 'Runtime 设置已回滚' }),
    loadFeatureFlags: async () => withMutation('runtime-feature-flags:load', async () => {
      const featureFlags = await platform.getSkillRuntimeFeatureFlags()
      set({ featureFlags })
      return featureFlags
    }),
    updateFeatureFlags: async (patch) => withMutation('runtime-feature-flags:update', async () => {
      const featureFlags = await platform.updateSkillRuntimeFeatureFlags(patch)
      set({ featureFlags })
      return featureFlags
    }, { successTitle: 'Runtime 能力开关已更新' }),
    loadPackages: async (input = {}) => {
      const requestKey = 'packages'
      const requestRevision = beginRequest(requestKey)
      set({ loading: true, error: null, errorDetails: null, errorScope: null })
      setResourceLoading(requestKey, true)
      try {
        const result = await platform.getSkillPackages(input)
        const legacyPage = { ...result, data: result.data.map(toLegacyPackage) }
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ packages: legacyPage.data, packagePage: legacyPage, loading: false })
          setResourceLoading(requestKey, false)
        }
        return legacyPage
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ loading: false, error: details.message, errorDetails: details })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    loadInstallations: async (input = {}) => {
      const requestKey = 'installations'
      const requestRevision = beginRequest(requestKey)
      set({ loading: true, error: null, errorDetails: null, errorScope: null })
      setResourceLoading(requestKey, true)
      try {
        const result = await platform.getSkillInstallations(input)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ installations: result.data, installationPage: result, loading: false })
          setResourceLoading(requestKey, false)
        }
        return result
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ loading: false, error: details.message, errorDetails: details })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    loadPackage: async (id) => {
      const requestKey = `package:${id}`
      const requestRevision = beginRequest(requestKey)
      setResourceLoading(requestKey, true)
      try {
        const detail = toLegacyPackageDetail(await platform.getSkillPackage(id))
        if (isCurrentRequest(requestKey, requestRevision)) {
          const currentVersionId = detail.installations[0]?.currentVersionId || detail.installations[0]?.current_version_id
          set({ selectedPackage: detail, selectedVersion: detail.versions.find((version) => version.id === currentVersionId) ?? detail.versions[0] ?? null, installations: detail.installations })
          setResourceLoading(requestKey, false)
        }
        return detail
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ error: details.message, errorDetails: details, errorScope: 'global' })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    loadVersions: async (packageId) => {
      const requestKey = `versions:${packageId}`
      const requestRevision = beginRequest(requestKey)
      setResourceLoading(requestKey, true)
      try {
        const versions = await platform.getSkillVersions(packageId)
        if (isCurrentRequest(requestKey, requestRevision)) {
          const selectedPackage = get().selectedPackage
          const currentVersionId = selectedPackage?.installations[0]?.currentVersionId || selectedPackage?.installations[0]?.current_version_id
          set({ selectedVersion: versions.find((version) => version.id === currentVersionId) ?? versions[0] ?? null })
          setResourceLoading(requestKey, false)
        }
        return versions
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ error: details.message, errorDetails: details, errorScope: 'global' })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    selectVersion: (version) => set({ selectedVersion: version }),
    inspectPackage: (source) => withMutation('inspect', () => platform.inspectSkillPackage(source), { errorScope: 'import' }),
    getImportReview: (reviewId) => platform.getImportReview(reviewId),
    approveImportReview: (reviewId) => withMutation(`import-review:${reviewId}`, () => platform.approveImportReview(reviewId), { errorScope: 'import', successTitle: 'Import Review 已批准', successMessage: '现在可以提交明确的安装确认。' }),
    rejectImportReview: (reviewId, reason) => withMutation(`import-review:${reviewId}`, () => platform.rejectImportReview(reviewId, reason), { errorScope: 'import', successTitle: 'Import Review 已拒绝', successMessage: 'Rejected review 保持不可安装。' }),
    installPackage: async (input) => {
      const result = await withMutation('install', async () => platform.installSkillPackage(input), { errorScope: 'import', successTitle: 'Skill 已安装', successMessage: 'Package Runtime 已完成安装并保留审计记录。' })
      if (result && typeof result === 'object' && 'package' in result) {
        set({ selectedPackage: toLegacyPackageDetail(result as PackageDetail) })
      }
      await get().loadPackages()
      return result
    },
    enableInstallation: (id, input) => {
      const snapshot = snapshotInstallationState()
      optimisticInstallation(id, true)
      return withMutation(`installation:${id}`, async () => {
        const result = await platform.enableSkillInstallation(id, input)
        replaceInstallation(result)
        return result
      }, { successTitle: 'Installation 已启用', rollback: () => restoreInstallationState(snapshot) })
    },
    disableInstallation: (id, input) => {
      const snapshot = snapshotInstallationState()
      optimisticInstallation(id, false)
      return withMutation(`installation:${id}`, async () => {
        const result = await platform.disableSkillInstallation(id, input)
        replaceInstallation(result)
        return result
      }, { successTitle: 'Installation 已禁用', rollback: () => restoreInstallationState(snapshot) })
    },
    setInstallationEnabled: (id, enabled, expectedRevision) => {
      const input = { expectedRevision, idempotencyKey: makeIdempotencyKey(enabled ? 'enable' : 'disable') }
      return enabled ? get().enableInstallation(id, input) : get().disableInstallation(id, input)
    },
    uninstallPackage: (id, expectedRevision) => {
      const snapshot = snapshotInstallationState()
      const current = get().installations.find((item) => item.id === id) ?? get().selectedPackage?.installations.find((item) => item.id === id)
      if (current) replaceInstallation({ ...current, enabled: false, status: 'uninstalling', uninstalledAt: Date.now(), updatedAt: Date.now() })
      return withMutation(`installation:${id}`, async () => {
        const result = await platform.uninstallSkillInstallation(id, { expectedRevision, idempotencyKey: makeIdempotencyKey('uninstall') })
        replaceInstallation(result)
        set({ selectedPackage: null })
        await get().loadPackages()
        return result
      }, { successTitle: 'Installation 已卸载', rollback: () => restoreInstallationState(snapshot) })
    },
    rollbackInstallation: (id, input) => withMutation(`installation:${id}`, async () => {
      const result = await platform.rollbackSkillInstallation(id, { ...input, idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey('rollback') })
      replaceInstallation(result)
      return result
    }, { successTitle: 'Installation 已回滚' }),
    deletePackage: (id, input) => withMutation(`package:${id}`, async () => {
      const result = await platform.deleteSkillPackage(id, { ...input, idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey('delete-package') })
      set({ selectedPackage: null })
      await get().loadPackages()
      return result
    }, { successTitle: 'Package 已删除' }),
    approve: (id, input) => {
      const current = get().selectedPackage?.capabilityGrants.find((grant) => grant.id === id)
      return runCapabilityMutation(`grant:${id}`, async () => {
        const result = await platform.approveCapabilityGrant(id, input)
        const grant = mergeCapabilityGrant(id, current, result, 'approved')
        replaceCapabilityGrant(grant)
        return grant
      })
    },
    reject: (id, input) => {
      const current = get().selectedPackage?.capabilityGrants.find((grant) => grant.id === id)
      return runCapabilityMutation(`grant:${id}`, async () => {
        const result = await platform.rejectCapabilityGrant(id, input)
        const grant = mergeCapabilityGrant(id, current, result, 'rejected')
        replaceCapabilityGrant(grant)
        return grant
      })
    },
    revokeCapabilityGrant: (id, input) => {
      const current = get().selectedPackage?.capabilityGrants.find((grant) => grant.id === id)
      return runCapabilityMutation(`grant:${id}`, async () => {
        const result = await platform.revokeCapabilityGrant(id, input)
        const grant = mergeCapabilityGrant(id, current, result, 'revoked')
        grant.status = 'revoked'
        if (grant.revokedAt == null) grant.revokedAt = Date.now()
        replaceCapabilityGrant(grant)
        return grant
      })
    },
    loadRuns: async (input = {}) => {
      const requestKey = 'runs'
      const requestRevision = beginRequest(requestKey)
      set({ loading: true, error: null, errorDetails: null, errorScope: null })
      setResourceLoading(requestKey, true)
      try {
        const result = await platform.listSkillRuns(input)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ runs: result.data, runPage: result, loading: false })
          setResourceLoading(requestKey, false)
        }
        return result
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ loading: false, error: details.message, errorDetails: details })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    loadRun: async (id) => {
      const requestKey = `run:${id}`
      const requestRevision = beginRequest(requestKey)
      setResourceLoading(requestKey, true)
      try {
        const run = await platform.getSkillRun(id)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ selectedRun: run })
          setResourceLoading(requestKey, false)
        }
        return run
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ error: details.message, errorDetails: details, errorScope: 'global' })
          setResourceLoading(requestKey, false)
        }
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
        set({ error: details.message, errorDetails: details, errorScope: 'global' })
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
        set({ error: details.message, errorDetails: details, errorScope: 'global' })
        throw error
      }
    },
    subscribeRunEvents: (id) => {
      const previous = eventStreams.get(id)
      if (previous) {
        previous.closed = true
        if (previous.timer) clearTimeout(previous.timer)
        previous.stream.close()
        eventStreams.delete(id)
      }
      const connect = (attempt: number): (() => void) => {
        const cursor = get().eventCursorByRun[id] ?? 0
        try {
          const entry = { stream: undefined as unknown as { close: () => void }, closed: false, attempt } as StreamEntry
          const stream = platform.subscribeSkillRunEvents(id, cursor, {
            onEvent: (event) => {
              if (entry.closed) return
              get().appendEvents(id, [event])
              set((state) => ({ streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [id]: 'connected' }, streamReconnectAttemptsByRun: { ...(state.streamReconnectAttemptsByRun ?? {}), [id]: 0 }, streamErrorsByRun: { ...(state.streamErrorsByRun ?? {}), [id]: null } }))
            },
            onError: (error) => {
              if (entry.closed) return
              set((state) => ({ error: error.message, errorDetails: error, errorScope: 'runs', streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [id]: attempt < 3 ? 'reconnecting' : 'error' }, streamReconnectAttemptsByRun: { ...(state.streamReconnectAttemptsByRun ?? {}), [id]: attempt + 1 }, streamErrorsByRun: { ...(state.streamErrorsByRun ?? {}), [id]: error } }))
              addToast('warning', 'Run 事件流已断开', `正在从 cursor ${get().eventCursorByRun[id] ?? 0} 重连。`)
              if (attempt < 3) {
                entry.timer = setTimeout(() => {
                  if (entry.closed || eventStreams.get(id) !== entry) return
                  entry.closed = true
                  stream.close()
                  eventStreams.delete(id)
                  connect(attempt + 1)
                }, Math.min(250 * 2 ** attempt, 2000))
              }
            },
          })
          entry.stream = stream
          eventStreams.set(id, entry)
          set((state) => ({ streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [id]: 'connected' }, streamErrorsByRun: { ...(state.streamErrorsByRun ?? {}), [id]: null } }))
          return () => {
            if (eventStreams.get(id) === entry) eventStreams.delete(id)
            entry.closed = true
            if (entry.timer) clearTimeout(entry.timer)
            stream.close()
          }
        } catch (error) {
          const details = asRuntimeError(error)
          set((state) => ({ error: details.message, errorDetails: details, errorScope: 'runs', streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [id]: 'error' }, streamErrorsByRun: { ...(state.streamErrorsByRun ?? {}), [id]: details } }))
          return () => undefined
        }
      }
      return connect(0)
    },
    stopRunEvents: (id) => {
      const entry = eventStreams.get(id)
      if (entry) {
        entry.closed = true
        if (entry.timer) clearTimeout(entry.timer)
        entry.stream.close()
        eventStreams.delete(id)
      }
      set((state) => ({ streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [id]: 'disconnected' } }))
    },
    appendEvents: (runId, events) => {
      const current = get().eventsByRun[runId] ?? []
      const bySeq = new Map(current.map((event) => [event.seq, event]))
      for (const event of events) {
        if (event.runId !== runId) continue
        bySeq.set(event.seq, event)
      }
      const next = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
      const cursor = next.reduce((max, event) => Math.max(max, event.seq), get().eventCursorByRun[runId] ?? 0)
      set((state) => ({ eventsByRun: { ...state.eventsByRun, [runId]: next }, eventCursorByRun: { ...state.eventCursorByRun, [runId]: cursor }, runEvents: state.selectedRun?.id === runId ? next : state.runEvents }))
      return next
    },
    reconnectRunEvents: async (runId) => {
      const cursor = get().eventCursorByRun[runId] ?? 0
      const entry = eventStreams.get(runId)
      if (entry) {
        entry.closed = true
        if (entry.timer) clearTimeout(entry.timer)
        entry.stream.close()
        eventStreams.delete(runId)
      }
      let lastError: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const events = await get().loadRunEvents(runId, cursor)
          set((state) => ({ streamStatusByRun: { ...(state.streamStatusByRun ?? {}), [runId]: 'connected' }, streamReconnectAttemptsByRun: { ...(state.streamReconnectAttemptsByRun ?? {}), [runId]: 0 }, streamErrorsByRun: { ...(state.streamErrorsByRun ?? {}), [runId]: null } }))
          return events
        } catch (error) {
          lastError = error
          if (attempt === 0) addToast('info', '正在重连 Run 事件流', `继续使用 cursor ${cursor} 获取缺失事件。`)
        }
      }
      throw lastError
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
    loadDrafts: async (input = {}) => {
      const requestKey = 'drafts'
      const requestRevision = beginRequest(requestKey)
      setResourceLoading(requestKey, true)
      try {
        const result = await platform.listSkillDrafts(input)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set((state) => ({ draftPage: result, drafts: { ...(state.drafts ?? {}), ...Object.fromEntries(result.data.map((draft) => [draft.id, draft])) } }))
          setResourceLoading(requestKey, false)
        }
        return result
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ error: details.message, errorDetails: details, errorScope: 'global' })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    loadDraft: async (id) => {
      const requestKey = `draft:${id}`
      const requestRevision = beginRequest(requestKey)
      setResourceLoading(requestKey, true)
      try {
        const draft = await platform.getSkillDraft(id)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set((state) => ({ drafts: { ...(state.drafts ?? {}), [draft.id]: draft } }))
          setResourceLoading(requestKey, false)
        }
        return draft
      } catch (error) {
        const details = asRuntimeError(error)
        if (isCurrentRequest(requestKey, requestRevision)) {
          set({ error: details.message, errorDetails: details, errorScope: 'global' })
          setResourceLoading(requestKey, false)
        }
        throw error
      }
    },
    createDraft: async (input) => withMutation('draft:create', async () => {
      const draft = await platform.createSkillDraft(input)
      set((state) => ({ drafts: { ...(state.drafts ?? {}), [draft.id]: draft } }))
      return draft
    }, { successTitle: 'Draft 已创建' }),
    updateDraft: async (id, input) => withMutation(`draft:${id}`, async () => {
      const draft = await platform.updateSkillDraft(id, input)
      set((state) => ({ drafts: { ...(state.drafts ?? {}), [draft.id]: draft } }))
      return draft
    }),
    validateDraft: async (id) => withMutation(`draft:${id}:validate`, () => platform.validateSkillDraft(id)),
    previewDraft: async (id) => withMutation(`draft:${id}:preview`, () => platform.previewSkillDraft(id)),
    publishDraft: async (id, input) => withMutation(`draft:${id}`, async () => platform.publishSkillDraft(id, { ...input, idempotencyKey: input?.idempotencyKey ?? makeIdempotencyKey('publish-draft') }), { successTitle: 'Skill Draft 已发布', successMessage: '已生成可追踪的 Package、Version 和 Installation 关系。' }),
    discardDraft: async (id) => withMutation(`draft:${id}`, async () => {
      const draft = await platform.discardSkillDraft(id)
      set((state) => ({ drafts: { ...(state.drafts ?? {}), [draft.id]: draft } }))
      return draft
    }, { successTitle: 'Draft 已丢弃' }),
  }
}, { name: 'bloomai-skill-runtime' }))
