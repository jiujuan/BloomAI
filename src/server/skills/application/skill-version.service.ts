import crypto from 'node:crypto'
import { ServiceError } from '../../services/errors'
import type { InstallationSnapshot, JsonObject, PackageSkillRepository, VersionSnapshot } from './ports'
import { diffSkillVersions, type SkillVersionDiff } from './skill-version.diff'

export type SkillVersionCandidate = {
  version: string
  manifest: JsonObject
  manifestHash: string
  packagePath: string
  sourceSnapshot?: JsonObject
  isCompatible?: boolean
  status?: string
  securityStatus?: string
  securityFindings?: JsonObject
  snapshotHash?: string
}

type ExtendedPackageRepository = PackageSkillRepository

type VersionServiceDependencies = {
  packages: ExtendedPackageRepository
  runs?: { listRuns?: (options: { limit: number; offset: number; status?: string; skillVersionId?: string }) => { data: readonly any[]; total: number } }
  grants?: { listCapabilityGrants?: (skillVersionId: string, options?: Record<string, unknown>) => readonly any[] }
}

export type VersionUpdatePreview = {
  packageId: string
  currentVersionId: string | null
  candidate: SkillVersionCandidate
  duplicate: boolean
  existingVersionId: string | null
  diff: SkillVersionDiff | null
  checks: { runningRuns: number; activeGrants: number; compatible: boolean; warnings: string[] }
}

export function createSkillVersionService(dependencies: VersionServiceDependencies) {
  const packages = dependencies.packages
  return {
    listVersions(packageId: string) {
      assertPackageExists(packageId)
      return packages.listVersions(packageId)
    },

    getVersion(versionId: string) {
      const version = packages.getVersion(versionId)
      if (!version) throw new ServiceError('NOT_FOUND', 'Skill version not found')
      return version
    },

    diffVersions(fromVersionId: string, toVersionId: string) {
      const from = this.getVersion(fromVersionId)
      const to = this.getVersion(toVersionId)
      if (from.packageId !== to.packageId) throw new ServiceError('VALIDATION_ERROR', 'Versions must belong to the same package')
      return diffSkillVersions(from, to)
    },

    async previewUpdate(packageId: string, candidate: SkillVersionCandidate): Promise<VersionUpdatePreview> {
      assertActivePackage(packageId)
      const current = currentVersion(packageId, packages)
      const normalized = normalizeCandidate(candidate)
      const immutableHash = computeImmutableHash(normalized)
      const existing = packages.findVersionByImmutableHash?.(packageId, immutableHash)
        ?? packages.listVersions(packageId).find((version) => effectiveImmutableHash(version) === immutableHash)
      const candidateVersion: VersionSnapshot = {
        id: existing?.id ?? 'preview',
        packageId,
        version: normalized.version,
        runtime: 'instruction-agent',
        manifest: normalized.manifest,
        manifestHash: normalized.manifestHash,
        packagePath: normalized.packagePath,
        sourceSnapshot: normalized.sourceSnapshot ?? {},
        isCompatible: normalized.isCompatible !== false,
        createdAt: 0,
        immutableHash,
        status: normalized.status ?? 'runnable',
        securityStatus: normalized.securityStatus ?? 'unreviewed',
        securityFindings: normalized.securityFindings ?? {},
        snapshotHash: normalized.snapshotHash ?? snapshotHash(normalized.sourceSnapshot),
      }
      const runningRuns = dependencies.runs?.listRuns?.({ limit: 100, offset: 0, status: 'running', skillVersionId: current?.id })?.total ?? 0
      const activeGrants = current ? dependencies.grants?.listCapabilityGrants?.(current.id, {})?.filter((grant: any) => grant.revokedAt === null && grant.status === 'approved').length ?? 0 : 0
      const diff = current ? diffSkillVersions(current, candidateVersion) : null
      return {
        packageId,
        currentVersionId: current?.id ?? null,
        candidate: normalized,
        duplicate: Boolean(existing),
        existingVersionId: existing?.id ?? null,
        diff,
        checks: {
          runningRuns,
          activeGrants,
          compatible: normalized.isCompatible !== false,
          warnings: [
            ...(runningRuns > 0 ? [`${runningRuns} running run(s) continue on the current version`] : []),
            ...(activeGrants > 0 ? [`${activeGrants} active grant(s) require review`] : []),
            ...(normalized.isCompatible === false ? ['candidate version is incompatible'] : []),
            ...(diff?.riskSummary.warnings ?? []),
          ],
        },
      }
    },

    async updatePackage(packageId: string, candidate: SkillVersionCandidate) {
      const preview = await this.previewUpdate(packageId, candidate)
      if (preview.duplicate && preview.existingVersionId) {
        return { packageId, duplicate: true, version: this.getVersion(preview.existingVersionId), currentVersionId: preview.currentVersionId }
      }
      if (!preview.checks.compatible) throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Skill version is incompatible with the Package Runtime')
      const normalized = preview.candidate
      const created = packages.createVersion({
        packageId,
        version: normalized.version,
        manifest: normalized.manifest,
        manifestHash: normalized.manifestHash,
        packagePath: normalized.packagePath,
        sourceSnapshot: normalized.sourceSnapshot,
        isCompatible: normalized.isCompatible,
        immutableHash: computeImmutableHash(normalized),
        status: normalized.status,
        securityStatus: normalized.securityStatus,
        securityFindings: normalized.securityFindings,
        snapshotHash: normalized.snapshotHash,
      } as any)
      return { packageId, duplicate: false, version: created, currentVersionId: preview.currentVersionId }
    },

    switchCurrent(installationId: string, versionId: string, options: { expectedRevision: number; idempotencyKey: string }) {
      const installation = packages.getInstallation?.(installationId)
      if (!installation) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
      const version = this.getVersion(versionId)
      if (version.packageId !== installation.packageId) throw new ServiceError('VALIDATION_ERROR', 'Version does not belong to installation package')
      if (!version.isCompatible || !['runnable', 'verified', undefined].includes((version as any).status)) {
        throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Only compatible runnable versions can become current')
      }
      if (!packages.switchCurrentVersion) throw new ServiceError('INTERNAL_ERROR', 'Current version switching is unavailable')
      const switched = packages.switchCurrentVersion({ installationId, versionId, ...options })
      if (!switched) throw new ServiceError('REVISION_CONFLICT', 'Skill installation revision conflict')
      return switched
    },
  }

  function assertPackageExists(packageId: string): void {
    if (!packages.getPackage(packageId)) throw new ServiceError('NOT_FOUND', 'Skill package not found')
  }

  function assertActivePackage(packageId: string): void {
    const pkg = packages.getPackage(packageId)
    if (!pkg) throw new ServiceError('NOT_FOUND', 'Skill package not found')
    if (pkg.deletedAt !== null && pkg.deletedAt !== undefined) {
      throw new ServiceError('CONFLICT', 'Archived skill packages cannot be updated')
    }
  }
}

function currentVersion(packageId: string, packages: ExtendedPackageRepository): VersionSnapshot | undefined {
  const installation = packages.listInstallations(packageId).find((item) => item.enabled && item.status !== 'uninstalled')
  return installation ? packages.getVersion(installation.currentVersionId) : packages.listVersions(packageId)[0]
}

function normalizeCandidate(candidate: SkillVersionCandidate): SkillVersionCandidate {
  return {
    version: candidate.version,
    manifest: candidate.manifest,
    manifestHash: candidate.manifestHash,
    packagePath: candidate.packagePath,
    sourceSnapshot: candidate.sourceSnapshot ?? {},
    isCompatible: candidate.isCompatible !== false,
    status: candidate.status ?? 'runnable',
    securityStatus: candidate.securityStatus ?? 'unreviewed',
    securityFindings: candidate.securityFindings ?? {},
    snapshotHash: candidate.snapshotHash ?? snapshotHash(candidate.sourceSnapshot),
  }
}

function computeImmutableHash(candidate: SkillVersionCandidate): string {
  return crypto.createHash('sha256').update(stableJson({ manifestHash: candidate.manifestHash, sourceSnapshot: candidate.sourceSnapshot ?? {}, snapshotHash: candidate.snapshotHash ?? snapshotHash(candidate.sourceSnapshot) })).digest('hex')
}

function effectiveImmutableHash(version: VersionSnapshot): string {
  if (typeof (version as any).immutableHash === 'string' && (version as any).immutableHash) return (version as any).immutableHash
  return computeImmutableHash(version)
}

function snapshotHash(snapshot?: JsonObject): string {
  if (!snapshot) return ''
  for (const key of ['snapshotHash', 'snapshot_hash', 'sourceSha256', 'source_sha256']) if (typeof snapshot[key] === 'string') return snapshot[key] as string
  return ''
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
