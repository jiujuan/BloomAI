import crypto from 'node:crypto'

export type SkillVersionDiffInput = {
  id?: string
  manifestHash?: string | null
  manifest?: Record<string, unknown> | null
  sourceSnapshot?: Record<string, unknown> | null
  securityStatus?: string | null
  securityFindings?: Record<string, unknown> | null
}

export type SkillVersionDiff = {
  fromVersionId: string | null
  toVersionId: string | null
  manifestChanges: Array<{ path: string; kind: 'added' | 'changed' | 'removed'; from?: unknown; to?: unknown }>
  files: { added: string[]; changed: string[]; removed: string[] }
  capabilities: { added: string[]; removed: string[] }
  sourceShaChanged: boolean
  sourceCommitChanged: boolean
  source: { fromSha: string | null; toSha: string | null; fromCommit: string | null; toCommit: string | null }
  security: { statusChanged: boolean; fromStatus: string | null; toStatus: string | null; findingsChanged: boolean }
  riskSummary: { level: 'low' | 'medium' | 'high'; warnings: string[] }
}

const SENSITIVE_KEY = /(prompt|token|secret|password|credential|authorization|api[-_]?key|private)/i

export function diffSkillVersions(from: SkillVersionDiffInput, to: SkillVersionDiffInput): SkillVersionDiff {
  const fromManifest = isRecord(from.manifest) ? from.manifest : {}
  const toManifest = isRecord(to.manifest) ? to.manifest : {}
  const manifestChanges = diffValues(fromManifest, toManifest)
  const fromFiles = fileMap(fromManifest, from.sourceSnapshot)
  const toFiles = fileMap(toManifest, to.sourceSnapshot)
  const added = [...toFiles.keys()].filter((file) => !fromFiles.has(file)).sort()
  const removed = [...fromFiles.keys()].filter((file) => !toFiles.has(file)).sort()
  const changed = [...toFiles.keys()].filter((file) => fromFiles.has(file) && toFiles.get(file) !== fromFiles.get(file)).sort()
  const fromCapabilities = capabilitySet(fromManifest)
  const toCapabilities = capabilitySet(toManifest)
  const capabilitiesAdded = [...toCapabilities].filter((capability) => !fromCapabilities.has(capability)).sort()
  const capabilitiesRemoved = [...fromCapabilities].filter((capability) => !toCapabilities.has(capability)).sort()
  const fromSha = sourceSha(from.sourceSnapshot)
  const toSha = sourceSha(to.sourceSnapshot)
  const fromCommit = sourceCommit(from.sourceSnapshot)
  const toCommit = sourceCommit(to.sourceSnapshot)
  const fromStatus = from.securityStatus ?? null
  const toStatus = to.securityStatus ?? null
  const securityStatusChanged = fromStatus !== toStatus
  const securityFindingsChanged = stableJson(from.securityFindings ?? {}) !== stableJson(to.securityFindings ?? {})
  const sourceCommitChanged = fromCommit !== toCommit
  const warnings = capabilitiesAdded.map((capability) => `capability expansion: ${capability}`)
  if (changed.length > 0) warnings.push(`${changed.length} file(s) changed`)
  if (sourceCommitChanged) warnings.push('source commit changed')
  if (securityStatusChanged) warnings.push(`security status changed: ${fromStatus ?? 'unknown'} -> ${toStatus ?? 'unknown'}`)
  if (securityFindingsChanged) warnings.push('security findings changed')
  const level = capabilitiesAdded.length > 0 || ['rejected', 'quarantined', 'blocked'].includes(toStatus ?? '')
    ? 'high'
    : changed.length > 0 || manifestChanges.length > 0 || sourceCommitChanged || securityStatusChanged || securityFindingsChanged
      ? 'medium'
      : 'low'

  return {
    fromVersionId: from.id ?? null,
    toVersionId: to.id ?? null,
    manifestChanges,
    files: { added, changed, removed },
    capabilities: { added: capabilitiesAdded, removed: capabilitiesRemoved },
    sourceShaChanged: fromSha !== toSha,
    sourceCommitChanged,
    source: { fromSha, toSha, fromCommit, toCommit },
    security: { statusChanged: securityStatusChanged, fromStatus, toStatus, findingsChanged: securityFindingsChanged },
    riskSummary: { level, warnings: [...new Set(warnings)].sort((a, b) => a.localeCompare(b)) },
  }
}

function diffValues(from: unknown, to: unknown, prefix = ''): SkillVersionDiff['manifestChanges'] {
  if (SENSITIVE_KEY.test(prefix.split('.').at(-1) ?? '')) {
    return stableJson(from) === stableJson(to) ? [] : [{ path: prefix || '$', kind: 'changed', from: '[redacted]', to: '[redacted]' }]
  }
  if (stableJson(from) === stableJson(to)) return []
  if (isRecord(from) && isRecord(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()
    return keys.flatMap((key) => {
      const path = prefix ? `${prefix}.${key}` : key
      if (!(key in from)) return [{ path, kind: 'added' as const, to: safeValue(to[key]) }]
      if (!(key in to)) return [{ path, kind: 'removed' as const, from: safeValue(from[key]) }]
      return diffValues(from[key], to[key], path)
    })
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const changes: SkillVersionDiff['manifestChanges'] = []
    const length = Math.max(from.length, to.length)
    for (let index = 0; index < length; index += 1) {
      const path = `${prefix}[${index}]`
      if (index >= from.length) changes.push({ path, kind: 'added', to: safeValue(to[index]) })
      else if (index >= to.length) changes.push({ path, kind: 'removed', from: safeValue(from[index]) })
      else changes.push(...diffValues(from[index], to[index], path))
    }
    return changes
  }
  return [{ path: prefix || '$', kind: 'changed', from: safeValue(from), to: safeValue(to) }]
}

function safeValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return { changed: true, sha256: crypto.createHash('sha256').update(value).digest('hex') }
  if (Array.isArray(value)) return { changed: true, itemCount: value.length }
  if (isRecord(value)) return { changed: true, keys: Object.keys(value).sort() }
  return { changed: true }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function fileMap(manifest: Record<string, unknown>, snapshot?: Record<string, unknown> | null): Map<string, string> {
  const source = Array.isArray(manifest.files) ? manifest.files : Array.isArray(snapshot?.files) ? snapshot.files : []
  const result = new Map<string, string>()
  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === 'string') result.set(item, item)
      else if (isRecord(item) && typeof item.path === 'string') result.set(item.path, typeof item.sha256 === 'string' ? item.sha256 : stableJson(item))
    }
  }
  if (isRecord(snapshot?.filesManifest)) {
    for (const [file, value] of Object.entries(snapshot.filesManifest)) {
      const sha = isRecord(value) && typeof value.sha256 === 'string' ? value.sha256 : stableJson(value)
      result.set(file, sha)
    }
  }
  return result
}

function capabilitySet(manifest: Record<string, unknown>): Set<string> {
  const raw = Array.isArray(manifest.requestedCapabilities) ? manifest.requestedCapabilities : Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  return new Set(raw.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (isRecord(item) && typeof item.capability === 'string') return [item.capability]
    return []
  }))
}

function sourceSha(snapshot?: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  for (const key of ['sourceSha256', 'source_sha256', 'snapshotHash', 'snapshot_hash']) {
    if (typeof snapshot[key] === 'string') return snapshot[key]
  }
  return null
}

function sourceCommit(snapshot?: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  for (const key of ['resolvedCommit', 'resolved_commit', 'commitSha', 'commit_sha', 'gitCommit', 'git_commit', 'commit']) {
    if (typeof snapshot[key] === 'string') return snapshot[key]
  }
  return null
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
